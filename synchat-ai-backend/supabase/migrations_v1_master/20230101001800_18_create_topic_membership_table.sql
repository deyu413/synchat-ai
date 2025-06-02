-- Define the public.topic_membership table

CREATE TABLE IF NOT EXISTS public.topic_membership (
    topic_id BIGINT NOT NULL REFERENCES public.analyzed_conversation_topics(topic_id) ON DELETE CASCADE,
    rag_interaction_log_id BIGINT NOT NULL REFERENCES public.rag_interaction_logs(log_id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE, -- For easier cleanup/data management
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    CONSTRAINT pk_topic_membership PRIMARY KEY (topic_id, rag_interaction_log_id)
);

-- Comments
COMMENT ON TABLE public.topic_membership IS 'Associates RAG interaction logs with analyzed conversation topics.';
COMMENT ON COLUMN public.topic_membership.topic_id IS 'Foreign key to the analyzed_conversation_topics table.';
COMMENT ON COLUMN public.topic_membership.rag_interaction_log_id IS 'Foreign key to the rag_interaction_logs table.';
COMMENT ON COLUMN public.topic_membership.client_id IS 'Client ID, for data partitioning and to ensure cascade deletes if a client is removed.';
COMMENT ON COLUMN public.topic_membership.created_at IS 'Timestamp of when the association was created.';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_topic_membership_topic_id ON public.topic_membership(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_membership_rag_log_id ON public.topic_membership(rag_interaction_log_id);
CREATE INDEX IF NOT EXISTS idx_topic_membership_client_id ON public.topic_membership(client_id);

RAISE NOTICE 'Table public.topic_membership created with comments and indexes.';

-- RLS: Typically, this table would be managed by backend services.
-- Access policies can be defined if specific user roles need to query it directly.
ALTER TABLE public.topic_membership ENABLE ROW LEVEL SECURITY;
-- Default RLS policy (e.g., service_role access only) will be added in the RLS-focused migration.
