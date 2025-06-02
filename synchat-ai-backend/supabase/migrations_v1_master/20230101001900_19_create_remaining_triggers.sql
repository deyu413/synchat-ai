-- Define remaining trigger functions and triggers

-- 1. Function and Trigger to populate synchat_clients after new user signup in auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user_to_synchat_client()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER -- Important for allowing auth.users trigger to write to public.synchat_clients
-- SET search_path = public; -- Recommended for SECURITY DEFINER functions
AS $$
BEGIN
  INSERT INTO public.synchat_clients (client_id, email, client_name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(split_part(NEW.email, '@', 1), 'New User ' || NEW.id::text),
    NOW(),
    NOW()
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user_to_synchat_client() IS 'Handles the creation of a new entry in public.synchat_clients when a new user signs up in auth.users.';

-- Drop trigger if it exists from a previous partial run, then create.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_to_synchat_client();

COMMENT ON TRIGGER on_auth_user_created ON auth.users IS 'When a new user is created in auth.users, this trigger automatically creates a corresponding client entry in public.synchat_clients.';

RAISE NOTICE 'Trigger on_auth_user_created on auth.users and function handle_new_user_to_synchat_client created.';

-- 2. Function and Trigger to update conversation_last_message_at on new message
CREATE OR REPLACE FUNCTION public.update_conversation_last_message_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.conversations
    SET last_message_at = NEW."timestamp"
    WHERE conversation_id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.update_conversation_last_message_at() IS 'Trigger function to update the last_message_at field in the conversations table when a new message is inserted.';

-- Drop trigger if it exists, then create.
DROP TRIGGER IF EXISTS on_new_message_update_conversation_timestamp ON public.messages;
CREATE TRIGGER on_new_message_update_conversation_timestamp
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.update_conversation_last_message_at();

COMMENT ON TRIGGER on_new_message_update_conversation_timestamp ON public.messages IS 'After a new message is inserted, updates the last_message_at timestamp in the parent conversation record.';

RAISE NOTICE 'Trigger on_new_message_update_conversation_timestamp on public.messages and function update_conversation_last_message_at created.';
