-- Define the public.conversations table

CREATE TABLE IF NOT EXISTS public.conversations (
    conversation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    last_message_at TIMESTAMPTZ NULL,
    status public.conversation_status_type DEFAULT 'open'::public.conversation_status_type, -- Changed to ENUM by 20240729100000
    assigned_agent_id UUID NULL,      -- Added by 20240729100000
    last_agent_message_at TIMESTAMPTZ NULL, -- Added by 20240729100000
    last_message_preview VARCHAR(255) NULL -- Added by 20240729100000
    -- updated_at is NOT typically on conversations table unless specific need; last_message_at serves similar purpose for activity.
    -- If an updated_at column is truly needed and managed by a trigger, it should be added here.
    -- For now, sticking to the schema derived from provided files.
);

-- Comments
COMMENT ON TABLE public.conversations IS 'Stores individual chat conversations initiated by users with clients. Includes fields for shared inbox functionality.';
COMMENT ON COLUMN public.conversations.conversation_id IS 'Unique identifier for the conversation.';
COMMENT ON COLUMN public.conversations.client_id IS 'Identifier of the client to whom this conversation belongs. Foreign key to synchat_clients.';
COMMENT ON COLUMN public.conversations.created_at IS 'Timestamp of when the conversation was created.';
COMMENT ON COLUMN public.conversations.last_message_at IS 'Timestamp of the last message (user, bot, or agent) in this conversation. Updated by a trigger on the messages table.';
COMMENT ON COLUMN public.conversations.status IS 'Current status of the conversation, uses the conversation_status_type ENUM. Default is ''open''.';
COMMENT ON COLUMN public.conversations.assigned_agent_id IS 'UUID of the agent (auth.users) assigned to handle this conversation. Null if unassigned.';
COMMENT ON COLUMN public.conversations.last_agent_message_at IS 'Timestamp of the last message sent by a human agent in this conversation.';
COMMENT ON COLUMN public.conversations.last_message_preview IS 'A short text preview (up to 255 characters) of the most recent message in the conversation.';

-- Indexes (add any other relevant ones based on query patterns)
CREATE INDEX IF NOT EXISTS idx_conversations_client_id ON public.conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON public.conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_agent_id ON public.conversations(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON public.conversations(last_message_at DESC NULLS LAST); -- For sorting by recent activity

RAISE NOTICE 'Table public.conversations created with ENUM status and shared inbox fields.';
