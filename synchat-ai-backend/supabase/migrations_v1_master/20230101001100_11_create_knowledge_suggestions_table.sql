-- Define the public.knowledge_suggestions table

CREATE TABLE IF NOT EXISTS public.knowledge_suggestions (
    suggestion_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    type public.suggestion_type NOT NULL,
    title TEXT NOT NULL,
    description TEXT NULL,
    source_queries JSONB NULL, -- Array of user queries that triggered this suggestion
    example_resolution TEXT NULL, -- For 'new_faq_from_escalation', agent's successful answer
    status public.suggestion_status NOT NULL DEFAULT 'new',
    related_knowledge_source_ids UUID[] NULL, -- Optional: IDs of existing sources relevant to update
    related_chunk_id BIGINT NULL REFERENCES public.knowledge_base(id) ON DELETE SET NULL, -- Added by 20240601235500
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comments
COMMENT ON TABLE public.knowledge_suggestions IS 'Stores AI-generated or feedback-driven suggestions for improving client knowledge bases.';
COMMENT ON COLUMN public.knowledge_suggestions.suggestion_id IS 'Unique identifier for the suggestion.';
COMMENT ON COLUMN public.knowledge_suggestions.client_id IS 'Client associated with this suggestion.';
COMMENT ON COLUMN public.knowledge_suggestions.type IS 'Type of suggestion (e.g., ''content_gap'', ''chunk_needs_review'').';
COMMENT ON COLUMN public.knowledge_suggestions.title IS 'Concise title for the suggestion.';
COMMENT ON COLUMN public.knowledge_suggestions.description IS 'Detailed description or justification for the suggestion.';
COMMENT ON COLUMN public.knowledge_suggestions.source_queries IS 'JSONB array of user queries (strings) that triggered or are related to this suggestion.';
COMMENT ON COLUMN public.knowledge_suggestions.example_resolution IS 'For suggestions from escalations, this could store the successful agent reply.';
COMMENT ON COLUMN public.knowledge_suggestions.status IS 'Current status of the suggestion (e.g., ''new'', ''reviewed_pending_action'').';
COMMENT ON COLUMN public.knowledge_suggestions.related_knowledge_source_ids IS 'Array of knowledge_sources.source_id that this suggestion might relate to.';
COMMENT ON COLUMN public.knowledge_suggestions.related_chunk_id IS 'ID of the related knowledge base chunk that this suggestion refers to (if applicable). Foreign key to knowledge_base.id.';
COMMENT ON COLUMN public.knowledge_suggestions.created_at IS 'Timestamp of when the suggestion was created.';
COMMENT ON COLUMN public.knowledge_suggestions.updated_at IS 'Timestamp of the last update to the suggestion.';

-- Trigger for updated_at
CREATE TRIGGER on_knowledge_suggestions_updated
BEFORE UPDATE ON public.knowledge_suggestions
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_suggestions_client_id_status ON public.knowledge_suggestions(client_id, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_suggestions_client_id_type ON public.knowledge_suggestions(client_id, type);
CREATE INDEX IF NOT EXISTS idx_knowledge_suggestions_related_chunk_id ON public.knowledge_suggestions(related_chunk_id WHERE related_chunk_id IS NOT NULL);

RAISE NOTICE 'Table public.knowledge_suggestions created with all consolidated columns, FKs, trigger, comments, and indexes.';

-- RLS will be applied in a subsequent, dedicated RLS migration file.
ALTER TABLE public.knowledge_suggestions ENABLE ROW LEVEL SECURITY;
