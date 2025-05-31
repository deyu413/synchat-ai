-- Add columns to analyzed_conversation_topics for embedding-based clustering details

ALTER TABLE public.analyzed_conversation_topics
ADD COLUMN IF NOT EXISTS topic_generation_method TEXT NULL,
ADD COLUMN IF NOT EXISTS cluster_id_internal TEXT NULL; -- Storing K-Means clusterId as TEXT, can be numeric if always integer

COMMENT ON COLUMN public.analyzed_conversation_topics.topic_generation_method IS 'Method used to generate this topic (e.g., ''normalized_grouping'', ''embedding_kmeans'').';
COMMENT ON COLUMN public.analyzed_conversation_topics.cluster_id_internal IS 'Internal cluster identifier from the clustering algorithm (e.g., K-Means cluster index).';

-- The existing 'normalized_query_text' column will now store a representative query or LLM-generated topic name if method is 'embedding_kmeans'.
-- No change to its definition, but its usage is noted.
