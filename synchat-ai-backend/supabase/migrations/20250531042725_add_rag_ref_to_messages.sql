-- Add rag_interaction_ref to messages table
ALTER TABLE public.messages
ADD COLUMN rag_interaction_ref BIGINT NULL;

-- Add foreign key constraint
ALTER TABLE public.messages
ADD CONSTRAINT fk_messages_rag_interaction_logs
FOREIGN KEY (rag_interaction_ref)
REFERENCES public.rag_interaction_logs(log_id)
ON DELETE SET NULL;

-- Optional: Add an index for faster lookups if messages will often be queried by rag_interaction_ref
CREATE INDEX IF NOT EXISTS idx_messages_rag_interaction_ref
ON public.messages(rag_interaction_ref);

COMMENT ON COLUMN public.messages.rag_interaction_ref IS 'Reference to the RAG interaction log entry that may have generated this message (if it is a bot message).';
