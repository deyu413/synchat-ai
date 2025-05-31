-- Add predicted_query_category to rag_interaction_logs table
ALTER TABLE public.rag_interaction_logs
ADD COLUMN IF NOT EXISTS predicted_query_category TEXT NULL;

COMMENT ON COLUMN public.rag_interaction_logs.predicted_query_category IS 'The category predicted for the user_query by the query classification model. NULL if no prediction or not applicable.';

-- Optional: Index if this column will be frequently queried directly for analysis (less likely for a TEXT field with many unique values)
-- CREATE INDEX IF NOT EXISTS idx_rag_logs_predicted_category ON public.rag_interaction_logs(predicted_query_category);
