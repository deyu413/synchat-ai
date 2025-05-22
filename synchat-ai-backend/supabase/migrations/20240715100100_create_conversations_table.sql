-- Supabase Migration: Create conversations table
-- Timestamp: 20240715100100

-- Ensure UUID functions are available for conversation_id default
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the conversations table
CREATE TABLE public.conversations (
    conversation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL, -- Ensuring created_at is NOT NULL
    last_message_at TIMESTAMPTZ, -- Nullable, updated by application logic
    status TEXT, -- e.g., 'open', 'closed_by_user', 'resolved_by_ia', 'archived'

    CONSTRAINT fk_client
        FOREIGN KEY(client_id)
        REFERENCES public.synchat_clients(client_id)
        ON DELETE CASCADE -- If a client is deleted, their conversations are also deleted.
);

-- Add comments to the table and columns
COMMENT ON TABLE public.conversations IS 'Stores individual chat conversations initiated by users with clients.';
COMMENT ON COLUMN public.conversations.conversation_id IS 'Unique identifier for the conversation.';
COMMENT ON COLUMN public.conversations.client_id IS 'Identifier of the client to whom this conversation belongs. Foreign key to synchat_clients.';
COMMENT ON COLUMN public.conversations.created_at IS 'Timestamp of when the conversation was created.';
COMMENT ON COLUMN public.conversations.last_message_at IS 'Timestamp of the last message (either user or bot) in this conversation.';
COMMENT ON COLUMN public.conversations.status IS 'Current status of the conversation (e.g., open, closed_by_user, resolved_by_ia, archived).';

-- Note on status column:
-- Consider using an ENUM type if your PostgreSQL version supports it and you have a fixed set of statuses:
-- CREATE TYPE public.conversation_status_enum AS ENUM ('open', 'closed_by_user', 'resolved_by_ia', 'archived');
-- And then define the column as: status public.conversation_status_enum;
-- (Ensure the ENUM type is created in a separate, earlier migration or in this one before the table if preferred)

-- Optional: Example Indexes (Uncomment and adapt if needed based on query patterns)
-- CREATE INDEX idx_conversations_client_id ON public.conversations(client_id);
-- CREATE INDEX idx_conversations_created_at ON public.conversations(created_at);
-- CREATE INDEX idx_conversations_last_message_at ON public.conversations(last_message_at);
-- CREATE INDEX idx_conversations_status ON public.conversations(status);
