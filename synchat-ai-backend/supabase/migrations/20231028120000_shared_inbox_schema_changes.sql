-- Migration script for Shared Inbox feature schema changes

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
ALTER TABLE public.conversations
    -- Modify 'status' column
    ADD COLUMN status_new public.conversation_status_type DEFAULT 'open',
    DROP CONSTRAINT IF EXISTS conversations_status_check; -- Remove old check constraint if it exists by this name

-- This part requires knowing existing values. Assuming 'open' or 'bot_active' are safe defaults for any existing text statuses.
-- If existing statuses are e.g. 'OPEN', 'BOT_ACTIVE', they need to be lowercased first or handled in USING.
-- For simplicity, this script assumes existing values are directly mappable or can be defaulted.
-- A more robust migration would inspect and convert existing values carefully.
-- UPDATE public.conversations SET status_new = lower(status)::public.conversation_status_type WHERE status IS NOT NULL;
-- For now, we'll rely on the default for new rows and assume manual handling or acceptable loss for existing rows if types mismatch without explicit conversion.
-- Or, if we are sure existing values map directly or are few:
-- UPDATE public.conversations SET status_new = status::public.conversation_status_type WHERE status IS NOT NULL;

-- After data migration (if any), switch columns
-- DROP COLUMN status,
-- RENAME COLUMN status_new TO status;
-- For a simpler migration without data preservation guarantee if types conflict:
ALTER TABLE public.conversations
    ALTER COLUMN status TYPE public.conversation_status_type
    USING status::text::public.conversation_status_type,
    ALTER COLUMN status SET DEFAULT 'open';


ALTER TABLE public.conversations
    -- Add 'assigned_agent_id' column
    ADD COLUMN assigned_agent_id UUID NULL,
    -- Add 'last_agent_message_at' column
    ADD COLUMN last_agent_message_at TIMESTAMPTZ NULL,
    -- Add 'last_message_preview' column
    ADD COLUMN last_message_preview VARCHAR(255) NULL;

-- Add foreign key constraint for assigned_agent_id (Optional for now, but good practice)
-- This assumes 'auth.users' table exists and 'id' is its primary key.
-- If agents are in a different table, adjust accordingly.
-- ALTER TABLE public.conversations
--     ADD CONSTRAINT fk_assigned_agent
--     FOREIGN KEY (assigned_agent_id)
--     REFERENCES auth.users(id)
--     ON DELETE SET NULL;

-- Create ENUM type for message sender
CREATE TYPE public.message_sender_type AS ENUM (
    'user',
    'bot',
    'agent'
);

-- Modify 'messages' table
-- First, remove the old CHECK constraint if it exists
-- The name of the check constraint might vary. Common patterns are messages_sender_check or sender_check.
-- Inspect your table schema to get the exact constraint name if this fails.
DO $$
DECLARE
    constraint_name_var TEXT;
BEGIN
    SELECT conname INTO constraint_name_var
    FROM pg_constraint 
    WHERE conrelid = 'public.messages'::regclass 
    AND consrc LIKE '%sender%IN%(''user''%''bot'')%' 
    LIMIT 1;

    IF constraint_name_var IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.messages DROP CONSTRAINT ' || quote_ident(constraint_name_var);
    ELSE
        -- Try a common default name if specific lookup failed (less reliable)
        -- ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sender_check;
        RAISE NOTICE 'Sender check constraint not found or already removed.';
    END IF;
END $$;

-- Now, alter the column type
ALTER TABLE public.messages
    ALTER COLUMN sender TYPE public.message_sender_type
    USING sender::text::public.message_sender_type;

-- Add comments for new columns and types
COMMENT ON TYPE public.conversation_status_type IS 'Possible statuses for a conversation in the shared inbox.';
COMMENT ON COLUMN public.conversations.status IS 'Current status of the conversation, using conversation_status_type ENUM.';
COMMENT ON COLUMN public.conversations.assigned_agent_id IS 'ID of the agent assigned to this conversation. Null if unassigned or handled by bot.';
COMMENT ON COLUMN public.conversations.last_agent_message_at IS 'Timestamp of the last message sent by an agent in this conversation.';
COMMENT ON COLUMN public.conversations.last_message_preview IS 'A short preview of the last message in the conversation (user, bot, or agent).';

COMMENT ON TYPE public.message_sender_type IS 'Identifies the sender of a message (user, bot, or agent).';
COMMENT ON COLUMN public.messages.sender IS 'Type of the sender for the message, using message_sender_type ENUM.';

COMMIT;
ROLLBACK;

-- The COMMIT and ROLLBACK are for testing in a transaction. 
-- Supabase CLI handles migrations atomically, so they are not strictly needed in the final file.
-- For now, I will remove them from the script to be saved.The previous attempt to create the migration script had a few issues:
1.  It included `COMMIT` and `ROLLBACK` which are not standard for Supabase migration files.
2.  The logic for altering `conversations.status` was a bit convoluted with `status_new`. A direct alteration with `USING` is preferred if existing values are compatible or can be cast.
3.  The `DO $$ ... END $$;` block for dropping the constraint in `messages` table is good, but I need to ensure it's robust.

I will refine the script. I'll use a more current timestamp like `20240729100000`.

Here's the refined plan:

1.  **Define the SQL script content** with corrections:
    *   Create `public.conversation_status_type` ENUM.
    *   Alter `public.conversations.status` column directly using `USING status::text::public.conversation_status_type` and set a default.
    *   Add `assigned_agent_id`, `last_agent_message_at`, and `last_message_preview` columns to `public.conversations`.
    *   Add the optional Foreign Key for `assigned_agent_id` but commented out as per original instructions.
    *   Create `public.message_sender_type` ENUM.
    *   Alter `public.messages.sender` column, including a robust way to drop the old CHECK constraint.
    *   Add comments.
2.  **Use `create_file_with_block`** to save the script to `synchat-ai-backend/supabase/migrations/` with the chosen timestamp.
