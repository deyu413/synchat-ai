-- Create ENUM types for suggestion type and status
DO $$ BEGIN
    CREATE TYPE public.suggestion_type AS ENUM ('content_gap', 'new_faq_from_escalation', 'new_faq_from_success');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE public.suggestion_status AS ENUM ('new', 'reviewed_pending_action', 'action_taken', 'dismissed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create the knowledge_suggestions table
CREATE TABLE IF NOT EXISTS public.knowledge_suggestions (
    suggestion_id BIGSERIAL PRIMARY KEY,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    type public.suggestion_type NOT NULL,
    title TEXT NOT NULL, -- e.g., "Missing info on: Return Policy for International Orders" or "FAQ Suggestion: How to reset password?"
    description TEXT, -- Further details or justification for the suggestion
    source_queries JSONB, -- Array of user queries that triggered this suggestion
    example_resolution TEXT, -- For 'new_faq_from_escalation', could be the agent's successful answer
    status public.suggestion_status NOT NULL DEFAULT 'new',
    related_knowledge_source_ids UUID[], -- Optional: IDs of existing sources that might be relevant to update
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure the handle_updated_at function exists (it was created in a previous migration for conversation_analytics: 20231031000000)
-- If that migration hasn't run or function is missing, uncomment below or ensure it's globally available.
-- CREATE OR REPLACE FUNCTION public.handle_updated_at()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     NEW.updated_at = now();
--     RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

CREATE TRIGGER on_knowledge_suggestions_updated
BEFORE UPDATE ON public.knowledge_suggestions
FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_suggestions_client_id_status ON public.knowledge_suggestions(client_id, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_suggestions_client_id_type ON public.knowledge_suggestions(client_id, type);

-- RLS
ALTER TABLE public.knowledge_suggestions ENABLE ROW LEVEL SECURITY;

-- Allow client users (linked via synchat_clients.user_id) to select their own suggestions.
CREATE POLICY "Allow client select own knowledge_suggestions"
ON public.knowledge_suggestions FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.synchat_clients sc
        WHERE sc.client_id = public.knowledge_suggestions.client_id AND sc.client_id = auth.uid()
    )
);

-- Allow client users to update the status of their own suggestions.
CREATE POLICY "Allow client update own knowledge_suggestions status"
ON public.knowledge_suggestions FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.synchat_clients sc
        WHERE sc.client_id = public.knowledge_suggestions.client_id AND sc.client_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.synchat_clients sc
        WHERE sc.client_id = public.knowledge_suggestions.client_id AND sc.client_id = auth.uid()
    )
    AND (NEW.status IS NOT NULL) -- Client can only update status; other fields protected.
    -- To allow updating only specific columns like status:
    -- AND (NEW.client_id = OLD.client_id) AND (NEW.type = OLD.type) ... etc for all other columns
    -- For simplicity, this check relies on backend logic to only send status updates from client-facing API.
    -- A more restrictive check would explicitly list all non-updatable columns.
);

-- Service role will be used by backend for inserts and more privileged updates.

COMMENT ON TABLE public.knowledge_suggestions IS 'Stores AI-generated suggestions for improving client knowledge bases.';
COMMENT ON COLUMN public.knowledge_suggestions.source_queries IS 'Array of user queries (strings) that triggered or are related to this suggestion.';
COMMENT ON COLUMN public.knowledge_suggestions.example_resolution IS 'For suggestions derived from escalations, this could store the successful agent reply.';
