-- Define the public.message_feedback table

CREATE TABLE IF NOT EXISTS public.message_feedback (
    feedback_id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES public.messages(message_id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.synchat_clients(client_id) ON DELETE CASCADE,
    agent_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL, -- Agent who gave feedback
    rating SMALLINT NOT NULL, -- e.g., 1 for positive, -1 for negative
    comment TEXT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Comments
COMMENT ON TABLE public.message_feedback IS 'Stores feedback provided by agents or users on specific messages, typically bot responses.';
COMMENT ON COLUMN public.message_feedback.feedback_id IS 'Unique identifier for the feedback entry.';
COMMENT ON COLUMN public.message_feedback.message_id IS 'Identifier of the message that this feedback pertains to.';
COMMENT ON COLUMN public.message_feedback.client_id IS 'Client associated with this feedback (and the message''s conversation).';
COMMENT ON COLUMN public.message_feedback.agent_user_id IS 'Identifier of the agent (from auth.users) who submitted the feedback.';
COMMENT ON COLUMN public.message_feedback.rating IS 'Numerical rating, e.g., 1 for positive, -1 for negative.';
COMMENT ON COLUMN public.message_feedback.comment IS 'Optional textual comment for the feedback.';
COMMENT ON COLUMN public.message_feedback.created_at IS 'Timestamp of when the feedback was submitted.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_message_feedback_message_id ON public.message_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_message_feedback_client_id ON public.message_feedback(client_id);
CREATE INDEX IF NOT EXISTS idx_message_feedback_agent_user_id ON public.message_feedback(agent_user_id WHERE agent_user_id IS NOT NULL);

RAISE NOTICE 'Table public.message_feedback created with comments and indexes.';

-- RLS will be applied in a subsequent, dedicated RLS migration file.
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;
