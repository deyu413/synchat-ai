import { createClient } from 'supabase';
import { corsHeaders } from 'cors';

const inactivityTimeoutMinutes = 15;

console.log("Edge Function 'process-inactive-resolutions' initializing.");

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    const cutoffTime = new Date(Date.now() - inactivityTimeoutMinutes * 60 * 1000).toISOString();

    // CORRECCIÓN LÓGICA: Hemos eliminado el filtro .eq('resolution_status', 'pending')
    console.log(`Querying conversations: status='open', last_message_at < ${cutoffTime}`);

    const { data: candidates, error: fetchError } = await supabaseAdmin
      .from('conversations')
      .select('conversation_id, client_id, last_message_at')
      .eq('status', 'open') // <-- AHORA SOLO BUSCA POR ESTE ESTADO
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
    let resolvedCount = 0;
    const errors: { conversation_id?: string; message: string }[] = [];

    for (const candidate of candidates as any[]){
      const { data: lastMessage, error: lastMessageError } = await supabaseAdmin
        .from('messages')
        .select('sender')
        .eq('conversation_id', candidate.conversation_id)
        .order('timestamp', { ascending: false }) // Usamos 'created_at' como confirmamos anteriormente
        .limit(1)
        .single();

      if (lastMessageError) {
        const errMsg = `Error fetching last message for CV_ID ${candidate.conversation_id}: ${lastMessageError.message}`;
        console.error(errMsg);
        errors.push({
          conversation_id: candidate.conversation_id,
          message: errMsg
        });
        continue;
      }

      if (lastMessage && lastMessage.sender === 'bot') {
        const { error: rpcError } = await supabaseAdmin.rpc('log_ia_resolution_by_inactivity', {
          p_client_id: candidate.client_id,
          p_conversation_id: candidate.conversation_id
        });

        if (rpcError) {
          const errMsg = `Error calling RPC log_ia_resolution_by_inactivity for CV_ID ${candidate.conversation_id}: ${rpcError.message}`;
          console.error(errMsg);
          errors.push({
            conversation_id: candidate.conversation_id,
            message: errMsg
          });
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
      resolvedByInactivityRpcCall: resolvedCount,
      errorsEncountered: errors.length,
      errorDetails: errors.length > 0 ? errors : undefined
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