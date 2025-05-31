-- Add sentiment column to messages table
ALTER TABLE public.messages
ADD COLUMN sentiment TEXT;

COMMENT ON COLUMN public.messages.sentiment IS 'Sentiment of the message (e.g., positive, negative, neutral), typically classified by an LLM for user messages.';

-- Add an index on the new sentiment column if queries will filter by it
CREATE INDEX idx_messages_sentiment ON public.messages(sentiment);
