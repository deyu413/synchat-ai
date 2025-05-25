-- Supabase Migration: Create messages table
-- Timestamp: 20240715100200

-- Create the messages table
CREATE TABLE public.messages (
    message_id BIGSERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL,
    sender TEXT NOT NULL CHECK (sender IN ('user', 'bot')), -- Enforces specific values for sender
    content TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT now() NOT NULL,

    CONSTRAINT fk_conversation
        FOREIGN KEY(conversation_id)
        REFERENCES public.conversations(conversation_id)
        ON DELETE CASCADE -- If a conversation is deleted, its messages are also deleted.
);

-- Add comments to the table and columns
COMMENT ON TABLE public.messages IS 'Stores individual messages exchanged within a conversation.';
COMMENT ON COLUMN public.messages.message_id IS 'Unique identifier for the message, auto-incrementing.';
COMMENT ON COLUMN public.messages.conversation_id IS 'Identifier of the conversation to which this message belongs. Foreign key to conversations.';
COMMENT ON COLUMN public.messages.sender IS 'Indicates who sent the message: ''user'' or ''bot''.';
COMMENT ON COLUMN public.messages.content IS 'The textual content of the message.';
COMMENT ON COLUMN public.messages.timestamp IS 'Timestamp of when the message was sent/created.';

-- Note on sender column:
-- While TEXT with a CHECK constraint is used here as specified for flexibility,
-- using an ENUM type (e.g., CREATE TYPE public.message_sender_enum AS ENUM ('user', 'bot');)
-- can offer better type safety if the set of senders is fixed.
-- If using ENUM, the column definition would change to: sender public.message_sender_enum NOT NULL,
-- and the CHECK constraint would be removed. The ENUM type should be created in a separate,
-- earlier migration or at the beginning of this script if preferred and not already existing.

-- Optional: Example Indexes (Uncomment and adapt if needed based on query patterns)
-- CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
-- CREATE INDEX idx_messages_timestamp ON public.messages(timestamp);
