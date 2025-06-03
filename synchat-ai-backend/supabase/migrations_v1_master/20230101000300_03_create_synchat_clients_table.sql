-- Define the public.synchat_clients table

CREATE TABLE IF NOT EXISTS public.synchat_clients (
    client_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    base_prompt_override TEXT NULL,
    widget_config JSONB NULL,
    knowledge_source_url TEXT NULL,     -- From original schema and JS usage
    last_ingest_status TEXT NULL,       -- From original schema and JS usage
    last_ingest_at TIMESTAMPTZ NULL,    -- From original schema and JS usage
    stripe_customer_id TEXT NULL,       -- Implied by paymentsController.js
    subscription_id TEXT NULL,          -- From original schema and paymentsController.js
    subscription_status TEXT NULL,      -- From original schema and paymentsController.js
    subscription_current_period_end TIMESTAMPTZ NULL, -- Implied by paymentsController.js
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.synchat_clients IS 'Stores client-specific configurations and metadata for the SynChat AI service.';
COMMENT ON COLUMN public.synchat_clients.client_id IS 'Unique identifier for the client, typically mirroring auth.users.id.';
COMMENT ON COLUMN public.synchat_clients.client_name IS 'Name of the client or organization.';
COMMENT ON COLUMN public.synchat_clients.email IS 'Contact email for the client, unique and linked to their authentication email.';
COMMENT ON COLUMN public.synchat_clients.base_prompt_override IS 'Client-specific override for the base AI prompt.';
COMMENT ON COLUMN public.synchat_clients.widget_config IS 'JSONB storing configuration for the chat widget appearance and behavior.';
COMMENT ON COLUMN public.synchat_clients.knowledge_source_url IS 'URL for the primary knowledge source to be ingested (e.g., sitemap, document URL).';
COMMENT ON COLUMN public.synchat_clients.last_ingest_status IS 'Status of the last knowledge source ingestion (e.g., pending, completed, failed).';
COMMENT ON COLUMN public.synchat_clients.last_ingest_at IS 'Timestamp of the last successful or attempted knowledge source ingestion.';
COMMENT ON COLUMN public.synchat_clients.stripe_customer_id IS 'Stripe Customer ID for billing.';
COMMENT ON COLUMN public.synchat_clients.subscription_id IS 'Identifier for the client''s subscription in Stripe.';
COMMENT ON COLUMN public.synchat_clients.subscription_status IS 'Current status of the client''s subscription (e.g., active, cancelled, past_due).';
COMMENT ON COLUMN public.synchat_clients.subscription_current_period_end IS 'End date of the current billing period for the subscription.';
COMMENT ON COLUMN public.synchat_clients.created_at IS 'Timestamp of when the client record was created.';
COMMENT ON COLUMN public.synchat_clients.updated_at IS 'Timestamp of when the client record was last updated.';

-- Trigger to automatically update updated_at timestamp
CREATE TRIGGER on_synchat_clients_updated
BEFORE UPDATE ON public.synchat_clients
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at(); -- Uses the consolidated helper function
