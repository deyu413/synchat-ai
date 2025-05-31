-- Add topic_analysis_processed_at to rag_interaction_logs table
ALTER TABLE public.rag_interaction_logs
ADD COLUMN topic_analysis_processed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.rag_interaction_logs.topic_analysis_processed_at IS 'Timestamp indicating when this log entry was last processed for topic analysis and clustering.';

-- Optional: Add an index if queries will frequently filter by this column being NULL
CREATE INDEX IF NOT EXISTS idx_rag_logs_topic_analysis_processed_at_null
ON public.rag_interaction_logs(topic_analysis_processed_at)
WHERE topic_analysis_processed_at IS NULL;
