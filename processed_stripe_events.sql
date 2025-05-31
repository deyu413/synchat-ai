-- Create the processed_stripe_events table
-- This table stores the IDs of Stripe events that have already been processed by the webhook handler.
-- This is to prevent processing the same event multiple times, which can happen due to Stripe's retry mechanism.
CREATE TABLE processed_stripe_events (
    -- The unique identifier of the Stripe event.
    event_id TEXT PRIMARY KEY NOT NULL,
    -- The timestamp of when the event was processed.
    processed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Add comments to the table and columns
COMMENT ON TABLE processed_stripe_events IS 'Stores the IDs of Stripe events that have already been processed by the webhook handler.';
COMMENT ON COLUMN processed_stripe_events.event_id IS 'The unique identifier of the Stripe event.';
COMMENT ON COLUMN processed_stripe_events.processed_at IS 'The timestamp of when the event was processed.';

-- Enable Row Level Security (RLS) for the table
-- This ensures that the table is not publicly accessible and can only be accessed by the backend using its service role key.
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;

-- Define a policy that DENIES ALL operations by default
-- This is a security measure to prevent any accidental or unauthorized access to the table.
-- The backend should use its service role key to bypass RLS when accessing this table.
CREATE POLICY "Deny ALL operations" ON processed_stripe_events
FOR ALL
USING (false)
WITH CHECK (false);
