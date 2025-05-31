-- Create rag_feedback_log table
CREATE TABLE public.rag_feedback_log (
    feedback_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    conversation_id UUID NULL REFERENCES public.conversations(conversation_id) ON DELETE SET NULL,
    message_id BIGINT NULL REFERENCES public.messages(message_id) ON DELETE SET NULL,
    rag_interaction_log_id BIGINT NULL REFERENCES public.rag_interaction_logs(log_id) ON DELETE SET NULL,
    knowledge_base_chunk_id BIGINT NULL REFERENCES public.knowledge_base(id) ON DELETE SET NULL,
    -- knowledge_proposition_id BIGINT NULL REFERENCES public.knowledge_propositions(proposition_id) ON DELETE SET NULL, -- Removed due to missing table
    feedback_type TEXT NOT NULL,
    rating SMALLINT,
    comment TEXT NULL,
    feedback_context JSONB NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Add indexes
CREATE INDEX idx_rag_feedback_client_id ON public.rag_feedback_log(client_id);
CREATE INDEX idx_rag_feedback_user_id ON public.rag_feedback_log(user_id);
CREATE INDEX idx_rag_feedback_rag_interaction_log_id ON public.rag_feedback_log(rag_interaction_log_id);
CREATE INDEX idx_rag_feedback_knowledge_base_chunk_id ON public.rag_feedback_log(knowledge_base_chunk_id);
CREATE INDEX idx_rag_feedback_feedback_type ON public.rag_feedback_log(feedback_type);

-- RLS Policies
ALTER TABLE public.rag_feedback_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to insert their own feedback"
ON public.rag_feedback_log
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM synchat_clients WHERE synchat_clients.client_id = rag_feedback_log.client_id));

CREATE POLICY "Allow service_role to perform all operations"
ON public.rag_feedback_log
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow client admins to view feedback for their client_id"
ON public.rag_feedback_log
FOR SELECT
TO authenticated
USING (client_id = auth.uid());

COMMENT ON TABLE public.rag_feedback_log IS 'Stores feedback on RAG interactions and responses.';
COMMENT ON COLUMN public.rag_feedback_log.feedback_id IS 'Unique identifier for the feedback entry.';
COMMENT ON COLUMN public.rag_feedback_log.client_id IS 'Identifier of the client to whom this feedback belongs.';
COMMENT ON COLUMN public.rag_feedback_log.user_id IS 'Identifier of the user (admin/agent) providing the feedback.';
COMMENT ON COLUMN public.rag_feedback_log.conversation_id IS 'Identifier of the conversation, if feedback is related to a specific conversation.';
COMMENT ON COLUMN public.rag_feedback_log.message_id IS 'Identifier of the message, if feedback is on a specific Zoe message.';
COMMENT ON COLUMN public.rag_feedback_log.rag_interaction_log_id IS 'Identifier of the RAG interaction log, linking feedback to a RAG pipeline execution.';
COMMENT ON COLUMN public.rag_feedback_log.knowledge_base_chunk_id IS 'Identifier of the knowledge base chunk, if feedback is on a specific retrieved chunk.';
-- COMMENT ON COLUMN public.rag_feedback_log.knowledge_proposition_id IS 'Identifier of the knowledge proposition, if feedback is on a specific retrieved proposition.'; -- Removed due to missing table
COMMENT ON COLUMN public.rag_feedback_log.feedback_type IS 'Type of feedback (e.g., ''response_quality'', ''chunk_relevance'', ''proposition_relevance'').';
COMMENT ON COLUMN public.rag_feedback_log.rating IS 'Numerical rating (e.g., 1 for positive, 0 for neutral, -1 for negative; or a 1-5 scale).';
COMMENT ON COLUMN public.rag_feedback_log.comment IS 'Optional textual feedback from the user.';
COMMENT ON COLUMN public.rag_feedback_log.feedback_context IS 'JSONB object to store relevant context at the time of feedback (e.g., query, original response, chunk content).';
COMMENT ON COLUMN public.rag_feedback_log.created_at IS 'Timestamp of when the feedback was created.';
