-- Supabase Migration: Create RPC functions for vector and FTS search
-- Timestamp: 20240715100500

-- Ensure necessary extensions are enabled
CREATE EXTENSION IF NOT EXISTS vector; -- For VECTOR type and operations
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Though not directly used for defaults here, good to ensure if other related functions might use it.

-- Function for Vector Similarity Search (Cosine Similarity)
CREATE OR REPLACE FUNCTION public.vector_search(
    query_embedding VECTOR(1536),
    match_threshold FLOAT,
    match_count INT,
    client_id_param UUID
)
RETURNS TABLE(id BIGINT, content TEXT, metadata JSONB, similarity FLOAT)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        kb.id,
        kb.content,
        kb.metadata,
        (1 - (kb.embedding <=> query_embedding)) AS similarity -- Cosine similarity calculation
    FROM
        public.knowledge_base kb
    WHERE
        kb.client_id = client_id_param AND (1 - (kb.embedding <=> query_embedding)) > match_threshold
    ORDER BY
        similarity DESC
    LIMIT
        match_count;
END;
$$;

COMMENT ON FUNCTION public.vector_search(VECTOR(1536), FLOAT, INT, UUID)
IS 'Performs a vector similarity search on the knowledge_base table using cosine similarity (1 - cosine_distance). Filters by client_id and a similarity threshold, limiting the number of results.';


-- Function for Full-Text Search with Ranking
CREATE OR REPLACE FUNCTION public.fts_search_with_rank(
    query_text TEXT,
    match_count INT,
    client_id_param UUID,
    language_config REGCONFIG DEFAULT 'pg_catalog.english' -- Allow specifying language, default to english
)
RETURNS TABLE(id BIGINT, content TEXT, metadata JSONB, rank REAL)
LANGUAGE plpgsql
AS $$
DECLARE
    search_query TSQUERY;
BEGIN
    -- Using plainto_tsquery to handle user input more safely than to_tsquery
    search_query := plainto_tsquery(language_config, query_text);

    RETURN QUERY
    SELECT
        kb.id,
        kb.content,
        kb.metadata,
        ts_rank_cd(kb.fts, search_query) AS rank
    FROM
        public.knowledge_base kb
    WHERE
        kb.client_id = client_id_param AND kb.fts @@ search_query
    ORDER BY
        rank DESC
    LIMIT
        match_count;
END;
$$;

COMMENT ON FUNCTION public.fts_search_with_rank(TEXT, INT, UUID, REGCONFIG)
IS 'Performs a full-text search on the knowledge_base table using a specified query text and language configuration. Filters by client_id, ranks results using ts_rank_cd, and limits the number of results.';

-- Security considerations:
-- Both functions are defined with the default SECURITY INVOKER behavior.
-- This means they run with the permissions of the user calling them.
-- Ensure Row Level Security (RLS) policies are in place on the 'public.knowledge_base' table
-- to restrict access appropriately for the roles that will be calling these functions.
-- If SECURITY DEFINER is needed for broader access (e.g., if the calling role doesn't have direct table access
-- but the function owner does), it must be used with extreme caution, typically by setting a specific,
-- restricted 'search_path' within the function: SET search_path = public;
-- Example: CREATE OR REPLACE FUNCTION public.vector_search(...) ... LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
-- However, for most Supabase RPCs intended for client-side calls by authenticated users, SECURITY INVOKER combined with RLS is preferred.
