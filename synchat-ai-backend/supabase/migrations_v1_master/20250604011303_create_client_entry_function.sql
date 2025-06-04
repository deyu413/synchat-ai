-- supabase/migrations_v1_master/20250604011303_create_client_entry_function.sql
CREATE OR REPLACE FUNCTION public.create_synchat_client_entry(
    p_client_id UUID,
    p_email TEXT
)
RETURNS VOID -- Or BOOLEAN, or the client_id, depending on desired feedback
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.synchat_clients (client_id, email, client_name, created_at, updated_at)
  VALUES (
    p_client_id,
    p_email,
    COALESCE(split_part(p_email, '@', 1), 'New User ' || p_client_id::text),
    NOW(),
    NOW()
  )
  ON CONFLICT (client_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.create_synchat_client_entry(UUID, TEXT)
IS 'Creates an entry in public.synchat_clients for a new user. Called explicitly by the backend.';
