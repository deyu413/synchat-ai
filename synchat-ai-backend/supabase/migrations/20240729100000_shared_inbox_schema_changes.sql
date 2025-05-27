-- Migration script for Shared Inbox feature schema changes

BEGIN;

-- Create ENUM type for conversation status
CREATE TYPE public.conversation_status_type AS ENUM (
    'open',
    'bot_active',
    'escalated_to_human',
    'awaiting_agent_reply',
    'agent_replied',
    'closed_by_agent',
    'closed_by_user',
    'resolved_by_ia',
    'archived'
);

-- Modify 'conversations' table
-- Before altering the column type, drop any existing CHECK constraint on 'status'
-- This requires knowing the constraint name. If unknown, it might need to be looked up manually or handled by Supabase UI/diffing.
-- For this script, we assume direct alteration is possible or the constraint name is unknown/variable.
-- A common pattern for constraint names is table_column_check.
-- Dynamically drop any CHECK constraint on public.conversations.status
DO $$
DECLARE
    constraint_name_var TEXT;
BEGIN
    SELECT con.conname INTO constraint_name_var
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
    WHERE con.conrelid = 'public.conversations'::regclass
      AND con.contype = 'c' -- Check constraint
      AND att.attname = 'status' -- Specifically for the 'status' column
    LIMIT 1;

    IF constraint_name_var IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.conversations DROP CONSTRAINT ' || quote_ident(constraint_name_var);
        RAISE NOTICE 'Dynamically dropped CHECK constraint: % on public.conversations.status', constraint_name_var;
    ELSE
        RAISE NOTICE 'CHECK constraint on public.conversations.status not found or already removed.';
    END IF;
END $$;

ALTER TABLE public.conversations
    ALTER COLUMN status TYPE public.conversation_status_type
    USING status::text::public.conversation_status_type,
    ALTER COLUMN status SET DEFAULT 'open'; -- Or 'bot_active' depending on desired default

ALTER TABLE public.conversations
    ADD COLUMN assigned_agent_id UUID NULL,
    ADD COLUMN last_agent_message_at TIMESTAMPTZ NULL,
    ADD COLUMN last_message_preview VARCHAR(255) NULL;

-- Optional Foreign Key for assigned_agent_id:
-- ALTER TABLE public.conversations
--     ADD CONSTRAINT fk_assigned_agent
--     FOREIGN KEY (assigned_agent_id)
--     REFERENCES auth.users(id) -- Assuming agents are in auth.users
--     ON DELETE SET NULL;

-- Create ENUM type for message sender
CREATE TYPE public.message_sender_type AS ENUM (
    'user',
    'bot',
    'agent'
);

-- Modify 'messages' table
-- Attempt to drop the old CHECK constraint.
DO $$
DECLARE
    constraint_name_var TEXT;
BEGIN
    SELECT conname INTO constraint_name_var
    FROM pg_constraint 
    WHERE conrelid = 'public.messages'::regclass -- Ensures we are looking at the 'messages' table in 'public' schema
    AND pg_get_constraintdef(oid) LIKE '%sender%IN%(''user''%''bot'')%' -- Pattern for the check constraint
    LIMIT 1;

    IF constraint_name_var IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.messages DROP CONSTRAINT ' || quote_ident(constraint_name_var);
        RAISE NOTICE 'Dropped constraint: % on public.messages', constraint_name_var;
    ELSE
        RAISE NOTICE 'Sender check constraint on public.messages not found or already removed.';
    END IF;
END $$;

-- Alter the column type for 'sender'
ALTER TABLE public.messages
    ALTER COLUMN sender TYPE public.message_sender_type
    USING sender::text::public.message_sender_type;

-- Add agent_user_id column to messages table
ALTER TABLE public.messages
    ADD COLUMN agent_user_id UUID NULL;

COMMENT ON COLUMN public.messages.agent_user_id IS 'Identifier of the agent who sent this message, if sender is ''agent''. Foreign key to auth.users.id.';

-- Optional but recommended: Add Foreign Key to auth.users
ALTER TABLE public.messages
    ADD CONSTRAINT fk_messages_agent_user_id
    FOREIGN KEY (agent_user_id)
    REFERENCES auth.users(id)
    ON DELETE SET NULL;

-- Add comments for new columns and types for clarity
COMMENT ON TYPE public.conversation_status_type IS 'Defines the set of possible statuses for a conversation, e.g., open, bot_active, escalated_to_human, etc.';
COMMENT ON COLUMN public.conversations.status IS 'Current status of the conversation, uses the conversation_status_type ENUM. Default is ''open''.';
COMMENT ON COLUMN public.conversations.assigned_agent_id IS 'UUID of the agent assigned to handle this conversation. Null if unassigned.';
COMMENT ON COLUMN public.conversations.last_agent_message_at IS 'Timestamp of the last message sent by a human agent in this conversation.';
COMMENT ON COLUMN public.conversations.last_message_preview IS 'A short text preview (up to 255 characters) of the most recent message in the conversation.';

COMMENT ON TYPE public.message_sender_type IS 'Defines the type of sender for a message: user, bot, or agent.';
COMMENT ON COLUMN public.messages.sender IS 'Identifies who sent the message, using the message_sender_type ENUM (user, bot, or agent).';

COMMIT;
