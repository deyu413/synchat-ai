-- Create topic_membership table
CREATE TABLE public.topic_membership (
    topic_id BIGINT NOT NULL,
    rag_interaction_log_id BIGINT NOT NULL,
    client_id UUID NOT NULL, -- For easier cleanup/data management if a client is deleted
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    CONSTRAINT pk_topic_membership PRIMARY KEY (topic_id, rag_interaction_log_id),
    CONSTRAINT fk_topic_membership_topic FOREIGN KEY (topic_id)
        REFERENCES public.analyzed_conversation_topics(topic_id) ON DELETE CASCADE,
    CONSTRAINT fk_topic_membership_rag_log FOREIGN KEY (rag_interaction_log_id)
        REFERENCES public.rag_interaction_logs(log_id) ON DELETE CASCADE,
    CONSTRAINT fk_topic_membership_client FOREIGN KEY (client_id)
        REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.topic_membership IS 'Associates RAG interaction logs with analyzed conversation topics.';
COMMENT ON COLUMN public.topic_membership.topic_id IS 'Foreign key to the analyzed topic.';
COMMENT ON COLUMN public.topic_membership.rag_interaction_log_id IS 'Foreign key to the RAG interaction log that belongs to this topic.';
COMMENT ON COLUMN public.topic_membership.client_id IS 'Client ID, for data partitioning and cascade deletes.';
COMMENT ON COLUMN public.topic_membership.created_at IS 'Timestamp of when the association was created.';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_topic_membership_topic_id ON public.topic_membership(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_membership_rag_log_id ON public.topic_membership(rag_interaction_log_id);
CREATE INDEX IF NOT EXISTS idx_topic_membership_client_id ON public.topic_membership(client_id);
