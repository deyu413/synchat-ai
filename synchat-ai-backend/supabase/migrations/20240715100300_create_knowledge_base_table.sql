-- Supabase Migration: Create knowledge_base table
-- Timestamp: 20240715100300

-- Ensure necessary extensions are enabled.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- For client_id FK type, though not for defaults in this table specifically

-- Create the knowledge_base table
CREATE TABLE public.knowledge_base (
    id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(1536), -- Dimension should match your embedding model, e.g., text-embedding-3-small
    metadata JSONB,
    fts TSVECTOR, -- For Full-Text Search
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    CONSTRAINT fk_client
        FOREIGN KEY(client_id)
        REFERENCES public.synchat_clients(client_id)
        ON DELETE CASCADE -- If a client is deleted, their knowledge base entries are also deleted.
);

-- Add comments to the table and columns
COMMENT ON TABLE public.knowledge_base IS 'Stores chunks of text, their embeddings, and metadata for client-specific knowledge bases used for RAG.';
COMMENT ON COLUMN public.knowledge_base.id IS 'Unique identifier for the knowledge base entry.';
COMMENT ON COLUMN public.knowledge_base.client_id IS 'Identifier of the client to whom this knowledge base entry belongs. Foreign key to synchat_clients.';
COMMENT ON COLUMN public.knowledge_base.content IS 'Text content of the knowledge chunk.';
COMMENT ON COLUMN public.knowledge_base.embedding IS 'Vector embedding of the content (e.g., dimension 1536 for OpenAI text-embedding-3-small).';
COMMENT ON COLUMN public.knowledge_base.metadata IS 'JSONB field for storing additional information, like source URL or document structure.';
COMMENT ON COLUMN public.knowledge_base.fts IS 'Full-Text Search vector generated from the content.';
COMMENT ON COLUMN public.knowledge_base.created_at IS 'Timestamp of when the knowledge base entry was created.';

-- Trigger function to automatically update the 'fts' column
CREATE OR REPLACE FUNCTION public.update_knowledge_base_fts()
RETURNS TRIGGER AS $$
BEGIN
    -- Using 'english' configuration, adjust if other languages are predominant for certain clients.
    -- Consider making the language configuration dynamic or storing it per client if needed.
    NEW.fts = to_tsvector('pg_catalog.english', NEW.content);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to execute the function before any insert or update on the content column
CREATE TRIGGER knowledge_base_fts_update_trigger
BEFORE INSERT OR UPDATE OF content ON public.knowledge_base
FOR EACH ROW EXECUTE FUNCTION public.update_knowledge_base_fts();

-- Indexes for performance
-- Standard index on client_id for faster filtering by client.
CREATE INDEX idx_knowledge_base_client_id ON public.knowledge_base(client_id);

-- GIN index for Full-Text Search on the 'fts' column.
CREATE INDEX idx_knowledge_base_fts ON public.knowledge_base USING GIN(fts);

-- Index for vector similarity search on the 'embedding' column.
-- Using IVFFlat with vector_cosine_ops as specified.
-- The number of lists is a common starting point; adjust based on table size and performance testing.
-- For N rows, lists is often sqrt(N) up to N/1000.
CREATE INDEX idx_knowledge_base_embedding ON public.knowledge_base USING ivfflat (embedding public.vector_cosine_ops) WITH (lists = 100);

-- Note on vector indexing:
-- HNSW is another option for vector indexing, potentially offering better recall/performance for some workloads.
-- Example for HNSW (if preferred and pgvector version supports it well):
-- CREATE INDEX idx_knowledge_base_embedding_hnsw ON public.knowledge_base USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
-- Always test index performance with your specific data and query patterns.
