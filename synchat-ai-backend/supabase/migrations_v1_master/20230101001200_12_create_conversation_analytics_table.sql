-- Define the public.conversation_analytics table

CREATE TABLE IF NOT EXISTS public.conversation_analytics (
    analytics_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(conversation_id) ON DELETE CASCADE,
    total_messages INT NULL,
    user_messages INT NULL,
    bot_messages INT NULL,
    agent_messages INT NULL,
    first_message_at TIMESTAMPTZ NULL,
    last_message_at TIMESTAMPTZ NULL,
    conversation_duration INTERVAL NULL, -- Calculated as (last_message_at - first_message_at)
    resolution_status TEXT NULL, -- e.g., 'resolved_by_ia', 'escalated_to_human', 'closed_by_agent'
    escalation_timestamp TIMESTAMPTZ NULL, -- When it was escalated, if applicable
    feedback_score SMALLINT NULL, -- Average feedback score for the conversation, or last feedback
    tags TEXT[] NULL, -- For categorization
    summary TEXT NULL, -- LLM-generated summary of the conversation
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Comments
COMMENT ON TABLE public.conversation_analytics IS 'Stores aggregated analytics and metrics for each conversation.';
COMMENT ON COLUMN public.conversation_analytics.analytics_id IS 'Unique identifier for the analytics entry.';
COMMENT ON COLUMN public.conversation_analytics.client_id IS 'Client associated with the conversation analytics.';
COMMENT ON COLUMN public.conversation_analytics.conversation_id IS 'Conversation being analyzed. Unique constraint should exist if one analytic record per convo.';
COMMENT ON COLUMN public.conversation_analytics.total_messages IS 'Total number of messages in the conversation.';
COMMENT ON COLUMN public.conversation_analytics.user_messages IS 'Number of messages sent by the user.';
COMMENT ON COLUMN public.conversation_analytics.bot_messages IS 'Number of messages sent by the bot.';
COMMENT ON COLUMN public.conversation_analytics.agent_messages IS 'Number of messages sent by human agents.';
COMMENT ON COLUMN public.conversation_analytics.first_message_at IS 'Timestamp of the first message in the conversation.';
COMMENT ON COLUMN public.conversation_analytics.last_message_at IS 'Timestamp of the last message in the conversation.';
COMMENT ON COLUMN public.conversation_analytics.conversation_duration IS 'Calculated duration of the conversation.';
COMMENT ON COLUMN public.conversation_analytics.resolution_status IS 'Final status indicating how the conversation was resolved.';
COMMENT ON COLUMN public.conversation_analytics.escalation_timestamp IS 'Timestamp if the conversation was escalated to a human agent.';
COMMENT ON COLUMN public.conversation_analytics.feedback_score IS 'Aggregated feedback score for the conversation, if available.';
COMMENT ON COLUMN public.conversation_analytics.tags IS 'Array of tags for categorizing the conversation (e.g., ''bot_cannot_answer'').';
COMMENT ON COLUMN public.conversation_analytics.summary IS 'AI-generated summary of the conversation topic and resolution.';
COMMENT ON COLUMN public.conversation_analytics.updated_at IS 'Timestamp of the last update to this analytics record.';
COMMENT ON COLUMN public.conversation_analytics.created_at IS 'Timestamp of when this analytics record was created.';

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_on_conversation_analytics
BEFORE UPDATE ON public.conversation_analytics
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversation_analytics_client_id_created_at ON public.conversation_analytics(client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_analytics_conversation_id ON public.conversation_analytics(conversation_id); -- Ensuring one analytics entry per conversation
CREATE INDEX IF NOT EXISTS idx_conversation_analytics_resolution_status ON public.conversation_analytics(resolution_status WHERE resolution_status IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_conversation_analytics_tags ON public.conversation_analytics USING GIN (tags) WHERE tags IS NOT NULL;

RAISE NOTICE 'Table public.conversation_analytics created with comments, trigger, and indexes.';

-- RLS will be applied in a subsequent, dedicated RLS migration file.
ALTER TABLE public.conversation_analytics ENABLE ROW LEVEL SECURITY;
