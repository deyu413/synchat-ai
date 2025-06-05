-- Supabase Migration: Add billing_cycle_id to synchat_clients table
-- Timestamp: 20250605013404

ALTER TABLE public.synchat_clients
ADD COLUMN billing_cycle_id TEXT NULL;

COMMENT ON COLUMN public.synchat_clients.billing_cycle_id IS 'Current billing cycle identifier for the client (e.g., YYYY-MM). Used for tracking and associating usage.';
