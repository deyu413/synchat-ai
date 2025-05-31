-- Ensure RLS is enabled (it should be from the original migration, but good practice to ensure)
ALTER TABLE public.rag_interaction_logs ENABLE ROW LEVEL SECURITY;

-- Drop the overly permissive policy first if it exists
DROP POLICY IF EXISTS "Allow service_role full access to RAG logs" ON public.rag_interaction_logs;
DROP POLICY IF EXISTS "Allow authenticated users to insert RAG logs" ON public.rag_interaction_logs; -- If this was also present
DROP POLICY IF EXISTS "Allow clients to select their own RAG logs" ON public.rag_interaction_logs; -- If this was also present


-- Add new, more restrictive policies for client access
CREATE POLICY "Allow SELECT for own client_id"
ON public.rag_interaction_logs FOR SELECT
USING (auth.uid() = client_id);

CREATE POLICY "Allow INSERT for own client_id"
ON public.rag_interaction_logs FOR INSERT
WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Allow UPDATE for own client_id (restricted)"
ON public.rag_interaction_logs FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id AND NEW.client_id = OLD.client_id); -- Basic check

CREATE POLICY "Allow DELETE for own client_id"
ON public.rag_interaction_logs FOR DELETE
USING (auth.uid() = client_id);

-- Re-add service_role bypass for backend processes that need broader access.
-- This policy should be carefully managed and typically be the last one evaluated for service_role.
CREATE POLICY "Allow service_role full access (privileged)"
ON public.rag_interaction_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
