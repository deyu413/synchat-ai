-- Define the public.rag_interaction_logs table

CREATE TABLE IF NOT EXISTS public.rag_interaction_logs (
    log_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    conversation_id UUID NULL REFERENCES public.conversations(conversation_id) ON DELETE SET NULL,
    user_query TEXT NULL,
    retrieved_context JSONB NULL, -- Store array of {chunk_id, content_preview, score, metadata}
    final_prompt_to_llm TEXT NULL,
    llm_response TEXT NULL,
    response_timestamp TIMESTAMPTZ DEFAULT now() NOT NULL,
    query_embeddings_used JSONB NULL, -- Store embeddings of original and reformulated queries (Added by 20250531031633)
    vector_search_params JSONB NULL,
    was_escalated BOOLEAN DEFAULT FALSE,
    query_embedding VECTOR(1536) NULL, -- Added by 20250531031633
    topic_analysis_processed_at TIMESTAMPTZ NULL, -- Added by 20250531043535
    predicted_query_category TEXT NULL -- Added by 20250531060307
);

-- Comments
COMMENT ON TABLE public.rag_interaction_logs IS 'Logs details of each RAG pipeline execution, including queries, retrieved context, LLM interactions, and outcomes.';
COMMENT ON COLUMN public.rag_interaction_logs.log_id IS 'Unique identifier for the RAG interaction log entry.';
COMMENT ON COLUMN public.rag_interaction_logs.client_id IS 'Client associated with this RAG interaction.';
COMMENT ON COLUMN public.rag_interaction_logs.conversation_id IS 'Conversation associated with this RAG interaction, if applicable.';
COMMENT ON COLUMN public.rag_interaction_logs.user_query IS 'The initial or effective user query that triggered the RAG pipeline.';
COMMENT ON COLUMN public.rag_interaction_logs.retrieved_context IS 'JSONB array of context chunks retrieved and considered by the RAG pipeline.';
COMMENT ON COLUMN public.rag_interaction_logs.final_prompt_to_llm IS 'The final assembled prompt sent to the LLM.';
COMMENT ON COLUMN public.rag_interaction_logs.llm_response IS 'The response received from the LLM.';
COMMENT ON COLUMN public.rag_interaction_logs.response_timestamp IS 'Timestamp of when the LLM response was received or interaction concluded.';
COMMENT ON COLUMN public.rag_interaction_logs.query_embeddings_used IS 'JSONB storing embeddings or identifiers of queries used in the vector search stage.';
COMMENT ON COLUMN public.rag_interaction_logs.vector_search_params IS 'JSONB storing parameters used for the vector search (thresholds, weights, etc.).';
COMMENT ON COLUMN public.rag_interaction_logs.was_escalated IS 'Boolean indicating if this interaction led to an escalation.';
COMMENT ON COLUMN public.rag_interaction_logs.query_embedding IS 'Embedding of the user_query, used for topic/intent clustering.';
COMMENT ON COLUMN public.rag_interaction_logs.topic_analysis_processed_at IS 'Timestamp indicating when this log entry was last processed for topic analysis.';
COMMENT ON COLUMN public.rag_interaction_logs.predicted_query_category IS 'The category predicted for the user_query by query classification.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rag_logs_client_id_timestamp ON public.rag_interaction_logs(client_id, response_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rag_logs_conversation_id ON public.rag_interaction_logs(conversation_id WHERE conversation_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rag_logs_topic_analysis_processed_at_null ON public.rag_interaction_logs(topic_analysis_processed_at) WHERE topic_analysis_processed_at IS NULL;
-- This index was idx_rag_logs_client_response_ts in 20250531055946_optimize_analytics_indexes.sql, it is functionally the same as idx_rag_logs_client_id_timestamp
-- CREATE INDEX IF NOT EXISTS idx_rag_logs_predicted_category ON public.rag_interaction_logs(predicted_query_category) WHERE predicted_query_category IS NOT NULL;

-- RLS will be applied in a subsequent, dedicated RLS migration file for clarity if needed, or here.
-- For now, enabling basic RLS and then specific policies will be added later.
ALTER TABLE public.rag_interaction_logs ENABLE ROW LEVEL SECURITY;
-- Default RLS policy (clients can manage their own logs) will be added in the RLS-focused migration.
