ALTER TABLE public.knowledge_sources
ADD COLUMN IF NOT EXISTS last_accessibility_check_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_accessibility_status TEXT, -- e.g., 'OK', 'ERROR_404', 'ERROR_5XX', 'CONTENT_CHANGED_SIGNIFICANTLY'
ADD COLUMN IF NOT EXISTS last_known_content_hash TEXT;

COMMENT ON COLUMN public.knowledge_sources.last_accessibility_check_at IS 'Timestamp of the last automated check for URL availability/changes.';
COMMENT ON COLUMN public.knowledge_sources.last_accessibility_status IS 'Status from the last accessibility check.';
COMMENT ON COLUMN public.knowledge_sources.last_known_content_hash IS 'A hash of the content from the last successful check, used to detect changes.';

-- RLS Considerations:
-- Similar to other informational columns on knowledge_sources,
-- these are likely managed by backend processes or admin interfaces.
-- If client dashboard users need to view these fields, existing RLS policies
-- for SELECT on knowledge_sources might need to be updated to include these new columns.
-- No explicit RLS changes are made here, assuming backend/admin access.
