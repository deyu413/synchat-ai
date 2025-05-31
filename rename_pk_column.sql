-- Rename the primary key column 'id' to 'source_id' in the 'public.knowledge_sources' table.
ALTER TABLE public.knowledge_sources
RENAME COLUMN id TO source_id;

-- Note: If the primary key constraint was explicitly named (e.g., 'knowledge_sources_pkey' referencing 'id'),
-- that constraint will typically automatically adapt to the renamed column in PostgreSQL.
-- However, in some other SQL databases, or for very old PostgreSQL versions,
-- you might need to drop and recreate the constraint:
--
-- ALTER TABLE public.knowledge_sources DROP CONSTRAINT IF EXISTS knowledge_sources_pkey;
-- ALTER TABLE public.knowledge_sources ADD CONSTRAINT knowledge_sources_pkey PRIMARY KEY (source_id);
--
-- For most modern PostgreSQL versions, renaming the column is sufficient, and the constraint
-- will correctly track the renamed column. It's good practice to verify
-- constraint definitions after such an operation if unsure.
