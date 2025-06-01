// supabase/functions/url-source-checker/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2' // Ensure SupabaseClient type is available if needed

// --- Environment Variables ---
// These must be set in your Supabase project's Edge Function settings.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

// --- User Agent for HTTP Requests ---
const USER_AGENT = 'Mozilla/5.0 (compatible; SynChatSupabaseEdgeMonitor/1.0; +https://www.synchatai.com/bot-monitor)';

// TODO: (Leve Issue #4 - Fragile HTML-to-Text Extraction)
// The current regex-based HTML stripping in `basicHtmlToText` is basic and can be fragile
// with complex HTML structures. For future improvement, integrate a more robust
// Deno-compatible HTML parsing library (e.g., Deno DOM - https://deno.land/x/deno_dom)
// for better text extraction. This would lead to more reliable content hashing and change detection.
// For MVP, the current approach is acceptable if monitored for inaccuracies.
// Original Issue Tracker Ref: [Link to original issue if available, e.g., GitHub Issue #XYZ]
// --- Helper: Simplified Text Extraction (Conceptual for Deno) ---
// Cheerio is a Node.js library. For Deno, one might use Deno DOM or regex.
// This is a very basic placeholder. A more robust solution would be needed for real HTML parsing.
function basicHtmlToText(html: string): string {
  if (!html) return "";
  // Remove script and style elements
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Replace multiple whitespace characters with a single space and trim
  return text.replace(/\s\s+/g, ' ').trim();
}

// --- Helper: SHA256 Hashing (Deno specific using SubtleCrypto) ---
async function calculateSha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// --- Core Logic (Adapted conceptual version of checkUrlSourceStatus) ---
// This interface reflects the fields selected from the database
interface SelectedSource {
  source_id: string;
  source_name: string; // Changed from source_url, as source_name contains the URL for 'url' type
  last_known_content_hash: string | null;
  client_id: string;
}

// This interface is what checkAndRecordSourceStatus expects internally
interface SourceForProcessing {
  source_id: string;
  source_url: string;
  last_known_content_hash: string | null;
  client_id: string;
}

async function checkAndRecordSourceStatus(supabaseAdmin: SupabaseClient, source: SourceForProcessing): Promise<boolean> {
  console.log(`(EdgeFunc) Checking source ID: ${source.source_id}, URL: ${source.source_url}`);
  let accessibilityStatus = 'UNKNOWN_ERROR_EDGE';
  let newHash = null;
  let mainStatusUpdate = {}; // To update the main 'status' column if needed

  try {
    const response = await fetch(source.source_url, {
      headers: { 'User-Agent': USER_AGENT },
      // Consider adding a timeout mechanism if Deno's fetch supports it or use AbortController
    });

    if (response.ok) { // Status 200-299
      const htmlContent = await response.text();
      if (!htmlContent) {
        accessibilityStatus = 'ERROR_EMPTY_CONTENT_EDGE';
      } else {
        const newTextContent = basicHtmlToText(htmlContent); // Using simplified Deno-compatible text extraction
        if (!newTextContent.trim()) {
          accessibilityStatus = 'ERROR_NO_TEXT_EXTRACTED_EDGE';
        } else {
          newHash = await calculateSha256(newTextContent);
          if (source.last_known_content_hash && source.last_known_content_hash === newHash) {
            accessibilityStatus = 'OK_EDGE';
          } else {
            accessibilityStatus = 'CONTENT_CHANGED_SIGNIFICANTLY_EDGE';
            mainStatusUpdate = { status: 'pending_reingest' }; // Mark for re-ingestion
            console.log(`(EdgeFunc) Content change detected for source ID: ${source.source_id}. Old hash: ${source.last_known_content_hash}, New hash: ${newHash}`);
          }
        }
      }
    } else {
      accessibilityStatus = `ERROR_${response.status}_EDGE`;
      console.warn(`(EdgeFunc) HTTP error for source ID: ${source.source_id}. Status: ${response.status}`);
    }
  } catch (error) {
    // Deno's fetch throws for network errors (unlike Axios which might resolve with error.response)
    accessibilityStatus = 'ERROR_CONNECTION_EDGE';
    console.warn(`(EdgeFunc) Network/Connection error for source ID: ${source.source_id}. URL: ${source.source_url}`, error.message);
  }

  // Update knowledge_sources table
  const updatePayload: any = {
    last_accessibility_check_at: new Date().toISOString(),
    last_accessibility_status: accessibilityStatus,
    ...mainStatusUpdate
  };

  if (newHash && (accessibilityStatus === 'CONTENT_CHANGED_SIGNIFICANTLY_EDGE' || accessibilityStatus === 'OK_EDGE')) {
    updatePayload.last_known_content_hash = newHash;
  }

  try {
    const { error: dbError } = await supabaseAdmin
      .from('knowledge_sources')
      .update(updatePayload)
      .eq('source_id', source.source_id); // Assuming 'id' is the primary key column for knowledge_sources

    if (dbError) {
      console.error(`(EdgeFunc) DB Error updating source ID ${source.source_id}:`, dbError.message);
      return false;
    } else {
      console.log(`(EdgeFunc) Updated source ID ${source.source_id} with status: ${accessibilityStatus}. Main status: ${mainStatusUpdate.status || '(no change)'}`);
      return true;
    }
  } catch (dbUpdateError) {
    console.error(`(EdgeFunc) DB Exception updating source ID ${source.source_id}:`, dbUpdateError.message);
    return false;
  }
}


// --- Server Logic ---
serve(async (req) => {
  // This function is intended to be triggered by a cron job (e.g., Supabase scheduler).
  // For direct HTTP invocation, ensure proper security (e.g., a secret in Authorization header).
  // Example: Check for a specific header or a secret query parameter if not using Supabase's internal scheduler.
  // const authHeader = req.headers.get('Authorization')
  // if (authHeader !== `Bearer ${Deno.env.get('CRON_SECRET')}`) {
  //   return new Response("Unauthorized", { status: 401 })
  // }


  console.log("(EdgeFunc) URL Source Checker started.");
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase environment variables (URL or Service Role Key).");
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Query for URL sources to check:
    // - Type 'url'
    // - Not checked in the last N days (e.g., 7 days) OR never checked.
    // - Optionally, filter by reingest_frequency if you want to respect that.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Note: 'id' is typically the primary key for Supabase tables.
    // If your knowledge_sources table uses 'source_id' as PK, adjust .eq('id', source.id) below.
    const { data: sources, error: queryError } = await supabaseAdmin
      .from('knowledge_sources')
      .select('source_id, source_name, last_known_content_hash, client_id') // Removed source_url, using source_name
      .eq('source_type', 'url')
      // Check sources not checked in last 7 days OR never checked at all.
      .or(`last_accessibility_check_at.is.null,last_accessibility_check_at.<=${sevenDaysAgo}`)
      // .limit(10) // Process in batches if you have many sources

    if (queryError) {
      console.error("(EdgeFunc) Error querying sources:", queryError);
      throw queryError;
    }

    if (!sources || sources.length === 0) {
      console.log("(EdgeFunc) No URL sources due for checking.");
      return new Response(JSON.stringify({ message: 'No URL sources due for checking.' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`(EdgeFunc) Found ${sources.length} URL sources to check.`);
    const totalSourcesAttempted = sources.length;
    let dbUpdateFailures = 0;

    for (const source of sources as SelectedSource[]) { // Cast to the new interface
      // For 'url' type sources, the URL is stored in 'source_name'.
      const urlToCheck = source.source_name; // Directly use source_name
      if (urlToCheck && urlToCheck.startsWith('http')) {
        // Construct the object expected by checkAndRecordSourceStatus
        const sourceForProcessing: SourceForProcessing = {
          source_id: source.source_id,
          source_url: urlToCheck, // Map source_name to source_url for the function
          last_known_content_hash: source.last_known_content_hash,
          client_id: source.client_id,
        };
        const updateSuccess = await checkAndRecordSourceStatus(supabaseAdmin, sourceForProcessing);
        if (!updateSuccess) {
          dbUpdateFailures++;
        }
      } else {
        console.warn(`(EdgeFunc) Skipping source ID ${source.source_id} as URL is invalid or missing: ${urlToCheck}`);
        // Not incrementing dbUpdateFailures here as it's a skip, not a DB write failure.
      }
    }

    const failureThresholdPercentage = 0.20; // 20%
    const minAbsoluteDbFailuresForAlert = 3;

    if (totalSourcesAttempted > 0 &&
        (dbUpdateFailures >= minAbsoluteDbFailuresForAlert ||
         (dbUpdateFailures / totalSourcesAttempted) > failureThresholdPercentage)) {
      await sendAlert(
        supabaseAdmin,
        'url-source-checker',
        'critical',
        'High rate of database update failures during source checking.',
        {
          totalSourcesAttempted: totalSourcesAttempted,
          dbUpdateFailures: dbUpdateFailures,
          failureRate: (dbUpdateFailures / totalSourcesAttempted).toFixed(2)
        }
      );
    }

    return new Response(JSON.stringify({ message: `Processed ${totalSourcesAttempted} sources. DB update failures: ${dbUpdateFailures}.` }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    await sendAlert(null, 'url-source-checker', 'critical', 'Url-source-checker function failed catastrophically.', { error: error.message, stack: error.stack });
    console.error('(EdgeFunc) Error in URL source checker function:', error.message, error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

/*
Documentation Notes for this Edge Function:

1.  **Purpose:**
    This Edge Function (`url-source-checker`) is designed to periodically check the accessibility
    and content of URL-based knowledge sources stored in the `public.knowledge_sources` table.
    It aims to detect changes in content (via hashing) or HTTP errors, and update
    the source's status accordingly, potentially flagging it for re-ingestion.

2.  **Scheduling:**
    This function is intended to be invoked by a scheduler, such as Supabase's built-in
    cron job scheduler (via `pg_cron` and calling a wrapper SQL function that invokes this Edge Function,
    or directly using the "Invoke Edge function" feature in the Supabase dashboard if available for cron).
    A typical schedule might be daily or every few hours, depending on monitoring needs.

3.  **Environment Variables:**
    The following environment variables MUST be configured in the Supabase Edge Function settings:
    *   `SUPABASE_URL`: Your Supabase project URL.
    *   `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service_role key for admin-level database access.
    *   (Optional) `CRON_SECRET`: If you implement HTTP invocation with a secret key for security.

4.  **Core Logic (`checkAndRecordSourceStatus` - adapted for Deno):**
    *   **Fetching URL:** Uses Deno's native `fetch` API to get the content of the `source_url`.
    *   **Text Extraction:** Implements a very basic `basicHtmlToText` function using regex. For more
        robust HTML parsing, a Deno-compatible DOM parser would be needed (e.g., Deno DOM).
        The current version is a placeholder and might not be suitable for complex HTML structures.
    *   **Content Hashing:** Uses Deno's `crypto.subtle.digest('SHA-256', ...)` for SHA256 hashing.
    *   **Status Updates:**
        *   If an HTTP error (e.g., 404, 503) occurs, `last_accessibility_status` is updated (e.g., `ERROR_404_EDGE`).
        *   If the content hash changes significantly compared to `last_known_content_hash`,
            `last_accessibility_status` is set to `CONTENT_CHANGED_SIGNIFICANTLY_EDGE`,
            the `last_known_content_hash` is updated, and the main `status` of the knowledge source
            is set to `pending_reingest`.
        *   If the content hash is the same, `last_accessibility_status` is set to `OK_EDGE`.
        *   `last_accessibility_check_at` is always updated.

5.  **Querying Sources:**
    *   The function queries `knowledge_sources` for records where `source_type` is 'url'.
    *   It checks sources that haven't been checked in the last 7 days or have never been checked.
    *   It assumes the URL for 'url' type sources is stored in `source_name` or `source_url`.

6.  **Limitations & Future Improvements:**
    *   **Text Extraction:** The current HTML-to-text conversion is very basic.
    *   **Dependency Management:** The `checkUrlSourceStatus` logic from the Node.js `knowledgeSourceMonitorService.js`
        is conceptually re-implemented/adapted here for the Deno environment. Ideally, shared business logic
        would be in Deno-compatible modules, or alternative strategies like having the Edge Function
        trigger a secured API endpoint on the Node.js backend could be used (though this adds complexity).
    *   **Error Handling:** Basic error handling is in place; more sophisticated retry mechanisms or dead-letter queues
        could be added for robustness in a production environment.
    *   **Batch Processing:** For a very large number of sources, consider processing in smaller batches within the
        Edge Function or having the scheduler trigger the function more frequently with smaller limits.
    *   **Timeout for Fetch:** Deno's `fetch` might require an `AbortController` for explicit timeouts if not natively supported for all cases.
*/
