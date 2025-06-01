-- Function to update the fts column in knowledge_base using Spanish configuration
CREATE OR REPLACE FUNCTION public.fts_update_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  -- Assuming 'content' is the column with text to be indexed,
  -- and 'fts' is the tsvector column.
  -- Convert NEW.content to tsvector using the 'spanish' text search configuration.
  NEW.fts = to_tsvector('spanish', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update fts on insert or update of content in knowledge_base
-- Drop the trigger first if it exists, to avoid errors if it was defined differently.
DROP TRIGGER IF EXISTS update_knowledge_base_fts ON public.knowledge_base;

-- Create the trigger to call the updated function.
CREATE TRIGGER update_knowledge_base_fts
BEFORE INSERT OR UPDATE OF content ON public.knowledge_base
FOR EACH ROW
EXECUTE FUNCTION public.fts_update_trigger_function();

-- Comment on the function and trigger for clarity
COMMENT ON FUNCTION public.fts_update_trigger_function() IS 'Updates the fts tsvector column in knowledge_base using the Spanish text search configuration upon content changes.';
COMMENT ON TRIGGER update_knowledge_base_fts ON public.knowledge_base IS 'Automatically updates the fts column whenever the content column in knowledge_base is inserted or updated.';

-- Optional: Re-index existing data if necessary.
-- If you want to ensure all existing data in knowledge_base.fts is updated
-- according to the new Spanish configuration, you might need to run an UPDATE statement.
-- This can be time-consuming for large tables.
-- Example: UPDATE public.knowledge_base SET fts = to_tsvector('spanish', COALESCE(content, ''));
-- This part is commented out by default as it's a potentially long-running operation
-- and should be run manually with consideration if the table is large.
-- Consider running it during a maintenance window.
