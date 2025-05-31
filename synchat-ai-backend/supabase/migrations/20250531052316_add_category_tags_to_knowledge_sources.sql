-- Add category_tags to knowledge_sources table
ALTER TABLE public.knowledge_sources
ADD COLUMN IF NOT EXISTS category_tags TEXT[] NULL;

COMMENT ON COLUMN public.knowledge_sources.category_tags IS 'Array of text tags for categorizing the knowledge source (e.g., for targeted RAG).';

-- Optional: Add a GIN index if queries will frequently filter or search by these tags
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_category_tags
ON public.knowledge_sources USING GIN (category_tags);
