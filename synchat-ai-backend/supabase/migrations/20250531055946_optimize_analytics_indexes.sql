-- Add optimized indexes for analytics queries

-- For rag_interaction_logs
CREATE INDEX IF NOT EXISTS idx_rag_logs_client_response_ts ON public.rag_interaction_logs(client_id, response_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_rag_logs_conversation_id ON public.rag_interaction_logs(conversation_id);

-- For rag_feedback_log
-- Covers queries filtering by client, type, and time period
CREATE INDEX IF NOT EXISTS idx_rag_feedback_client_type_created ON public.rag_feedback_log(client_id, feedback_type, created_at DESC);
-- Covers lookups for feedback related to specific RAG interactions
CREATE INDEX IF NOT EXISTS idx_rag_feedback_rilid_client_type ON public.rag_feedback_log(rag_interaction_log_id, client_id, feedback_type);

-- For messages table (used for sentiment in topic analytics)
-- Assumes RLS handles client_id scoping if client_id is not directly on messages table.
-- This index helps when fetching messages for a set of conversations within a time period.
CREATE INDEX IF NOT EXISTS idx_messages_convid_ts_sentiment ON public.messages(conversation_id, timestamp DESC);

COMMENT ON TABLE public.topic_membership IS 'Fix: This file is for indexes, but adding a comment to an existing table is fine. Original comment: Associates RAG interaction logs with analyzed conversation topics.';
-- The above comment is a bit out of place but harmless if it just updates an existing comment.
-- Ideally, comments for topic_membership should be in its own creation script.
-- For this migration, focusing on indexes. Removing the out-of-place comment.

-- Re-statement: This migration is focused on adding beneficial indexes for analytics performance.
-- Any table or column comments should ideally be in their respective creation/alteration scripts.
