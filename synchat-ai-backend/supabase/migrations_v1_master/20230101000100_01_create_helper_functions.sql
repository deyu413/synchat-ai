-- Define common helper functions used by various triggers

-- Function to automatically update an 'updated_at' timestamp column
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.handle_updated_at() IS 'Updates the updated_at column to the current timestamp upon row modification.';

-- Add other general-purpose helper functions here if identified during analysis.

RAISE NOTICE 'Helper function (handle_updated_at) created.';
