-- Schema for the messages table
-- This table stores individual messages within each conversation.

-- Optional: Define an ENUM type for sender if you want to strictly limit its values.
-- CREATE TYPE public.message_sender AS ENUM ('user', 'bot');

CREATE TABLE public.messages (
    message_id BIGSERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL,
    -- sender message_sender NOT NULL, -- Use this line if using the ENUM type above
    sender TEXT NOT NULL CHECK (sender IN ('user', 'bot')), -- Enforces specific values for sender
    content TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT now() NOT NULL,

    CONSTRAINT fk_conversation
        FOREIGN KEY(conversation_id)
        REFERENCES public.conversations(conversation_id)
        ON DELETE CASCADE -- If a conversation is deleted, its messages are also deleted.
);

-- Optional: Add an index on conversation_id for faster retrieval of messages for a specific conversation.
-- CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);

-- Optional: Add an index on timestamp if you frequently sort or filter messages by time.
-- CREATE INDEX idx_messages_timestamp ON public.messages(timestamp);

COMMENT ON TABLE public.messages IS 'Stores individual messages exchanged within a conversation.';
COMMENT ON COLUMN public.messages.message_id IS 'Unique identifier for the message, auto-incrementing.';
COMMENT ON COLUMN public.messages.conversation_id IS 'Identifier of the conversation to which this message belongs. Foreign key to conversations.';
COMMENT ON COLUMN public.messages.sender IS 'Indicates who sent the message: ''user'' or ''bot''.';
COMMENT ON COLUMN public.messages.content IS 'The textual content of the message.';
COMMENT ON COLUMN public.messages.timestamp IS 'Timestamp of when the message was sent/created.';

-- Note on sender column:
-- While TEXT with a CHECK constraint is used here as specified for flexibility,
-- using an ENUM type (as commented out above the table definition)
-- can offer better type safety and potentially minor performance benefits if the set of senders is fixed.
-- To use the ENUM:
-- 1. Uncomment the CREATE TYPE public.message_sender ... line.
-- 2. Change the sender column definition to: sender message_sender NOT NULL,
-- Removing the CHECK constraint as the ENUM type itself enforces the allowed values.
