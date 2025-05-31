ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Drop generic policy if it was created in error or for testing
DROP POLICY IF EXISTS "Allow all for client based on client_id" ON public.conversations;

CREATE POLICY "Allow SELECT for own client_id"
ON public.conversations FOR SELECT
USING (auth.uid() = client_id);

CREATE POLICY "Allow INSERT for own client_id"
ON public.conversations FOR INSERT
WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Allow UPDATE for own client_id"
ON public.conversations FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id AND NEW.client_id = OLD.client_id);

CREATE POLICY "Allow DELETE for own client_id"
ON public.conversations FOR DELETE
USING (auth.uid() = client_id);
