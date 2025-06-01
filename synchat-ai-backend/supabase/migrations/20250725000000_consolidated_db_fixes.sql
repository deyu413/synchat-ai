-- Migration: Consolidated Database Fixes and RLS Policy Updates
-- Timestamp: 20250725000000

BEGIN;

-- 1. `knowledge_sources` Primary Key Rename
-- The operation to rename 'id' to 'source_id' in 'public.knowledge_sources'
-- was previously applied and is now removed from this script to avoid re-execution.

-- Note: PostgreSQL typically handles the renaming of associated PK constraint names (e.g., 'knowledge_sources_pkey')
-- automatically when the column it references is renamed. If issues were to arise, the constraint
-- might need to be manually dropped and recreated referencing the new column name.


-- 2. RLS Policies for `knowledge_base`
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select own knowledge_base entries"
ON public.knowledge_base
FOR SELECT
USING (auth.uid() = client_id);

CREATE POLICY "Allow insert own knowledge_base entries"
ON public.knowledge_base
FOR INSERT
WITH CHECK (auth.uid() = client_id);

-- For UPDATE, ensure client_id cannot be changed and still matches the user.
CREATE POLICY "Allow update own knowledge_base entries"
ON public.knowledge_base
FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = NEW.client_id AND NEW.client_id = OLD.client_id);

CREATE POLICY "Allow delete own knowledge_base entries"
ON public.knowledge_base
FOR DELETE
USING (auth.uid() = client_id);


-- 3. RLS Policies for `knowledge_sources`
-- Enabling RLS (harmless if already enabled) and defining baseline policies.
-- If policies with these exact names already exist, these CREATE POLICY statements might error.
-- In a production scenario, one might use `DROP POLICY IF EXISTS ...;` before creating.
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select own knowledge_sources entries"
ON public.knowledge_sources
FOR SELECT
USING (auth.uid() = client_id);

CREATE POLICY "Allow insert own knowledge_sources entries"
ON public.knowledge_sources
FOR INSERT
WITH CHECK (auth.uid() = client_id);

-- For UPDATE, ensure client_id cannot be changed and still matches the user.
CREATE POLICY "Allow update own knowledge_sources entries"
ON public.knowledge_sources
FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = NEW.client_id AND NEW.client_id = OLD.client_id);

CREATE POLICY "Allow delete own knowledge_sources entries"
ON public.knowledge_sources
FOR DELETE
USING (auth.uid() = client_id);


-- 4. Corrected RLS Policies for `message_feedback`
-- Drop potentially existing incorrect/outdated policies first.
-- Old policy names are assumed based on '20231028000000_create_message_feedback_table.sql'.
DROP POLICY IF EXISTS "Allow agents to insert feedback for their client" ON public.message_feedback;
DROP POLICY IF EXISTS "Allow agents to view their feedback or client feedback" ON public.message_feedback;

-- Create new, corrected policies for message_feedback.
-- This policy assumes agent_user_id is the identifier of the user submitting the feedback (auth.uid()),
-- and the feedback's client_id must also match this user's auth.uid().
CREATE POLICY "Allow auth user to insert their own feedback"
ON public.message_feedback
FOR INSERT
WITH CHECK (auth.uid() = agent_user_id AND client_id = auth.uid());

-- This policy allows a user to see feedback they submitted OR any feedback associated with their client_id.
CREATE POLICY "Allow auth user to view their own feedback or all for their client_id"
ON public.message_feedback
FOR SELECT
USING (auth.uid() = agent_user_id OR client_id = auth.uid());


-- 5. Correction for `fts_search_with_rank` RPC (DB-RPC-S1)
-- Re-defines the function to use `kb.fts` instead of `kb.fts_document_vector`.
-- Signature and other parts remain as in '..._alter_search_rpcs_for_category_filter.sql'.
CREATE OR REPLACE FUNCTION public.fts_search_with_rank(
    client_id_param uuid,
    query_text text,
    match_count integer,
    p_category_filter text[] DEFAULT NULL -- Parameter for category filtering
)
RETURNS TABLE (
    id bigint,
    content text,
    metadata jsonb,
    knowledge_source_id uuid,
    rank real
)
LANGUAGE plpgsql
AS $$
DECLARE
    ts_query_obj tsquery;
BEGIN
    ts_query_obj := websearch_to_tsquery('spanish', query_text); -- Assuming 'spanish' config

    RETURN QUERY
    SELECT
        kb.id,
        kb.content,
        kb.metadata,
        (kb.metadata->>'original_source_id')::uuid AS knowledge_source_id,
        ts_rank_cd(kb.fts, ts_query_obj) AS rank -- Corrected: using kb.fts
    FROM
        public.knowledge_base kb
    WHERE
        kb.client_id = client_id_param
        AND kb.fts @@ ts_query_obj -- Corrected: using kb.fts
        AND (p_category_filter IS NULL OR (kb.metadata->'category_tags')::jsonb ?| p_category_filter)
    ORDER BY
        rank DESC
    LIMIT
        match_count;
END;
$$;

COMMENT ON FUNCTION public.fts_search_with_rank(uuid, text, integer, text[]) IS 'Performs Full-Text Search on knowledge_base with ranking, using `fts` column, with optional category filtering.';


COMMIT;
