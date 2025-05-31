// supabase/functions/knowledge-suggestion-generator/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// --- Environment Variables ---
// These must be set in your Supabase project's Edge Function settings.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// This Edge Function would call back to your main backend to trigger the Node.js services.
const BACKEND_API_URL = Deno.env.get('BACKEND_API_URL')! // e.g., https://your-app.vercel.app/api
const INTERNAL_API_SECRET = Deno.env.get('INTERNAL_API_SECRET')! // A secret to authenticate this Edge Function to your backend

// Placeholder for a more robust alerting system (e.g., DB table insert)
async function sendAlert(supabaseAdmin: SupabaseClient | null, functionName: string, severity: string, message: string, details: object) {
  const alertPayload = {
    function_name: functionName,
    severity: severity,
    message: message,
    details: details,
    // created_at would be defaulted by DB if inserting
  };
  console.error(`ALERT [${severity.toUpperCase()}] for ${functionName}: ${message}`, details);

  // Example: Insert into a system_alerts table (if it exists and SupabaseClient is provided)
  if (supabaseAdmin) {
    try {
      const { error } = await supabaseAdmin.from('system_alerts').insert([alertPayload]);
      if (error) {
        console.error(`(EdgeFunc) Failed to insert alert into system_alerts for ${functionName}:`, error);
      } else {
        console.log(`(EdgeFunc) System alert for ${functionName} successfully recorded.`);
      }
    } catch (e) {
      console.error(`(EdgeFunc) Exception while trying to store alert for ${functionName}:`, e);
    }
  }
}

interface Client {
  client_id: string;
  // Add other relevant fields if needed, e.g., for filtering active clients
}

async function triggerSuggestionGenerationForClient(clientId: string, supabaseAdminForAlerts: SupabaseClient | null): Promise<boolean> {
  console.log(`(EdgeFunc) Triggering suggestion generation for client: ${clientId}`);
  let success = true;

  const headers = {
    'Content-Type': 'application/json',
    'X-Internal-Api-Secret': INTERNAL_API_SECRET, // Secure your callback endpoint
  };

  try {
    // Trigger Content Gap Suggestions
    const contentGapResponse = await fetch(`${BACKEND_API_URL}/internal/suggestions/generate-content-gaps`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ clientId }),
    });
    if (!contentGapResponse.ok) {
      console.error(`(EdgeFunc) Error triggering content gap suggestions for ${clientId}: ${contentGapResponse.status} ${await contentGapResponse.text()}`);
      success = false;
    } else {
      console.log(`(EdgeFunc) Successfully triggered content gap suggestions for ${clientId}.`);
    }

    // Trigger FAQ Suggestions from Escalations
    const faqEscalationResponse = await fetch(`${BACKEND_API_URL}/internal/suggestions/generate-faq-from-escalations`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ clientId }),
    });
    if (!faqEscalationResponse.ok) {
      console.error(`(EdgeFunc) Error triggering FAQ (escalation) suggestions for ${clientId}: ${faqEscalationResponse.status} ${await faqEscalationResponse.text()}`);
      success = false;
    } else {
      console.log(`(EdgeFunc) Successfully triggered FAQ (escalation) suggestions for ${clientId}.`);
    }

  } catch (error) {
    console.error(`(EdgeFunc) Exception while triggering suggestions for client ${clientId}:`, error.message);
    success = false;
  }
  return success;
}

serve(async (req) => {
  console.log("(EdgeFunc) Knowledge Suggestion Generator started.");

  // Security: Ensure this is triggered by a trusted source (e.g., Supabase scheduler, or a specific auth mechanism)
  // For example, Supabase cron jobs call with service_role key if function is invoked directly.
  // If HTTP triggered by external scheduler, check a secret header:
  // const authHeader = req.headers.get('Authorization');
  // if (authHeader !== `Bearer ${Deno.env.get('CRON_JOB_SECRET')}`) {
  //   return new Response("Unauthorized", { status: 401 });
  // }


  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BACKEND_API_URL || !INTERNAL_API_SECRET) {
    console.error("(EdgeFunc) Missing critical environment variables.");
    return new Response(JSON.stringify({ error: "Internal server configuration error." }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch active clients (or criteria for clients needing suggestions)
    // Example: Fetch all clients, or filter by subscription status, activity, etc.
    const { data: clients, error: queryError } = await supabaseAdmin
      .from('synchat_clients') // Assuming you have a table of your clients
      .select('client_id') // Fetch only client_id
      // .eq('status', 'active') // Optional: Filter for active clients
      // .eq('suggestions_enabled', true) // Optional: If you have a flag

    if (queryError) {
      console.error("(EdgeFunc) Error querying clients:", queryError);
      throw queryError;
    }

    if (!clients || clients.length === 0) {
      console.log("(EdgeFunc) No clients found to process for suggestions.");
      return new Response(JSON.stringify({ message: 'No clients to process.' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`(EdgeFunc) Found ${clients.length} clients to process for suggestions.`);
    const totalClients = clients.length;
    let failedClientOperations = 0;

    for (const client of clients) {
      const clientSuccess = await triggerSuggestionGenerationForClient(client.client_id, supabaseAdmin);
      if (!clientSuccess) {
        failedClientOperations++;
      }
      // Add a small delay if calling out to many clients to avoid overwhelming your backend
      await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second delay
    }

    const failureThresholdPercentage = 0.3; // 30%
    const minAbsoluteFailuresForAlert = 3; // Minimum number of failures to trigger alert, regardless of percentage

    if (totalClients > 0 &&
        (failedClientOperations >= minAbsoluteFailuresForAlert ||
         (failedClientOperations / totalClients) > failureThresholdPercentage)) {
      await sendAlert(
        supabaseAdmin,
        'knowledge-suggestion-generator',
        'critical',
        'High failure rate in suggestion generation process.',
        {
          totalClientsProcessed: totalClients,
          failedClientOperations: failedClientOperations,
          failureRate: (failedClientOperations / totalClients).toFixed(2)
        }
      );
    }

    return new Response(JSON.stringify({ message: `Attempted suggestion generation for ${clients.length} clients. Failed operations: ${failedClientOperations}` }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    // Consider a top-level alert if the whole function fails catastrophically before/during client loop
    await sendAlert(
      null, // supabaseAdmin might not be initialized if error is very early
      'knowledge-suggestion-generator',
      'critical',
      'Main serve function failed catastrophically.',
      { error: error.message, stack: error.stack }
    );
    console.error('(EdgeFunc) Error in knowledge suggestion generator function:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

/*
Documentation Notes for this Edge Function:

1.  **Purpose:**
    This Edge Function (`knowledge-suggestion-generator`) is designed to be a scheduled task
    that initiates the knowledge suggestion generation process for clients. Instead of
    containing the complex Node.js logic directly (which is hard to port to Deno along with
    its dependencies like full-featured LLM SDKs, Cheerio, etc.), this function calls
    back to secured API endpoints on your main Node.js backend.

2.  **Scheduling:**
    This function should be invoked by a scheduler, such as Supabase's built-in
    cron job scheduler (e.g., set to run daily or weekly).

3.  **Environment Variables:**
    The following environment variables MUST be configured in the Supabase Edge Function settings:
    *   `SUPABASE_URL`: Your Supabase project URL.
    *   `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service_role key.
    *   `BACKEND_API_URL`: The base URL of your main Node.js backend (e.g., "https://your-app.vercel.app/api").
    *   `INTERNAL_API_SECRET`: A shared secret key used to authenticate requests from this Edge Function
        to your backend's internal suggestion generation endpoints. This ensures that only this
        trusted Edge Function can trigger those backend operations.

4.  **Workflow:**
    a.  The Edge Function is triggered by its schedule.
    b.  It fetches a list of clients from the `synchat_clients` table (e.g., all active clients).
    c.  For each client, it makes POST requests to two dedicated, secured API endpoints on your
        main backend:
        *   One endpoint to trigger `generateContentGapSuggestions(clientId)`.
        *   Another endpoint to trigger `generateFaqSuggestionsFromEscalations(clientId)`.
    d.  These backend endpoints would then execute the Node.js service functions defined in
        `knowledgeSuggestionService.js`.

5.  **Security of Callback Endpoints:**
    *   The backend API endpoints (e.g., `/internal/suggestions/generate-content-gaps`)
        MUST be secured. The example uses a shared secret (`X-Internal-Api-Secret` header)
        for authentication. This is crucial to prevent unauthorized triggering of these potentially
        resource-intensive operations.
    *   These internal endpoints should not be exposed publicly without authentication/authorization.

6.  **Why this approach?**
    *   **Leverages Existing Node.js Logic:** Avoids re-implementing complex Node.js service logic
        (especially LLM interactions, HTML parsing with Cheerio, and potentially complex DB queries
        managed by the Node.js ORM/client) in the Deno environment of Edge Functions.
    *   **Deno for Scheduling & Light Tasks:** Edge Functions are well-suited for lightweight tasks
        like fetching a list and making outbound API calls, which is what this function does.
    *   **Centralized Logic:** Keeps the core suggestion generation logic within your main Node.js
        backend, making it easier to maintain and evolve.

7.  **Backend API Endpoints (To Be Created in Node.js):**
    You will need to create corresponding routes and controller functions in your Node.js backend
    (e.g., in a new `internalRoutes.js` or similar) that handle these POST requests from the
    Edge Function, verify the `INTERNAL_API_SECRET`, and then call the respective functions
    in `knowledgeSuggestionService.js`.
*/
