-- Schema for the knowledge_base table
-- This table stores chunks of text content, their embeddings, and metadata for client-specific knowledge bases.

-- Ensure necessary extensions are enabled.
-- pgvector for VECTOR type
CREATE EXTENSION IF NOT EXISTS vector;
-- uuid-ossp for uuid_generate_v4() if used for client_id default (though client_id is a FK here)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE public.knowledge_base (
    id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(1536), -- Dimension matches embeddingService.js
    metadata JSONB,
    fts TSVECTOR,
    created_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT fk_client
        FOREIGN KEY(client_id)
        REFERENCES public.synchat_clients(client_id)
        ON DELETE CASCADE -- If a client is deleted, their knowledge base entries are also deleted.
);

-- Notes on populating the 'fts' (Full-Text Search) column:
-- The 'fts' column is intended to store tsvector representations of the 'content' column
-- for efficient full-text searching. This is typically handled by an automatically
-- generated column in newer PostgreSQL versions or by a trigger.

-- Example using a generated column (PostgreSQL 12+):
-- ALTER TABLE public.knowledge_base
-- ADD COLUMN fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
-- (Choose your language configuration for to_tsvector, e.g., 'simple', 'spanish')

-- Example using a trigger for older PostgreSQL versions or more complex scenarios:
/*
CREATE OR REPLACE FUNCTION public.update_knowledge_base_fts()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fts = to_tsvector('english', NEW.content); -- Adjust language as needed
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_base_fts_update_trigger
BEFORE INSERT OR UPDATE ON public.knowledge_base
FOR EACH ROW EXECUTE FUNCTION public.update_knowledge_base_fts();
*/

-- Notes on Indexes:
-- 1. Standard index on client_id for faster filtering by client.
--    CREATE INDEX idx_knowledge_base_client_id ON public.knowledge_base(client_id);

-- 2. GIN index for Full-Text Search on the 'fts' column.
--    CREATE INDEX idx_knowledge_base_fts ON public.knowledge_base USING GIN(fts);

-- 3. Index for vector similarity search on the 'embedding' column.
--    The type of index depends on the size of your data and query patterns.
--    pgvector supports different index types like IVFFlat and HNSW.
--    Example for IVFFlat (good for datasets up to ~10M vectors):
--    CREATE INDEX idx_knowledge_base_embedding_ivfflat ON public.knowledge_base USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);
--    (Adjust 'lists' based on dataset size, typically N/1000 to N/2000 where N is number of rows)

--    Example for HNSW (good for high recall and larger datasets, but slower build time):
--    CREATE INDEX idx_knowledge_base_embedding_hnsw ON public.knowledge_base USING hnsw (embedding vector_l2_ops) WITH (m = 16, ef_construction = 64);
--    (Adjust 'm' and 'ef_construction' as needed)
--    Choose the appropriate vector_ops based on your distance metric (e.g., vector_l2_ops, vector_ip_ops, vector_cosine_ops).

COMMENT ON TABLE public.knowledge_base IS 'Stores chunks of text, their embeddings, and metadata for client-specific knowledge bases used for RAG.';
COMMENT ON COLUMN public.knowledge_base.id IS 'Unique identifier for the knowledge base entry.';
COMMENT ON COLUMN public.knowledge_base.client_id IS 'Identifier of the client to whom this knowledge base entry belongs. Foreign key to synchat_clients.';
COMMENT ON COLUMN public.knowledge_base.content IS 'Text content of the knowledge chunk.';
COMMENT ON COLUMN public.knowledge_base.embedding IS 'Vector embedding of the content (dimension 1536).';
COMMENT ON COLUMN public.knowledge_base.metadata IS 'JSONB field for storing additional information, like source URL or document structure.';
COMMENT ON COLUMN public.knowledge_base.fts IS 'Full-Text Search vector generated from the content.';
COMMENT ON COLUMN public.knowledge_base.created_at IS 'Timestamp of when the knowledge base entry was created.';
