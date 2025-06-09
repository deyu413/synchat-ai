// File: supabase/functions/process-inactive-resolutions/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const inactivityTimeoutMinutes = 15; // Configurable: e.g., 15 minutes

interface Conversation {
  conversation_id: string;
  client_id: string;
  last_message_at: string;
}

console.log("Edge Function 'process-inactive-resolutions' initializing.");

Deno.serve(async (req) => {
  // Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set in environment variables.");
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
     if (!supabaseUrl) {
      throw new Error("SUPABASE_URL is not set in environment variables.");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false, // Edge functions are stateless
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    console.log(`Calculating cutoff time: ${inactivityTimeoutMinutes} minutes ago.`);
    const cutoffTime = new Date(Date.now() - inactivityTimeoutMinutes * 60 * 1000).toISOString();

    // Fetch candidate conversations: status = 'open', resolution_status = 'pending', last_message_at < cutoffTime
    const { data: candidates, error: fetchError } = await supabaseAdmin
      .from('conversations')
      .select('conversation_id, client_id, last_message_at')
      .eq('status', 'open') // Or other relevant active statuses like 'bot_active'
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
    const errors: string[] = [];

    for (const candidate of candidates as Conversation[]) {
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
        errors.push(errMsg);
        continue; // Skip to next candidate
      }

      if (lastMessage && lastMessage.sender === 'bot') {
        // If last message was from the bot, proceed to mark as resolved by IA due to inactivity
        const currentBillingCycle = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const resolutionDetails = {
          resolution_method: `inactivity_timeout_${inactivityTimeoutMinutes}min`,
          last_bot_message_at: candidate.last_message_at, // This is last_message_at from conversation, which should match bot's last message time
        };

        console.log(`Attempting to log IA resolution for CV_ID: ${candidate.conversation_id} via RPC.`);
        const { error: rpcError } = await supabaseAdmin.rpc('log_ia_resolution', {
          p_client_id: candidate.client_id,
          p_conversation_id: candidate.conversation_id,
          p_billing_cycle_id: currentBillingCycle,
          p_details: resolutionDetails,
        });

        if (rpcError) {
          const errMsg = `Error calling log_ia_resolution for CV_ID ${candidate.conversation_id}: ${rpcError.message}`;
          console.error(errMsg);
          errors.push(errMsg);
        } else {
          resolvedCount++;
          console.log(`Successfully logged IA resolution for CV_ID: ${candidate.conversation_id}.`);
        }
      } else {
        console.log(`CV_ID ${candidate.conversation_id}: Last message not from bot (sender: ${lastMessage?.sender || 'unknown'}). Skipping resolution.`);
      }
    }

    const summary = {
      message: 'Inactive conversation processing complete.',
      totalCandidates: candidates.length,
      processedCount,
      resolvedByIaDueToInactivity: resolvedCount,
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
    return new Response(JSON.stringify({ error: e.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

/*
Test with Deno CLI:
supabase functions serve --no-verify-jwt --env-file ./supabase/.env.local

Invoke (e.g., from another terminal or Postman, after serving):
curl -X POST 'http://localhost:54321/functions/v1/process-inactive-resolutions' \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY_IF_NEEDED_FOR_DIRECT_INVOKE_TEST_BUT_USUALLY_ANON_KEY_FOR_CLIENTS" \
  -H "Content-Type: application/json" \
  --data '{}'

Note: For scheduled execution, the Authorization header is typically handled by Supabase's internal mechanisms or a cron job service token.
The Edge Function itself uses the service_role_key from env vars for its DB operations.
*/
