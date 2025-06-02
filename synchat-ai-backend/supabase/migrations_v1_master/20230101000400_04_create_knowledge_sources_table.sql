-- Define the public.knowledge_sources table

CREATE TABLE IF NOT EXISTS public.knowledge_sources (
    source_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    source_type TEXT NOT NULL, -- e.g., 'url', 'pdf', 'txt', 'article'
    source_name TEXT NOT NULL, -- e.g., file name, article title, URL
    storage_path TEXT NULL,    -- Path to the file in Supabase Storage (for file-based sources)
    content_text TEXT NULL,    -- Text content of the source, if applicable (e.g., for 'article' type)
    status TEXT NOT NULL DEFAULT 'uploaded', -- e.g., 'uploaded', 'pending_ingest', 'ingesting', 'completed', 'failed_ingest'
    character_count INT NULL,
    last_ingest_at TIMESTAMPTZ NULL,
    last_ingest_error TEXT NULL,
    custom_metadata JSONB NULL, -- Added by 20231027120000
    reingest_frequency TEXT NULL, -- Added by 20231030000000 & 20250531050704
    next_reingest_at TIMESTAMPTZ NULL, -- Added by 20231030000000
    last_successful_reingest_content_hash TEXT NULL, -- Added by 20231030000000
    last_accessibility_check_at TIMESTAMPTZ NULL, -- Added by 20231101000000
    last_accessibility_status TEXT NULL,      -- Added by 20231101000000
    last_known_content_hash TEXT NULL,        -- Added by 20231101000000
    last_reingest_attempt_at TIMESTAMPTZ NULL, -- Added by 20250531050704
    custom_title TEXT NULL,                   -- Added by 20250531050704
    category_tags TEXT[] NULL,                -- Added by 20250531052316
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Comments for consolidated table
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
COMMENT ON COLUMN public.knowledge_sources.custom_metadata IS 'JSONB field for storing arbitrary custom metadata about the source.';
COMMENT ON COLUMN public.knowledge_sources.reingest_frequency IS 'Preferred re-ingestion frequency (e.g., ''daily'', ''weekly'', ''manual'').';
COMMENT ON COLUMN public.knowledge_sources.next_reingest_at IS 'Timestamp for the next scheduled automated re-ingestion.';
COMMENT ON COLUMN public.knowledge_sources.last_successful_reingest_content_hash IS 'Hash of content from last successful re-ingestion to detect changes.';
COMMENT ON COLUMN public.knowledge_sources.last_accessibility_check_at IS 'Timestamp of the last automated check for URL availability/changes.';
COMMENT ON COLUMN public.knowledge_sources.last_accessibility_status IS 'Status from the last accessibility check (e.g., ''OK'', ''ERROR_404'').';
COMMENT ON COLUMN public.knowledge_sources.last_known_content_hash IS 'A hash of the content from the last successful accessibility check.';
COMMENT ON COLUMN public.knowledge_sources.last_reingest_attempt_at IS 'Timestamp of the last time an automated or manual re-ingestion was attempted.';
COMMENT ON COLUMN public.knowledge_sources.custom_title IS 'A user-defined custom title for the knowledge source.';
COMMENT ON COLUMN public.knowledge_sources.category_tags IS 'Array of text tags for categorizing the knowledge source.';
COMMENT ON COLUMN public.knowledge_sources.created_at IS 'Timestamp of when the knowledge source was created.';
COMMENT ON COLUMN public.knowledge_sources.updated_at IS 'Timestamp of the last update to the knowledge source.';

-- Apply the trigger to update updated_at on row update
CREATE TRIGGER on_knowledge_sources_updated
BEFORE UPDATE ON public.knowledge_sources
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at(); -- Uses the consolidated helper function

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_client_id ON public.knowledge_sources(client_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_status ON public.knowledge_sources(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_category_tags ON public.knowledge_sources USING GIN (category_tags);

RAISE NOTICE 'Table public.knowledge_sources created with all consolidated columns, comments, trigger, and indexes.';
