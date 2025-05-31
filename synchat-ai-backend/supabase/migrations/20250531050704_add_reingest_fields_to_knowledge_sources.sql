-- Add/update re-ingestion related fields to knowledge_sources table

-- Ensure reingest_frequency column exists and update its comment
ALTER TABLE public.knowledge_sources
ADD COLUMN IF NOT EXISTS reingest_frequency TEXT NULL;

COMMENT ON COLUMN public.knowledge_sources.reingest_frequency IS 'Preferred re-ingestion frequency for the source (e.g., ''daily'', ''weekly'', ''manual''). NULL implies default or system-managed.';

-- Add last_reingest_attempt_at column (new field)
ALTER TABLE public.knowledge_sources
ADD COLUMN IF NOT EXISTS last_reingest_attempt_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.knowledge_sources.last_reingest_attempt_at IS 'Timestamp of the last time an automated or manual re-ingestion was attempted for this source.';

-- Update comment for the existing next_reingest_at column
-- The column 'next_reingest_at' was added by migration 20231030000000.
COMMENT ON COLUMN public.knowledge_sources.next_reingest_at IS 'Timestamp for the next scheduled automated re-ingestion (if applicable). This column was previously named next_reingest_at in its original migration.';

-- Add custom_title column (new field)
ALTER TABLE public.knowledge_sources
ADD COLUMN IF NOT EXISTS custom_title TEXT NULL;

COMMENT ON COLUMN public.knowledge_sources.custom_title IS 'A user-defined custom title for the knowledge source for easier identification in the dashboard.';
