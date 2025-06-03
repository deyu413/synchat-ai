-- Define the public.ia_resolutions_log table

CREATE TABLE IF NOT EXISTS public.ia_resolutions_log (
    resolution_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE SET NULL, -- Or CASCADE depending on desired behavior
    conversation_id UUID NULL REFERENCES public.conversations(conversation_id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    billing_cycle_id TEXT NULL, -- e.g., "YYYY-MM"
    details JSONB NULL -- Specifics like user query and bot response summary
);

-- Comments
COMMENT ON TABLE public.ia_resolutions_log IS 'Logs each instance of an AI resolution, potentially for analytics or billing.';
COMMENT ON COLUMN public.ia_resolutions_log.resolution_id IS 'Unique identifier for the resolution event.';
COMMENT ON COLUMN public.ia_resolutions_log.client_id IS 'The client for whom the resolution occurred. Foreign key to synchat_clients.';
COMMENT ON COLUMN public.ia_resolutions_log.conversation_id IS 'The conversation in which the resolution occurred, if applicable. Foreign key to conversations.';
COMMENT ON COLUMN public.ia_resolutions_log.resolved_at IS 'Timestamp of when the resolution occurred.';
COMMENT ON COLUMN public.ia_resolutions_log.billing_cycle_id IS 'Identifier for the billing cycle this resolution falls into (e.g., YYYY-MM).';
COMMENT ON COLUMN public.ia_resolutions_log.details IS 'JSONB field to store additional details about the resolution, such as a summary of the user query and bot response.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ia_resolutions_log_client_id ON public.ia_resolutions_log(client_id);
CREATE INDEX IF NOT EXISTS idx_ia_resolutions_log_conversation_id ON public.ia_resolutions_log(conversation_id WHERE conversation_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ia_resolutions_log_resolved_at ON public.ia_resolutions_log(resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_ia_resolutions_log_billing_cycle_id ON public.ia_resolutions_log(billing_cycle_id WHERE billing_cycle_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ia_resolutions_log_details_gin ON public.ia_resolutions_log USING GIN (details) WHERE details IS NOT NULL;

-- RLS: By default, this table might be sensitive. Add policies as needed.
-- For now, enabling RLS and a restrictive default will be handled later or assumed service_role access.
ALTER TABLE public.ia_resolutions_log ENABLE ROW LEVEL SECURITY;
