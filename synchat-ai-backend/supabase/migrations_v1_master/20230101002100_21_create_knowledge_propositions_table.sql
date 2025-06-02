-- Define the public.knowledge_propositions table

CREATE TABLE IF NOT EXISTS public.knowledge_propositions (
    proposition_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    original_source_id UUID NULL REFERENCES public.knowledge_sources(source_id) ON DELETE CASCADE, -- From the original document source
    source_chunk_id BIGINT NOT NULL REFERENCES public.knowledge_base(id) ON DELETE CASCADE, -- FK to the parent chunk in knowledge_base
    proposition_text TEXT NOT NULL,
    embedding VECTOR(1536) NULL, -- Dimension matches EMBEDDING_MODEL
    metadata JSONB NULL, -- For any additional metadata about the proposition
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Comments
COMMENT ON TABLE public.knowledge_propositions IS 'Stores factual propositions extracted from knowledge base chunks, along with their embeddings.';
COMMENT ON COLUMN public.knowledge_propositions.proposition_id IS 'Unique identifier for the proposition.';
COMMENT ON COLUMN public.knowledge_propositions.client_id IS 'Client associated with this proposition.';
COMMENT ON COLUMN public.knowledge_propositions.original_source_id IS 'Identifier of the original knowledge source document from which this proposition ultimately derives.';
COMMENT ON COLUMN public.knowledge_propositions.source_chunk_id IS 'Identifier of the parent chunk in public.knowledge_base from which this proposition was extracted.';
COMMENT ON COLUMN public.knowledge_propositions.proposition_text IS 'The textual content of the extracted proposition.';
COMMENT ON COLUMN public.knowledge_propositions.embedding IS 'Vector embedding of the proposition_text.';
COMMENT ON COLUMN public.knowledge_propositions.metadata IS 'JSONB field for storing any additional metadata related to the proposition (e.g., extraction confidence).';
COMMENT ON COLUMN public.knowledge_propositions.created_at IS 'Timestamp of when the proposition was created.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kp_client_id ON public.knowledge_propositions(client_id);
CREATE INDEX IF NOT EXISTS idx_kp_source_chunk_id ON public.knowledge_propositions(source_chunk_id);
CREATE INDEX IF NOT EXISTS idx_kp_original_source_id ON public.knowledge_propositions(original_source_id WHERE original_source_id IS NOT NULL);

-- Vector index for similarity search on proposition embeddings
-- Using IVFFlat as a default, similar to knowledge_base. Parameters might need tuning.
-- The number of lists could be based on the expected number of propositions.
-- For now, a smaller default list count as proposition tables might be smaller than main KB.
CREATE INDEX IF NOT EXISTS idx_kp_embedding ON public.knowledge_propositions USING ivfflat (embedding public.vector_cosine_ops) WITH (lists = 50);

RAISE NOTICE 'Table public.knowledge_propositions created with comments, FKs, and indexes.';

-- RLS: Typically, this table would be managed by backend services (ingestionService).
-- Access policies can be defined if specific user roles need to query it directly.
ALTER TABLE public.knowledge_propositions ENABLE ROW LEVEL SECURITY;
-- Default RLS policy (e.g., service_role access only) will be added in the RLS-focused migration.
