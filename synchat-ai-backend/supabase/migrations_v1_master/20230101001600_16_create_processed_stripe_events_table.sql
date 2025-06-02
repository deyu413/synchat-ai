-- Define the public.processed_stripe_events table

CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Comments
COMMENT ON TABLE public.processed_stripe_events IS 'Stores the IDs of Stripe events that have already been processed by the webhook handler to ensure idempotency.';
COMMENT ON COLUMN public.processed_stripe_events.event_id IS 'The unique identifier of the Stripe event (e.g., evt_xxxxxxxxxxxxxx).';
COMMENT ON COLUMN public.processed_stripe_events.processed_at IS 'Timestamp of when the event was processed by the webhook handler.';

RAISE NOTICE 'Table public.processed_stripe_events created with comments.';

-- RLS will be applied in a subsequent, dedicated RLS migration file.
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;
