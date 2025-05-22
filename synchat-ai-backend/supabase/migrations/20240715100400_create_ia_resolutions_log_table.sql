-- Supabase Migration: Create ia_resolutions_log table
-- Timestamp: 20240715100400

-- Ensure uuid-ossp extension is available for UUID foreign key types if not already enabled.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the ia_resolutions_log table
CREATE TABLE public.ia_resolutions_log (
    resolution_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL,
    conversation_id UUID, -- Nullable, as a resolution might not always be tied to a specific conversation
    resolved_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    billing_cycle_id TEXT, -- To group resolutions by billing cycle, e.g., "YYYY-MM"
    details JSONB, -- For storing specifics like user query and bot response summary

    CONSTRAINT fk_client
        FOREIGN KEY(client_id)
        REFERENCES public.synchat_clients(client_id)
        ON DELETE SET NULL, -- Keeps log even if client is deleted. Change to CASCADE if logs should be deleted with client.

    CONSTRAINT fk_conversation
        FOREIGN KEY(conversation_id)
        REFERENCES public.conversations(conversation_id)
        ON DELETE SET NULL -- Keeps log even if conversation is deleted. Change to CASCADE if logs should be deleted with conversation.
);

-- Add comments to the table and columns
COMMENT ON TABLE public.ia_resolutions_log IS 'Logs each instance of an AI resolution, potentially for analytics or billing.';
COMMENT ON COLUMN public.ia_resolutions_log.resolution_id IS 'Unique identifier for the resolution event.';
COMMENT ON COLUMN public.ia_resolutions_log.client_id IS 'The client for whom the resolution occurred. Foreign key to synchat_clients.';
COMMENT ON COLUMN public.ia_resolutions_log.conversation_id IS 'The conversation in which the resolution occurred, if applicable. Foreign key to conversations.';
COMMENT ON COLUMN public.ia_resolutions_log.resolved_at IS 'Timestamp of when the resolution occurred.';
COMMENT ON COLUMN public.ia_resolutions_log.billing_cycle_id IS 'Identifier for the billing cycle this resolution falls into (e.g., YYYY-MM).';
COMMENT ON COLUMN public.ia_resolutions_log.details IS 'JSONB field to store additional details about the resolution, such as a summary of the user query and bot response.';

-- Notes on ON DELETE behavior for Foreign Keys:
-- The current ON DELETE SET NULL behavior is chosen to preserve log integrity even if related entities are removed.
-- If a stricter data cleanup (deleting logs when clients/conversations are deleted) is required,
-- change the ON DELETE clause to ON DELETE CASCADE for the respective foreign key(s).

-- Optional: Example Indexes (Uncomment and adapt if needed based on query patterns)
-- CREATE INDEX idx_ia_resolutions_log_client_id ON public.ia_resolutions_log(client_id);
-- CREATE INDEX idx_ia_resolutions_log_conversation_id ON public.ia_resolutions_log(conversation_id);
-- CREATE INDEX idx_ia_resolutions_log_resolved_at ON public.ia_resolutions_log(resolved_at);
-- CREATE INDEX idx_ia_resolutions_log_billing_cycle_id ON public.ia_resolutions_log(billing_cycle_id);
-- For querying specific keys within the 'details' JSONB field:
-- CREATE INDEX idx_ia_resolutions_log_details_gin ON public.ia_resolutions_log USING GIN (details);
-- Or for specific path lookups if common:
-- CREATE INDEX idx_ia_resolutions_log_details_specific_key ON public.ia_resolutions_log USING GIN ((details->'specific_key'));
