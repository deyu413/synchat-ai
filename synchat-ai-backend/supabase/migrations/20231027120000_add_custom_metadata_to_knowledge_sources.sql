-- Add custom_metadata column to knowledge_sources table
ALTER TABLE public.knowledge_sources
ADD COLUMN custom_metadata JSONB NULL;

-- RLS Policies Considerations:
-- The following are placeholder comments. Actual RLS policies should be
-- reviewed and applied according to the application's security requirements.

-- If existing policies for the 'knowledge_sources' table are restrictive
-- (e.g., using specific column lists), they might need to be updated
-- to include 'custom_metadata'.

-- Example: If you have a policy that allows select on specific columns:
-- CREATE POLICY "Users can read specific columns from their knowledge sources"
-- ON public.knowledge_sources
-- FOR SELECT TO authenticated
-- USING (auth.uid() = client_id) -- Or whatever your ownership condition is
-- WITH CHECK (auth.uid() = client_id); -- For INSERT/UPDATE

-- Such a policy would need 'custom_metadata' added to the list of selectable/updatable columns.

-- For simplicity in this migration, we are not altering existing RLS policies.
-- It's assumed that:
-- 1. If RLS is permissive (e.g., allows access to all columns for authorized users),
--    then 'custom_metadata' will be accessible automatically.
-- 2. If RLS is restrictive, a separate, more detailed RLS review and update
--    will be performed for the 'custom_metadata' column.

-- No explicit RLS changes are made here for the new column itself.
-- Ensure that your existing policies correctly grant or deny access as needed.
