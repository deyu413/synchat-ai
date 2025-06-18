// File: supabase/functions/process-inactive-resolutions/index.ts
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';

const inactivityTimeoutMinutes = 15; // Configurable: e.g., 15 minutes

interface ConversationCandidate {
  conversation_id: string;
  client_id: string;
  last_message_at: string;
}

console.log("Edge Function 'process-inactive-resolutions' initializing.");

Deno.serve(async (req: Request) => {
  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let supabaseAdmin: SupabaseClient;

  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set in environment variables.");
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
     if (!supabaseUrl) {
      throw new Error("SUPABASE_URL is not set in environment variables.");
    }

    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    console.log(`Calculating cutoff time: ${inactivityTimeoutMinutes} minutes ago.`);
    // Supabase interval syntax is slightly different; constructing for direct SQL filter.
    // The direct JS Date calculation is fine if the query builder handles it,
    // but for raw SQL .lt('last_message_at', `(now() - interval '${inactivityTimeoutMinutes} minutes')`) would be used.
    // The Supabase JS client's .lt() should correctly translate new Date().toISOString().
    const cutoffTime = new Date(Date.now() - inactivityTimeoutMinutes * 60 * 1000).toISOString();
    const timeoutInterval = `${inactivityTimeoutMinutes} minutes`; // For logging clarity if needed, or direct SQL.

    console.log(`Querying conversations: status='open', resolution_status='pending', last_message_at < ${cutoffTime} (older than ${timeoutInterval}).`);

    // Fetch candidate conversations
    const { data: candidates, error: fetchError } = await supabaseAdmin
      .from('conversations')
      .select('conversation_id, client_id, last_message_at')
      .eq('status', 'open')
      .eq('resolution_status', 'pending')
      .lt('last_message_at', cutoffTime);

    if (fetchError) {
      console.error('Error fetching candidate conversations:', fetchError);
      throw new Error(`Error fetching candidates: ${fetchError.message}`);
    }

    if (!candidates || candidates.length === 0) {
      console.log('No inactive conversations found meeting criteria.');
      return new Response(JSON.stringify({ message: 'No inactive conversations to process.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`Found ${candidates.length} candidate conversations for potential resolution.`);
    let processedCount = 0;
    let resolvedCount = 0;
    const errors: { conversation_id?: string; message: string }[] = [];

    for (const candidate of candidates as ConversationCandidate[]) {
      processedCount++;
      console.log(`Processing candidate CV_ID: ${candidate.conversation_id}, Client: ${candidate.client_id}, LastMsgAt: ${candidate.last_message_at}`);

      // Fetch the last message for this conversation
      const { data: lastMessage, error: lastMessageError } = await supabaseAdmin
        .from('messages')
        .select('sender')
        .eq('conversation_id', candidate.conversation_id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (lastMessageError) {
        const errMsg = `Error fetching last message for CV_ID ${candidate.conversation_id}: ${lastMessageError.message}`;
        console.error(errMsg);
        errors.push({ conversation_id: candidate.conversation_id, message: errMsg });
        continue;
      }

      if (lastMessage && lastMessage.sender === 'bot') {
        console.log(`Attempting to call RPC 'log_ia_resolution_by_inactivity' for CV_ID: ${candidate.conversation_id}.`);

        // Call the RPC function assumed to be created by the project owner
        // This RPC function handles setting resolution_status, updated_at, and logging to ia_resolutions_log.
        const { error: rpcError } = await supabaseAdmin.rpc('log_ia_resolution_by_inactivity', {
          p_client_id: candidate.client_id,
          p_conversation_id: candidate.conversation_id,
          // p_billing_cycle_id and p_details are handled by the RPC itself
        });

        if (rpcError) {
          const errMsg = `Error calling RPC log_ia_resolution_by_inactivity for CV_ID ${candidate.conversation_id}: ${rpcError.message}`;
          console.error(errMsg);
          errors.push({ conversation_id: candidate.conversation_id, message: errMsg });
        } else {
          resolvedCount++;
          console.log(`Successfully called RPC for IA resolution for CV_ID: ${candidate.conversation_id}.`);
        }
      } else {
        console.log(`CV_ID ${candidate.conversation_id}: Last message not from bot (sender: ${lastMessage?.sender || 'unknown'}). Skipping resolution.`);
      }
    }

    const summary = {
      message: 'Inactive conversation processing complete.',
      totalCandidates: candidates.length,
      processedCandidates: processedCount,
      resolvedByInactivityRpcCall: resolvedCount,
      errorsEncountered: errors.length,
      errorDetails: errors.length > 0 ? errors : undefined,
    };
    console.log("Processing summary:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (e) {
    console.error('Critical error in Edge Function:', e);
    return new Response(JSON.stringify({ error: e.message || 'Internal Server Error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

/*
To test locally (ensure Supabase stack is running and env vars are set):
1. Save this as supabase/functions/process-inactive-resolutions/index.ts
2. Create/update supabase/functions/_shared/cors.ts if not present:
   export const corsHeaders = {
     'Access-Control-Allow-Origin': '*',
     'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
   };
3. Run: supabase functions serve --no-verify-jwt --env-file ./supabase/.env.local
4. Invoke: curl -X POST 'http://localhost:54321/functions/v1/process-inactive-resolutions' \
   -H "Content-Type: application/json" --data '{}'
   (No specific Authorization header needed for invocation if function is called by scheduler,
    as it uses service_role_key internally from env vars for DB ops)
*/
