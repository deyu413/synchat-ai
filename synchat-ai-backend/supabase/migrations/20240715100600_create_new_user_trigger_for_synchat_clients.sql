-- Supabase Migration: Create trigger to populate synchat_clients after new user signup
-- Timestamp: 20240715100600

-- 1. Define the trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user_to_synchat_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER -- Important for allowing auth.users trigger to write to public.synchat_clients
AS $$
BEGIN
  -- Insert a new client record using details from the newly created auth.users record.
  -- client_name defaults to the part of the email before the '@' symbol,
  -- or 'New User' if the email is somehow null or doesn't contain '@'.
  INSERT INTO public.synchat_clients (client_id, email, client_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(split_part(NEW.email, '@', 1), 'New User ' || NEW.id::text)
  );
  RETURN NEW; -- The return value of an AFTER trigger is ignored, but returning NEW is common practice.
END;
$$;

COMMENT ON FUNCTION public.handle_new_user_to_synchat_client()
IS 'Handles the creation of a new entry in public.synchat_clients when a new user signs up in auth.users.';

-- 2. Create the trigger
-- This trigger fires after a new user is inserted into auth.users.
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_to_synchat_client();

COMMENT ON TRIGGER on_auth_user_created ON auth.users
IS 'When a new user is created in auth.users, this trigger automatically creates a corresponding client entry in public.synchat_clients.';

-- Security Note:
-- The function `handle_new_user_to_synchat_client` is set with `SECURITY DEFINER`.
-- This means the function executes with the permissions of the user who defined it (usually an admin/superuser role).
-- This is necessary because triggers on `auth.users` (owned by `supabase_auth_admin_usr`)
-- need to write to `public.synchat_clients` (which might be owned by `postgres` or another role).
-- Ensure that the definer role has the necessary INSERT privileges on `public.synchat_clients`.
-- The `search_path` is not explicitly set within the function here, assuming that `public`
-- is in the default search_path for the definer, or that all table references are fully qualified (which they are).
-- For Supabase projects, the `postgres` user is typically the owner of objects in the `public` schema.
-- The `supabase_auth_admin_usr` role (which owns `auth.users`) might not have direct INSERT rights on `public.synchat_clients`
-- without `SECURITY DEFINER`.
--
-- If `client_id` in `synchat_clients` is intended to be a direct foreign key to `auth.users(id)`,
-- this trigger helps populate it. Ensure `synchat_clients.client_id` is of type UUID.
-- The `synchat_clients` table should already exist from a previous migration.
