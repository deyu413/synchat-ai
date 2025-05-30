CREATE TABLE public.rag_interaction_logs (
    log_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.conversations(conversation_id) ON DELETE SET NULL,
    user_query TEXT,
    retrieved_context JSONB, -- Store array of {chunk_id, content_preview, score, metadata}
    final_prompt_to_llm TEXT, -- The full prompt including system, history, RAG context
    llm_response TEXT,
    response_timestamp TIMESTAMPTZ DEFAULT now(),
    query_embeddings_used JSONB NULL, -- Store embeddings of original and reformulated queries
    vector_search_params JSONB NULL, -- Store thresholds, weights used
    was_escalated BOOLEAN DEFAULT FALSE
);

ALTER TABLE public.rag_interaction_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies:
-- For now, restrict to service_role or specific admin roles.
-- Clients should not directly access these logs via API unless specifically designed.
CREATE POLICY "Allow service_role full access to RAG logs"
ON public.rag_interaction_logs FOR ALL
USING (true) -- Or restrict to specific roles if needed
WITH CHECK (true); -- Or restrict to specific roles

-- Optional: Indexes
CREATE INDEX idx_rag_logs_client_id_timestamp ON public.rag_interaction_logs(client_id, response_timestamp DESC);
CREATE INDEX idx_rag_logs_conversation_id ON public.rag_interaction_logs(conversation_id);
