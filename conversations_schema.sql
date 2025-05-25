-- Schema for the conversations table
-- This table stores information about individual chat conversations.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Ensure UUID functions are available

CREATE TABLE public.conversations (
    conversation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_message_at TIMESTAMPTZ,
    status TEXT, -- e.g., 'open', 'closed_by_user', 'resolved_by_ia', 'archived'

    CONSTRAINT fk_client
        FOREIGN KEY(client_id)
        REFERENCES public.synchat_clients(client_id)
        ON DELETE CASCADE -- If a client is deleted, their conversations are also deleted.
);

-- Optional: Add an index on client_id for faster lookups if you frequently query conversations by client.
-- CREATE INDEX idx_conversations_client_id ON public.conversations(client_id);

-- Optional: Add an index on created_at or last_message_at if you sort or filter by these often.
-- CREATE INDEX idx_conversations_created_at ON public.conversations(created_at);
-- CREATE INDEX idx_conversations_last_message_at ON public.conversations(last_message_at);

-- Note on status:
-- The 'status' column can be used to track the state of a conversation.
-- Consider using an ENUM type if your PostgreSQL version supports it and you have a fixed set of statuses:
-- CREATE TYPE conversation_status AS ENUM ('open', 'closed_by_user', 'resolved_by_ia', 'archived');
-- And then define the column as: status conversation_status;

COMMENT ON TABLE public.conversations IS 'Stores individual chat conversations initiated by users with clients.';
COMMENT ON COLUMN public.conversations.conversation_id IS 'Unique identifier for the conversation.';
COMMENT ON COLUMN public.conversations.client_id IS 'Identifier of the client to whom this conversation belongs. Foreign key to synchat_clients.';
COMMENT ON COLUMN public.conversations.created_at IS 'Timestamp of when the conversation was created.';
COMMENT ON COLUMN public.conversations.last_message_at IS 'Timestamp of the last message (either user or bot) in this conversation.';
COMMENT ON COLUMN public.conversations.status IS 'Current status of the conversation (e.g., open, closed_by_user, resolved_by_ia, archived).';
