-- Add query_embedding column to rag_interaction_logs table
ALTER TABLE public.rag_interaction_logs
ADD COLUMN query_embedding VECTOR(1536);

COMMENT ON COLUMN public.rag_interaction_logs.query_embedding IS 'Embedding of the user_query, used for topic/intent clustering.';
