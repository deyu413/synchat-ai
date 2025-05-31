-- Migration to alter RPC functions for category filtering

-- 1. Alter vector_search function
CREATE OR REPLACE FUNCTION public.vector_search(
    client_id_param uuid,
    query_embedding vector(1536), -- Assuming embedding dimension is 1536
    match_threshold double precision,
    match_count integer,
    p_category_filter text[] DEFAULT NULL -- New parameter for category filtering
)
RETURNS TABLE (
    id bigint,
    content text,
    metadata jsonb,
    knowledge_source_id uuid, -- Assuming this column exists
    similarity double precision
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        kb.id,
        kb.content,
        kb.metadata,
        kb.knowledge_source_id,
        1 - (kb.embedding <=> query_embedding) AS similarity
    FROM
        public.knowledge_base kb
    WHERE
        kb.client_id = client_id_param
        AND 1 - (kb.embedding <=> query_embedding) > match_threshold
        AND (p_category_filter IS NULL OR (kb.metadata->'category_tags')::jsonb ?| p_category_filter) -- Category filter logic
    ORDER BY
        similarity DESC
    LIMIT
        match_count;
END;
$$;

COMMENT ON FUNCTION public.vector_search(uuid, vector, double precision, integer, text[]) IS 'Performs vector similarity search on knowledge_base, with optional category filtering.';


-- 2. Alter fts_search_with_rank function
CREATE OR REPLACE FUNCTION public.fts_search_with_rank(
    client_id_param uuid,
    query_text text,
    match_count integer,
    p_category_filter text[] DEFAULT NULL -- New parameter for category filtering
)
RETURNS TABLE (
    id bigint,
    content text,
    metadata jsonb,
    knowledge_source_id uuid, -- Assuming this column exists
    rank real -- Assuming rank is of type real or double precision
)
LANGUAGE plpgsql
AS $$
DECLARE
    ts_query_obj tsquery;
BEGIN
    -- Attempt to convert plain text to a tsquery.
    -- This example uses plainto_tsquery, which is simple.
    -- More complex scenarios might use websearch_to_tsquery or build the tsquery manually.
    ts_query_obj := plainto_tsquery('spanish', query_text); -- Assuming 'spanish' config

    RETURN QUERY
    SELECT
        kb.id,
        kb.content,
        kb.metadata,
        kb.knowledge_source_id,
        ts_rank_cd(kb.fts_document_vector, ts_query_obj) AS rank -- fts_document_vector is assumed to be the tsvector column
    FROM
        public.knowledge_base kb
    WHERE
        kb.client_id = client_id_param
        AND kb.fts_document_vector @@ ts_query_obj
        AND (p_category_filter IS NULL OR (kb.metadata->'category_tags')::jsonb ?| p_category_filter) -- Category filter logic
    ORDER BY
        rank DESC
    LIMIT
        match_count;
END;
$$;

COMMENT ON FUNCTION public.fts_search_with_rank(uuid, text, integer, text[]) IS 'Performs Full-Text Search on knowledge_base with ranking, with optional category filtering.';
