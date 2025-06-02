-- Add deferred foreign key constraint from messages.rag_interaction_ref to rag_interaction_logs.log_id

ALTER TABLE public.messages
ADD CONSTRAINT fk_messages_rag_interaction_logs
FOREIGN KEY (rag_interaction_ref)
REFERENCES public.rag_interaction_logs(log_id)
ON DELETE SET NULL;

COMMENT ON COLUMN public.messages.rag_interaction_ref IS 'Reference to the RAG interaction log entry that may have generated this message (if it is a bot message). Constraint added after rag_interaction_logs table creation.';

RAISE NOTICE 'Foreign key constraint fk_messages_rag_interaction_logs on public.messages added.';
