ALTER TABLE public.knowledge_sources
ADD COLUMN reingest_frequency TEXT NULL,
ADD COLUMN next_reingest_at TIMESTAMPTZ NULL,
ADD COLUMN last_successful_reingest_content_hash TEXT NULL;

COMMENT ON COLUMN public.knowledge_sources.reingest_frequency IS 'Frequency for re-ingestion, e.g., ''manual'', ''daily'', ''weekly'', ''monthly''';
COMMENT ON COLUMN public.knowledge_sources.next_reingest_at IS 'Timestamp for the next scheduled re-ingestion';
COMMENT ON COLUMN public.knowledge_sources.last_successful_reingest_content_hash IS 'Hash of the content from the last successful re-ingestion, to detect changes';

-- No default values are set for these new columns as they are nullable
-- and will be populated by application logic or scheduled tasks.

-- RLS Considerations:
-- If existing RLS policies on 'public.knowledge_sources' are restrictive
-- (e.g., only allow selecting/updating specific columns), they might need
-- to be updated to include these new columns if client applications or specific roles
-- (other than service_role or admin) need to read or modify them.
-- For now, assuming these fields are primarily managed by backend processes
-- or admin interfaces that operate with less restrictive RLS or as service_role.
-- No explicit RLS changes are made here.
