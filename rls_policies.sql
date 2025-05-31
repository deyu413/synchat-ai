-- Enable Row Level Security for public.knowledge_base
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

-- Add SELECT policy for public.knowledge_base
CREATE POLICY "Allow select own knowledge_base entries"
ON public.knowledge_base
FOR SELECT
USING (auth.uid() = client_id);

-- Add INSERT policy for public.knowledge_base
CREATE POLICY "Allow insert own knowledge_base entries"
ON public.knowledge_base
FOR INSERT
WITH CHECK (auth.uid() = client_id);

-- Add UPDATE policy for public.knowledge_base
CREATE POLICY "Allow update own knowledge_base entries"
ON public.knowledge_base
FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id AND client_id = (SELECT kb.client_id FROM public.knowledge_base kb WHERE kb.id = id)); -- Ensure client_id cannot be changed

-- Add DELETE policy for public.knowledge_base
CREATE POLICY "Allow delete own knowledge_base entries"
ON public.knowledge_base
FOR DELETE
USING (auth.uid() = client_id);

-- Enable Row Level Security for public.knowledge_sources
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;

-- Add SELECT policy for public.knowledge_sources
CREATE POLICY "Allow select own knowledge_sources entries"
ON public.knowledge_sources
FOR SELECT
USING (auth.uid() = client_id);

-- Add INSERT policy for public.knowledge_sources
CREATE POLICY "Allow insert own knowledge_sources entries"
ON public.knowledge_sources
FOR INSERT
WITH CHECK (auth.uid() = client_id);

-- Add UPDATE policy for public.knowledge_sources
CREATE POLICY "Allow update own knowledge_sources entries"
ON public.knowledge_sources
FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id AND client_id = (SELECT ks.client_id FROM public.knowledge_sources ks WHERE ks.id = id)); -- Ensure client_id cannot be changed

-- Add DELETE policy for public.knowledge_sources
CREATE POLICY "Allow delete own knowledge_sources entries"
ON public.knowledge_sources
FOR DELETE
USING (auth.uid() = client_id);
