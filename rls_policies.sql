-- Enable RLS for the table
ALTER TABLE public.synchat_clients ENABLE ROW LEVEL SECURITY;

-- Create a policy for SELECT operations
CREATE POLICY "Allow client select own data"
ON public.synchat_clients
FOR SELECT
USING (auth.uid() = client_id);

-- Create a policy for INSERT operations
CREATE POLICY "Allow client insert own data"
ON public.synchat_clients
FOR INSERT
WITH CHECK (auth.uid() = client_id);

-- Create a policy for UPDATE operations
CREATE POLICY "Allow client update own data"
ON public.synchat_clients
FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id);

-- Create a policy for DELETE operations
CREATE POLICY "Allow client delete own data"
ON public.synchat_clients
FOR DELETE
USING (auth.uid() = client_id);

-- Enable RLS for the conversations table
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Create a policy for SELECT operations on conversations
CREATE POLICY "Allow client select own conversations"
ON public.conversations
FOR SELECT
USING (auth.uid() = client_id);

-- Create a policy for INSERT operations on conversations
CREATE POLICY "Allow client insert own conversations"
ON public.conversations
FOR INSERT
WITH CHECK (auth.uid() = client_id);

-- Create a policy for UPDATE operations on conversations
CREATE POLICY "Allow client update own conversations"
ON public.conversations
FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id);

-- Create a policy for DELETE operations on conversations
CREATE POLICY "Allow client delete own conversations"
ON public.conversations
FOR DELETE
USING (auth.uid() = client_id);

-- Enable RLS for the knowledge_base table
ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

-- Create a policy for SELECT operations on knowledge_base
CREATE POLICY "Allow client select own knowledge_base entries"
ON public.knowledge_base
FOR SELECT
USING (auth.uid() = client_id);

-- Create a policy for INSERT operations on knowledge_base
CREATE POLICY "Allow client insert own knowledge_base entries"
ON public.knowledge_base
FOR INSERT
WITH CHECK (auth.uid() = client_id);

-- Create a policy for UPDATE operations on knowledge_base
CREATE POLICY "Allow client update own knowledge_base entries"
ON public.knowledge_base
FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id);

-- Create a policy for DELETE operations on knowledge_base
CREATE POLICY "Allow client delete own knowledge_base entries"
ON public.knowledge_base
FOR DELETE
USING (auth.uid() = client_id);

-- Enable RLS for the ia_resolutions_log table
ALTER TABLE public.ia_resolutions_log ENABLE ROW LEVEL SECURITY;

-- Create a policy for SELECT operations on ia_resolutions_log
CREATE POLICY "Allow client select own ia_resolutions_log entries"
ON public.ia_resolutions_log
FOR SELECT
USING (auth.uid() = client_id);

-- Create a policy for INSERT operations on ia_resolutions_log
CREATE POLICY "Allow client insert own ia_resolutions_log entries"
ON public.ia_resolutions_log
FOR INSERT
WITH CHECK (auth.uid() = client_id);

-- Create a policy for UPDATE operations on ia_resolutions_log
CREATE POLICY "Allow client update own ia_resolutions_log entries"
ON public.ia_resolutions_log
FOR UPDATE
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id);

-- Create a policy for DELETE operations on ia_resolutions_log
CREATE POLICY "Allow client delete own ia_resolutions_log entries"
ON public.ia_resolutions_log
FOR DELETE
USING (auth.uid() = client_id);

-- Enable RLS for the messages table
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Create a policy for SELECT operations on messages
CREATE POLICY "Allow client select messages in own conversations"
ON public.messages
FOR SELECT
USING (EXISTS (SELECT 1 FROM public.conversations WHERE conversations.conversation_id = messages.conversation_id AND conversations.client_id = auth.uid()));

-- Create a policy for INSERT operations on messages
CREATE POLICY "Allow client insert messages in own conversations"
ON public.messages
FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.conversations WHERE conversations.conversation_id = messages.conversation_id AND conversations.client_id = auth.uid()));

-- Create a policy for UPDATE operations on messages
CREATE POLICY "Allow client update messages in own conversations"
ON public.messages
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.conversations WHERE conversations.conversation_id = messages.conversation_id AND conversations.client_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.conversations WHERE conversations.conversation_id = messages.conversation_id AND conversations.client_id = auth.uid()));

-- Create a policy for DELETE operations on messages
CREATE POLICY "Allow client delete messages in own conversations"
ON public.messages
FOR DELETE
USING (EXISTS (SELECT 1 FROM public.conversations WHERE conversations.conversation_id = messages.conversation_id AND conversations.client_id = auth.uid()));
