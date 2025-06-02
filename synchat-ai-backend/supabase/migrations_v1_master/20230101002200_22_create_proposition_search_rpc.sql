-- Define or replace the public.proposition_vector_search RPC function

CREATE OR REPLACE FUNCTION public.proposition_vector_search(
    client_id_param UUID,
    query_embedding VECTOR(1536),
    match_threshold FLOAT,
    match_count INT,
    ivfflat_probes_param INT DEFAULT 5 -- Added probes param for consistency, default 5 for potentially smaller proposition set
)
RETURNS TABLE(proposition_id BIGINT, proposition_text TEXT, source_chunk_id BIGINT, similarity FLOAT)
LANGUAGE plpgsql
AS $$
BEGIN
    EXECUTE 'SET LOCAL ivfflat.probes = ' || ivfflat_probes_param::TEXT;

    RETURN QUERY
    SELECT
        kp.proposition_id,
        kp.proposition_text,
        kp.source_chunk_id,
        (1 - (kp.embedding <=> query_embedding)) AS similarity -- Cosine Similarity
    FROM
        public.knowledge_propositions kp
    WHERE
        kp.client_id = client_id_param AND (1 - (kp.embedding <=> query_embedding)) > match_threshold
    ORDER BY
        similarity DESC
    LIMIT
        match_count;
END;
$$;

COMMENT ON FUNCTION public.proposition_vector_search(UUID, VECTOR, FLOAT, INT, INT)
IS 'Performs vector similarity search on the knowledge_propositions table. Allows tuning of ivfflat.probes.';

RAISE NOTICE 'RPC function public.proposition_vector_search created/updated.';
