-- Function to update 'updated_at' timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create conversation_analytics table
CREATE TABLE public.conversation_analytics (
    analytics_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.conversations(conversation_id) ON DELETE CASCADE,
    total_messages INT,
    user_messages INT,
    bot_messages INT,
    agent_messages INT,
    first_message_at TIMESTAMPTZ,
    last_message_at TIMESTAMPTZ,
    conversation_duration INTERVAL, -- Calculated as (last_message_at - first_message_at)
    resolution_status TEXT, -- e.g., 'resolved_by_ia', 'escalated_to_human', 'closed_by_agent'
    escalation_timestamp TIMESTAMPTZ NULL, -- When it was escalated, if applicable
    feedback_score SMALLINT NULL, -- Average feedback score for the conversation, or last feedback
    tags TEXT[] NULL, -- For categorization
    summary TEXT NULL, -- LLM-generated summary of the conversation
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Comment on table and columns
COMMENT ON TABLE public.conversation_analytics IS 'Stores aggregated analytics and metrics for each conversation.';
COMMENT ON COLUMN public.conversation_analytics.total_messages IS 'Total number of messages in the conversation.';
COMMENT ON COLUMN public.conversation_analytics.resolution_status IS 'Final status indicating how the conversation was resolved.';
COMMENT ON COLUMN public.conversation_analytics.feedback_score IS 'Aggregated feedback score if available.';
COMMENT ON COLUMN public.conversation_analytics.summary IS 'AI-generated summary of the conversation topic and resolution.';

-- Trigger to automatically update 'updated_at' timestamp
CREATE TRIGGER set_updated_at_on_conversation_analytics
BEFORE UPDATE ON public.conversation_analytics
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Enable Row Level Security
ALTER TABLE public.conversation_analytics ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow service_role full access.
-- Granular access for clients/agents to view analytics can be added later if needed.
CREATE POLICY "Allow service_role full access to conversation_analytics"
ON public.conversation_analytics
FOR ALL
USING (true) -- Or restrict to specific roles if needed
WITH CHECK (true); -- Or restrict to specific roles

-- Indexes for performance
CREATE INDEX idx_conversation_analytics_client_id_created_at ON public.conversation_analytics(client_id, created_at DESC);
CREATE INDEX idx_conversation_analytics_conversation_id ON public.conversation_analytics(conversation_id);
CREATE INDEX idx_conversation_analytics_resolution_status ON public.conversation_analytics(resolution_status);
CREATE INDEX idx_conversation_analytics_tags ON public.conversation_analytics USING GIN (tags); -- Example for array searching
