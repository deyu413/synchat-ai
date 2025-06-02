-- Define the public.messages table

CREATE TABLE IF NOT EXISTS public.messages (
    message_id BIGSERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES public.conversations(conversation_id) ON DELETE CASCADE,
    sender public.message_sender_type NOT NULL, -- Changed to ENUM by 20240729100000
    content TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ DEFAULT now() NOT NULL, -- Quoted to avoid conflict if 'timestamp' is a reserved keyword in some contexts
    agent_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL, -- Added by 20240729100000, FK to auth.users
    sentiment TEXT NULL, -- Added by 20250531031852
    rag_interaction_ref BIGINT NULL -- Foreign key constraint will be added later after rag_interaction_logs table is created
);

-- Comments
COMMENT ON TABLE public.messages IS 'Stores individual messages exchanged within a conversation, sent by users, bots, or agents.';
COMMENT ON COLUMN public.messages.message_id IS 'Unique identifier for the message, auto-incrementing.';
COMMENT ON COLUMN public.messages.conversation_id IS 'Identifier of the conversation to which this message belongs. Foreign key to conversations.';
COMMENT ON COLUMN public.messages.sender IS 'Indicates who sent the message, using the message_sender_type ENUM (user, bot, or agent).';
COMMENT ON COLUMN public.messages.content IS 'The textual content of the message.';
COMMENT ON COLUMN public.messages."timestamp" IS 'Timestamp of when the message was sent/created.';
COMMENT ON COLUMN public.messages.agent_user_id IS 'Identifier of the agent (from auth.users) who sent this message, if sender is ''agent''.';
COMMENT ON COLUMN public.messages.sentiment IS 'Sentiment of the message (e.g., positive, negative, neutral), typically classified for user messages.';
COMMENT ON COLUMN public.messages.rag_interaction_ref IS 'Reference to the RAG interaction log entry that may have generated this message (if it is a bot message). Constraint added separately.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON public.messages("timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_messages_agent_user_id ON public.messages(agent_user_id) WHERE agent_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sentiment ON public.messages(sentiment) WHERE sentiment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_rag_interaction_ref ON public.messages(rag_interaction_ref) WHERE rag_interaction_ref IS NOT NULL;

RAISE NOTICE 'Table public.messages created with ENUM sender and new reference/analytics columns. FK for rag_interaction_ref will be added in a later migration.';
