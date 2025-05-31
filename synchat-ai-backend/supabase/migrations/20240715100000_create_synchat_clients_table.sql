-- Supabase Migration: Create synchat_clients table
-- Timestamp: 20240715100000

-- Ensure UUID functions are available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the synchat_clients table
CREATE TABLE public.synchat_clients (
    client_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    base_prompt_override TEXT,
    widget_config JSONB,
    knowledge_source_url TEXT,
    last_ingest_status TEXT,
    last_ingest_at TIMESTAMPTZ,
    subscription_id TEXT,
    subscription_status TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL, -- Ensuring created_at is NOT NULL
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL  -- Ensuring updated_at is NOT NULL
);

-- Add comments to the table and columns
COMMENT ON TABLE public.synchat_clients IS 'Stores client-specific configurations and metadata for the SynChat AI service.';
COMMENT ON COLUMN public.synchat_clients.client_id IS 'Unique identifier for the client, typically mirroring auth.users.id.';
COMMENT ON COLUMN public.synchat_clients.client_name IS 'Name of the client or organization.';
COMMENT ON COLUMN public.synchat_clients.email IS 'Contact email for the client, unique and linked to their authentication email.';
COMMENT ON COLUMN public.synchat_clients.base_prompt_override IS 'Client-specific override for the base AI prompt.';
COMMENT ON COLUMN public.synchat_clients.widget_config IS 'JSONB storing configuration for the chat widget appearance and behavior.';
COMMENT ON COLUMN public.synchat_clients.knowledge_source_url IS 'URL for the primary knowledge source to be ingested (e.g., sitemap, document URL).';
COMMENT ON COLUMN public.synchat_clients.last_ingest_status IS 'Status of the last knowledge source ingestion (e.g., pending, completed, failed).';
COMMENT ON COLUMN public.synchat_clients.last_ingest_at IS 'Timestamp of the last successful or attempted knowledge source ingestion.';
COMMENT ON COLUMN public.synchat_clients.subscription_id IS 'Identifier for the client''s subscription in a payment gateway (e.g., Stripe Subscription ID).';
COMMENT ON COLUMN public.synchat_clients.subscription_status IS 'Current status of the client''s subscription (e.g., active, cancelled, past_due).';
COMMENT ON COLUMN public.synchat_clients.created_at IS 'Timestamp of when the client record was created.';
COMMENT ON COLUMN public.synchat_clients.updated_at IS 'Timestamp of when the client record was last updated.';

-- Trigger to execute the function before any update on synchat_clients table
CREATE TRIGGER on_synchat_clients_updated
BEFORE UPDATE ON public.synchat_clients
FOR EACH ROW
EXECUTE PROCEDURE public.handle_updated_at();

-- Notes on relationships to auth.users:
-- 1. client_id and auth.users.id:
--    This table assumes client_id might be linked to auth.users.id.
--    Enforcement of this link (e.g., via triggers or application logic)
--    is handled outside this basic schema definition.

-- 2. email and auth.users.email:
--    The UNIQUE constraint on synchat_clients.email ensures data integrity
--    within this table. Synchronization with auth.users.email is an
--    application-level or trigger-based concern.

-- Optional: Example Index (Uncomment if needed based on query patterns)
-- CREATE INDEX idx_synchat_clients_email ON public.synchat_clients(email);
-- CREATE INDEX idx_synchat_clients_subscription_status ON public.synchat_clients(subscription_status);
