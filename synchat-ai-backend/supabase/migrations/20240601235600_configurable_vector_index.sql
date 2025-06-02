-- Migration: Configurable Vector Index (IVFFlat or HNSW)
-- This migration allows for tuning the primary vector index on the knowledge_base table.
-- User action is required to set parameters based on actual data size.

-- Drop the existing index first to recreate it with new parameters or type.
-- This ensures that if an old version of either index type exists, it's removed.
DROP INDEX IF EXISTS public.idx_knowledge_base_embedding;
DROP INDEX IF EXISTS public.idx_knowledge_base_embedding_hnsw; -- In case an HNSW variant was ever trialed with a different name

-- Informational message for the user running the migration
RAISE NOTICE 'This migration will recreate the vector index (idx_knowledge_base_embedding).';
RAISE NOTICE 'Please review the PL/pgSQL block below to ensure total_vectors is set correctly for your dataset.';
RAISE NOTICE 'You can also choose to comment out the IVFFlat creation and uncomment/use the HNSW option if preferred.';

-- Dynamic IVFFlat Index Creation (Default Option)
DO $$
DECLARE
    total_vectors BIGINT;
    num_lists INTEGER;
    -- User Action Required:
    -- Replace the value below with the actual count from: SELECT count(*) FROM public.knowledge_base;
    -- This placeholder is for development and initial migration purposes.
    placeholder_total_vectors BIGINT := 100000; -- !! USER: REPLACE THIS WITH ACTUAL COUNT !!

BEGIN
    -- Attempt to get actual count if run in an environment where the table might exist
    -- This is a fallback and might not work in a fresh schema migration scenario before data load.
    -- The primary method for the user is to manually replace placeholder_total_vectors.
    BEGIN
        EXECUTE 'SELECT count(*) FROM public.knowledge_base' INTO total_vectors;
        IF total_vectors IS NULL OR total_vectors = 0 THEN
            total_vectors := placeholder_total_vectors;
            RAISE NOTICE 'Could not determine actual total_vectors or table is empty/not yet populated. Using placeholder value: %', total_vectors;
        ELSE
            RAISE NOTICE 'Successfully determined total_vectors from table: %', total_vectors;
        END IF;
    EXCEPTION
        WHEN undefined_table THEN
            total_vectors := placeholder_total_vectors;
            RAISE NOTICE 'knowledge_base table not found. Using placeholder total_vectors: %', total_vectors;
        WHEN OTHERS THEN
            total_vectors := placeholder_total_vectors;
            RAISE NOTICE 'Error fetching total_vectors, using placeholder: %. SQLSTATE: %, SQLERRM: %', total_vectors, SQLSTATE, SQLERRM;
    END;

    -- Calculate num_lists based on total_vectors
    -- Rule: For N rows up to 1M: N / 1000. For N rows > 1M: sqrt(N).
    -- Apply min/max caps for sensibility.
    IF total_vectors > 0 AND total_vectors <= 1000000 THEN
        num_lists := GREATEST(100, LEAST(1000, (total_vectors / 1000)::INTEGER));
    ELSIF total_vectors > 1000000 THEN
        num_lists := GREATEST(100, LEAST(4000, (sqrt(total_vectors))::INTEGER)); -- Max lists for ivfflat often suggested around 4000-8192
    ELSE
        num_lists := 100; -- Default for very few or no vectors
    END IF;

    RAISE NOTICE 'ACTION REQUIRED: Based on total_vectors = %, calculated num_lists for IVFFlat = %.', total_vectors, num_lists;
    RAISE NOTICE 'If total_vectors was a placeholder, update it and re-evaluate num_lists for the CREATE INDEX statement.';
    RAISE NOTICE 'Creating IVFFlat index idx_knowledge_base_embedding with lists = %', num_lists;

    -- Create the IVFFlat index using the calculated num_lists
    EXECUTE 'CREATE INDEX idx_knowledge_base_embedding ON public.knowledge_base USING ivfflat (embedding public.vector_cosine_ops) WITH (lists = ' || num_lists || ');';
    EXECUTE 'COMMENT ON INDEX public.idx_knowledge_base_embedding IS ''IVFFlat index for vector search. Current lists parameter: ' || num_lists || '. This should be tuned based on the total number of vectors (N) in the table (e.g., N/1000 for N<=1M, or sqrt(N) for N>1M).'';';

    RAISE NOTICE 'Successfully created IVFFlat index idx_knowledge_base_embedding with lists = %.', num_lists;

END $$;

-- Alternative: HNSW Index (User should uncomment and use this section if N is very large and HNSW is preferred)
/*
-- Ensure only one primary vector index is active. If you uncomment this, comment out the DO $$ ... END $$; block above.
-- DROP INDEX IF EXISTS public.idx_knowledge_base_embedding; -- Might have been created by the block above if not careful

RAISE NOTICE 'HNSW Option: If you intend to use HNSW, ensure the IVFFlat creation block above is commented out.';
RAISE NOTICE 'Creating HNSW index idx_knowledge_base_embedding_hnsw (or rename to idx_knowledge_base_embedding if it is the primary).';

CREATE INDEX idx_knowledge_base_embedding_hnsw -- Or use idx_knowledge_base_embedding for consistency if this is the chosen primary
    ON public.knowledge_base
    USING hnsw (embedding public.vector_cosine_ops)
    WITH (m = 16, ef_construction = 64); -- m: connections per layer (default 16). ef_construction: size of dynamic list for construction (default 64).

COMMENT ON INDEX public.idx_knowledge_base_embedding_hnsw -- Adjust name if changed
    IS 'HNSW index for vector search. M (connections) and ef_construction (build-time quality) are starting parameters and can be tuned. Higher ef_construction means better recall but slower build. Higher M increases memory and can improve recall.';

RAISE NOTICE 'Successfully created HNSW index.';
*/

RAISE NOTICE 'Migration for configurable vector index complete. Review console notices and index comments for tuning guidance.';
