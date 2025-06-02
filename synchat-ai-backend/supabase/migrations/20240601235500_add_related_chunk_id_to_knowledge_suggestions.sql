-- Add related_chunk_id column to knowledge_suggestions table
ALTER TABLE public.knowledge_suggestions
ADD COLUMN related_chunk_id BIGINT NULL;

-- Add foreign key constraint to knowledge_base table
ALTER TABLE public.knowledge_suggestions
ADD CONSTRAINT fk_knowledge_suggestions_chunk
FOREIGN KEY (related_chunk_id)
REFERENCES public.knowledge_base(id)
ON DELETE SET NULL;

-- Optional: Add an index for faster lookups if needed
-- CREATE INDEX IF NOT EXISTS idx_knowledge_suggestions_related_chunk_id
-- ON public.knowledge_suggestions(related_chunk_id);

-- Optional: Add a comment on the column
-- COMMENT ON COLUMN public.knowledge_suggestions.related_chunk_id IS 'ID of the related knowledge base chunk that this suggestion refers to (if applicable).';
