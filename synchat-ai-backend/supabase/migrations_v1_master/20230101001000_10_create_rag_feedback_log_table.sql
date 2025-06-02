-- Define the public.rag_feedback_log table

CREATE TABLE IF NOT EXISTS public.rag_feedback_log (
    feedback_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL, -- User providing feedback (e.g., an admin/agent)
    conversation_id UUID NULL REFERENCES public.conversations(conversation_id) ON DELETE SET NULL,
    message_id BIGINT NULL REFERENCES public.messages(message_id) ON DELETE SET NULL,
    rag_interaction_log_id BIGINT NULL REFERENCES public.rag_interaction_logs(log_id) ON DELETE SET NULL,
    knowledge_base_chunk_id BIGINT NULL REFERENCES public.knowledge_base(id) ON DELETE SET NULL,
    feedback_type TEXT NOT NULL, -- e.g., 'response_quality', 'chunk_relevance'
    rating SMALLINT NULL, -- e.g., 1 for positive, 0 for neutral, -1 for negative
    comment TEXT NULL,
    feedback_context JSONB NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Comments
COMMENT ON TABLE public.rag_feedback_log IS 'Stores feedback on RAG interactions, responses, and specific retrieved chunks.';
COMMENT ON COLUMN public.rag_feedback_log.feedback_id IS 'Unique identifier for the feedback entry.';
COMMENT ON COLUMN public.rag_feedback_log.client_id IS 'Client associated with this feedback.';
COMMENT ON COLUMN public.rag_feedback_log.user_id IS 'User (admin/agent from auth.users) who provided the feedback.';
COMMENT ON COLUMN public.rag_feedback_log.conversation_id IS 'Conversation related to the feedback, if applicable.';
COMMENT ON COLUMN public.rag_feedback_log.message_id IS 'Specific message being reviewed, if applicable.';
COMMENT ON COLUMN public.rag_feedback_log.rag_interaction_log_id IS 'RAG interaction log associated with the feedback.';
COMMENT ON COLUMN public.rag_feedback_log.knowledge_base_chunk_id IS 'Specific knowledge base chunk being reviewed, if applicable.';
COMMENT ON COLUMN public.rag_feedback_log.feedback_type IS 'Type of feedback (e.g., ''response_quality'', ''chunk_relevance'').';
COMMENT ON COLUMN public.rag_feedback_log.rating IS 'Numerical rating for the feedback (e.g., -1, 0, 1).';
COMMENT ON COLUMN public.rag_feedback_log.comment IS 'Textual comment provided with the feedback.';
COMMENT ON COLUMN public.rag_feedback_log.feedback_context IS 'JSONB storing any relevant context at the time of feedback (e.g., query, original response).';
COMMENT ON COLUMN public.rag_feedback_log.created_at IS 'Timestamp of when the feedback was created.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rag_feedback_client_id ON public.rag_feedback_log(client_id);
CREATE INDEX IF NOT EXISTS idx_rag_feedback_user_id ON public.rag_feedback_log(user_id WHERE user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rag_feedback_rag_interaction_log_id ON public.rag_feedback_log(rag_interaction_log_id WHERE rag_interaction_log_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rag_feedback_knowledge_base_chunk_id ON public.rag_feedback_log(knowledge_base_chunk_id WHERE knowledge_base_chunk_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rag_feedback_feedback_type ON public.rag_feedback_log(feedback_type);
CREATE INDEX IF NOT EXISTS idx_rag_feedback_client_type_created ON public.rag_feedback_log(client_id, feedback_type, created_at DESC);

RAISE NOTICE 'Table public.rag_feedback_log created with all necessary columns, FKs, comments, and indexes.';

-- RLS will be applied in a subsequent, dedicated RLS migration file.
ALTER TABLE public.rag_feedback_log ENABLE ROW LEVEL SECURITY;
