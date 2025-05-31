ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Drop generic policy if it was created in error or for testing
DROP POLICY IF EXISTS "Allow all based on conversation ownership" ON public.messages;

CREATE POLICY "Allow SELECT based on conversation ownership"
ON public.messages FOR SELECT
USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.conversation_id = messages.conversation_id AND c.client_id = auth.uid()
));

CREATE POLICY "Allow INSERT based on conversation ownership"
ON public.messages FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.conversation_id = messages.conversation_id AND c.client_id = auth.uid()
));

CREATE POLICY "Allow DELETE based on conversation ownership"
ON public.messages FOR DELETE
USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.conversation_id = messages.conversation_id AND c.client_id = auth.uid()
));

-- Messages are generally immutable; updates are restricted.
-- If specific updates are needed (e.g., by service_role for redaction),
-- a separate, more targeted policy should be created for that role/purpose.
-- Example for service_role if needed:
-- CREATE POLICY "Allow service_role to update messages"
-- ON public.messages FOR UPDATE
-- TO service_role
-- USING (true)
-- WITH CHECK (true);
