-- Migration to create an RPC function for logging IA resolutions,
-- callable by Edge Functions or other backend services.

-- Drop the function if it already exists to allow for redefinition
DROP FUNCTION IF EXISTS public.log_ia_resolution(uuid, uuid, text, jsonb);

-- Create the PL/pgSQL function
CREATE OR REPLACE FUNCTION public.log_ia_resolution(
    p_client_id uuid,
    p_conversation_id uuid,
    p_billing_cycle_id text,
    p_details jsonb
)
RETURNS void -- Or potentially some status/message text
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with the privileges of the user who defined it (owner)
AS $$
DECLARE
    v_current_resolution_status public.resolution_status_enum;
    v_current_client_id uuid;
BEGIN
    -- Fetch current resolution_status and client_id to ensure ownership and avoid redundant updates
    SELECT client_id, resolution_status INTO v_current_client_id, v_current_resolution_status
    FROM public.conversations
    WHERE conversation_id = p_conversation_id;

    -- Check if conversation exists and belongs to the client
    IF NOT FOUND THEN
        RAISE WARNING 'log_ia_resolution: Conversation ID % not found.', p_conversation_id;
        RETURN; -- Or raise an exception
    END IF;

    IF v_current_client_id IS DISTINCT FROM p_client_id THEN
        RAISE WARNING 'log_ia_resolution: Client ID % does not match conversation owner % for CV_ID %.', p_client_id, v_current_client_id, p_conversation_id;
        RETURN; -- Or raise an exception for access violation
    END IF;

    -- Proceed only if resolution_status is 'pending' (or other non-terminal states you might define)
    IF v_current_resolution_status = 'pending' THEN
        -- Update conversation status to 'resolved_by_ia'
        UPDATE public.conversations
        SET resolution_status = 'resolved_by_ia',
            updated_at = now() -- Ensure updated_at reflects this change
        WHERE conversation_id = p_conversation_id;

        -- Insert into ia_resolutions_log
        INSERT INTO public.ia_resolutions_log (
            client_id,
            conversation_id,
            billing_cycle_id,
            resolution_details,
            created_at -- Let default handle this if set up, otherwise now()
        ) VALUES (
            p_client_id,
            p_conversation_id,
            p_billing_cycle_id,
            p_details
        );
        RAISE LOG 'log_ia_resolution: Successfully logged IA resolution for CV_ID %, ClientID %, BillingCycle %', p_conversation_id, p_client_id, p_billing_cycle_id;
    ELSE
        RAISE LOG 'log_ia_resolution: Conversation CV_ID % already has a terminal resolution_status: %. No action taken.', p_conversation_id, v_current_resolution_status;
        -- Optionally, could return a message indicating status was not 'pending'
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'log_ia_resolution: Error processing CV_ID % - SQLSTATE: %, SQLERRM: %', p_conversation_id, SQLSTATE, SQLERRM;
END;
$$;

-- Grant execute permission to the authenticated role (or service_role if preferred and Edge Function uses it)
-- The 'service_role' typically bypasses RLS, but explicit grant is good practice for RPCs.
-- If your Edge Function's Supabase client uses the anon key but then elevates to service_role internally,
-- granting to service_role is appropriate. If it uses a specific user role, grant to that.
GRANT EXECUTE ON FUNCTION public.log_ia_resolution(uuid, uuid, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.log_ia_resolution(uuid, uuid, text, jsonb) IS
'Logs an AI resolution event. Updates conversation status to resolved_by_ia if pending, and creates a log entry in ia_resolutions_log. Designed for use by automated processes like Edge Functions.';
