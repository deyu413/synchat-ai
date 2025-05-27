-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Define the public.knowledge_sources table
CREATE TABLE public.knowledge_sources (
    source_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL,
    source_type TEXT NOT NULL,
    source_name TEXT NOT NULL,
    storage_path TEXT,
    content_text TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded',
    character_count INT,
    last_ingest_at TIMESTAMPTZ,
    last_ingest_error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT fk_client
        FOREIGN KEY(client_id)
        REFERENCES public.synchat_clients(client_id)
        ON DELETE CASCADE
);

-- Apply the trigger to update updated_at on row update
CREATE TRIGGER set_timestamp
BEFORE UPDATE ON public.knowledge_sources
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

-- Add indexes for performance
CREATE INDEX idx_knowledge_sources_client_id ON public.knowledge_sources(client_id);
CREATE INDEX idx_knowledge_sources_status ON public.knowledge_sources(status);

-- Add comments to the table and columns for better understanding
COMMENT ON TABLE public.knowledge_sources IS 'Stores information about various knowledge sources used by clients, such as URLs, PDFs, text files, or articles.';
COMMENT ON COLUMN public.knowledge_sources.source_id IS 'Unique identifier for the knowledge source.';
COMMENT ON COLUMN public.knowledge_sources.client_id IS 'Identifier of the client who owns this knowledge source. Foreign key to public.synchat_clients.';
COMMENT ON COLUMN public.knowledge_sources.source_type IS 'Type of the knowledge source (e.g., ''url'', ''pdf'', ''txt'', ''article'').';
COMMENT ON COLUMN public.knowledge_sources.source_name IS 'Name of the knowledge source (e.g., file name, article title, URL).';
COMMENT ON COLUMN public.knowledge_sources.storage_path IS 'Path to the file in Supabase Storage (for file-based sources).';
COMMENT ON COLUMN public.knowledge_sources.content_text IS 'Text content of the source, if applicable (e.g., for ''article'' type).';
COMMENT ON COLUMN public.knowledge_sources.status IS 'Current status of the knowledge source (e.g., ''uploaded'', ''pending_ingest'', ''ingesting'', ''completed'', ''failed_ingest'').';
COMMENT ON COLUMN public.knowledge_sources.character_count IS 'Optional character count of the source content.';
COMMENT ON COLUMN public.knowledge_sources.last_ingest_at IS 'Timestamp of the last ingestion attempt.';
COMMENT ON COLUMN public.knowledge_sources.last_ingest_error IS 'Error message from the last failed ingestion attempt.';
COMMENT ON COLUMN public.knowledge_sources.created_at IS 'Timestamp of when the knowledge source was created.';
COMMENT ON COLUMN public.knowledge_sources.updated_at IS 'Timestamp of the last update to the knowledge source.';

-- Note: The public.synchat_clients table is assumed to exist.
-- If it doesn't, you'll need to create it before running this script.
-- Example for public.synchat_clients (if needed):
-- CREATE TABLE public.synchat_clients (
--     client_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     client_name TEXT NOT NULL,
--     created_at TIMESTAMPTZ DEFAULT now(),
--     updated_at TIMESTAMPTZ DEFAULT now()
-- );
-- CREATE TRIGGER set_timestamp_clients
-- BEFORE UPDATE ON public.synchat_clients
-- FOR EACH ROW
-- EXECUTE PROCEDURE trigger_set_timestamp();
