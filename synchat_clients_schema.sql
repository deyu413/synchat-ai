-- Schema for the synchat_clients table
-- This table stores information about clients using the SynChat AI service.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Ensure UUID functions are available

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
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Notes on relationships to auth.users:
-- 1. client_id and auth.users.id:
--    Ideally, client_id should be a foreign key referencing auth.users.id.
--    However, auth.users is in a separate schema and direct FK constraints
--    from public.synchat_clients to auth.users might be restricted or require
--    special setup (e.g., security definer functions or triggers).
--    This relationship might need to be enforced at the application layer or
--    through Supabase policies and a trigger that copies the auth.users.id
--    upon user creation into this table.

-- 2. email and auth.users.email:
--    Similarly, enforcing a direct FK for email to auth.users.email is complex
--    due to schema differences. The UNIQUE constraint on synchat_clients.email
--    helps maintain data integrity within this table. Synchronization or
--    validation against auth.users.email would typically be handled at the
--    application level or via triggers/policies.

-- Note on updated_at:
-- To automatically update the updated_at column on row changes,
-- a trigger function is commonly used in PostgreSQL.
-- Example:
--
-- CREATE OR REPLACE FUNCTION public.handle_updated_at()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.updated_at = now();
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
--
-- CREATE TRIGGER on_synchat_clients_updated
-- BEFORE UPDATE ON public.synchat_clients
-- FOR EACH ROW
-- EXECUTE PROCEDURE public.handle_updated_at();

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
