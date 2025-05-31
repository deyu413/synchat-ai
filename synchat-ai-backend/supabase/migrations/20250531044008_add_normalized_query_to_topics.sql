-- Add normalized_query_text to analyzed_conversation_topics
ALTER TABLE public.analyzed_conversation_topics
ADD COLUMN normalized_query_text TEXT;

COMMENT ON COLUMN public.analyzed_conversation_topics.normalized_query_text IS 'The normalized version of the user queries that form this topic group.';

-- Add index for faster lookups based on normalized query
CREATE INDEX IF NOT EXISTS idx_analyzed_topics_client_normalized_query
ON public.analyzed_conversation_topics(client_id, normalized_query_text);
