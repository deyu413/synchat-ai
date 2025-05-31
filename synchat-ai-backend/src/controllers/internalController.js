// src/controllers/internalController.js
import * as knowledgeSuggestionService from '../services/knowledgeSuggestionService.js';
import * as db from '../services/databaseService.js';
import { supabase } from '../services/supabaseClient.js'; // For direct Supabase calls if needed
import * as openaiService from '../services/openaiService.js'; // Corrected import

// Spanish Stop Words (can be shared or redefined here if not easily importable from db service for this controller)
const SPANISH_STOP_WORDS = new Set([
  "de", "la", "el", "en", "y", "a", "los", "las", "del", "un", "una", "unos", "unas",
  "ser", "estar", "haber", "tener", "con", "por", "para", "como", "más", "pero", "si",
  "no", "o", "qué", "que", "cuál", "cuando", "dónde", "quién", "cómo", "desde", "hasta",
  "sobre", "este", "ese", "aquel", "esto", "eso", "aquello", "mi", "tu", "su", "yo", "tú", "él", "ella",
  "nosotros", "vosotros", "ellos", "ellas", "me", "te", "se", "le", "les", "nos", "os",
  "al", "del", "lo", "les", "sus", "tus", "mis" // Added some more
]);

function normalizeQueryText(query) {
    if (!query || typeof query !== 'string') return '';
    let normalized = query.toLowerCase();
    // Remove punctuation - extend this list as needed
    normalized = normalized.replace(/[¿?¡!.,;:"()\[\]{}]/g, '');
    // Optional: remove stop words (consider impact on short queries)
    // normalized = normalized.split(/\s+/).filter(word => !SPANISH_STOP_WORDS.has(word)).join(' ');
    normalized = normalized.replace(/\s+/g, ' ').trim(); // Normalize whitespace
    return normalized;
}

/**
 * Triggers suggestion generation for all active clients.
 * This is intended to be called by a secured internal scheduler (e.g., an Edge Function).
 */
export const triggerAllClientsSuggestionGeneration = async (req, res) => {
    console.log("(InternalCtrl) Received request to trigger suggestion generation for all clients.");

    try {
        const activeClientIds = await db.getAllActiveClientIds();

        if (!activeClientIds || activeClientIds.length === 0) {
            console.log("(InternalCtrl) No active clients found to process for suggestions.");
            return res.status(200).json({ message: "No active clients to process." });
        }

        console.log(`(InternalCtrl) Found ${activeClientIds.length} active clients. Initiating suggestion generation for each.`);

        // Asynchronously trigger generation for all clients.
        // We don't await all promises here to make the HTTP request return quickly.
        // The actual generation happens in the background.
        const generationPromises = activeClientIds.map(clientId => {
            return Promise.allSettled([
                knowledgeSuggestionService.generateContentGapSuggestions(clientId)
                    .then(() => console.log(`(InternalCtrl) Content gap suggestions processed for client ${clientId}.`))
                    .catch(err => console.error(`(InternalCtrl) Error in content gap suggestions for client ${clientId}:`, err.message)),
                knowledgeSuggestionService.generateFaqSuggestionsFromEscalations(clientId)
                    .then(() => console.log(`(InternalCtrl) FAQ from escalation suggestions processed for client ${clientId}.`))
                    .catch(err => console.error(`(InternalCtrl) Error in FAQ from escalation suggestions for client ${clientId}:`, err.message))
            ]);
        });

        // Optional: Log all promises once they settle if you need a summary after all attempts.
        // This part will run after the HTTP response has been sent.
        Promise.allSettled(generationPromises)
            .then(results => {
                console.log("(InternalCtrl) All client suggestion generation triggers have been processed (settled).");
                results.forEach((clientResult, index) => {
                    const clientId = activeClientIds[index];
                    if (clientResult.status === 'fulfilled') {
                        // clientResult.value is an array of two Promise.allSettled results
                        clientResult.value.forEach(opResult => {
                             if (opResult.status === 'rejected') {
                                console.error(`(InternalCtrl) Background processing error for client ${clientId} (one of the suggestion types):`, opResult.reason);
                            }
                        });
                    } else {
                        console.error(`(InternalCtrl) Major error triggering processing for client ${clientId}:`, clientResult.reason);
                    }
                });
            });


        res.status(202).json({
            message: `Suggestion generation process initiated for ${activeClientIds.length} active clients. Completion and any errors will be logged separately by the services.`
        });

    } catch (error) {
        console.error("(InternalCtrl) Critical error fetching client IDs or initiating suggestion generation:", error);
        res.status(500).json({ message: "Failed to initiate suggestion generation due to an internal error." });
    }
};

export const triggerProcessQueryClusters = async (req, res) => {
    console.log('(InternalCtrl) Received request to trigger process query clusters.');
    const BATCH_SIZE_RAG_LOGS = 500; // Process RAG logs in batches for each client
    const MIN_QUERY_GROUP_SIZE_FOR_LLM_LABELING = 3; // Min number of unique queries in a group to get an LLM label
    const MAX_QUERIES_FOR_LLM_PROMPT = 10; // Max unique queries to send to LLM for labeling a topic

    try {
        const activeClientIds = await db.getAllActiveClientIds();
        if (!activeClientIds || activeClientIds.length === 0) {
            console.log('(InternalCtrl) No active clients found.');
            return res.status(200).json({ message: 'No active clients found.' });
        }

        console.log(`(InternalCtrl) Starting topic analysis for ${activeClientIds.length} client(s).`);
        let totalTopicsCreated = 0;
        let totalLogsConsidered = 0;

        for (const client of activeClientIds) { // Assuming activeClientIds is array of {client_id: '...'} as per earlier discussion
            const clientId = client.client_id;
            if (!clientId) continue;

            console.log(`(InternalCtrl) Processing RAG logs for client: ${clientId}`);
            const { data: unprocessedLogs, error: logError } = await db.getUnprocessedRagLogsForClient(clientId, BATCH_SIZE_RAG_LOGS);

            if (logError) {
                console.error(`(InternalCtrl) Error fetching unprocessed logs for client ${clientId}:`, logError);
                continue; // Skip to next client
            }
            if (!unprocessedLogs || unprocessedLogs.length === 0) {
                console.log(`(InternalCtrl) No unprocessed RAG logs found for client ${clientId}.`);
                continue;
            }
            totalLogsConsidered += unprocessedLogs.length;

            // Group queries by normalized text
            const queryGroups = new Map(); // normalizedQuery -> { originalQueries: Set<string>, logIds: Set<number>, conversationIds: Set<string> }
            unprocessedLogs.forEach(log => {
                const normalized = normalizeQueryText(log.user_query);
                if (normalized.length < 3) return; // Skip very short/empty normalized queries

                if (!queryGroups.has(normalized)) {
                    queryGroups.set(normalized, {
                        originalQueries: new Set(),
                        logIds: new Set(),
                        conversationIds: new Set()
                    });
                }
                queryGroups.get(normalized).originalQueries.add(log.user_query);
                queryGroups.get(normalized).logIds.add(log.log_id);
                if (log.conversation_id) {
                    queryGroups.get(normalized).conversationIds.add(log.conversation_id);
                }
            });

            console.log(`(InternalCtrl) Client ${clientId}: Found ${queryGroups.size} unique normalized query groups from ${unprocessedLogs.length} logs.`);

            for (const [normalizedQuery, groupData] of queryGroups.entries()) {
                if (groupData.originalQueries.size < MIN_QUERY_GROUP_SIZE_FOR_LLM_LABELING) {
                    // Not enough unique queries in this group to justify LLM labeling yet, or it's a very specific query.
                    console.log(`(InternalCtrl) Skipping group "${normalizedQuery.substring(0,50)}..." for LLM labeling (size: ${groupData.originalQueries.size}).`);
                    continue;
                }

                const representativeQueries = Array.from(groupData.originalQueries).slice(0, MAX_QUERIES_FOR_LLM_PROMPT);
                let topicName = `Topic for: ${normalizedQuery.substring(0, 50)}...`; // Default name

                try {
                    const systemPrompt = "You are an AI assistant. Based on the following user queries, generate a short, descriptive topic label (3-5 words, in Spanish). Respond with ONLY the label itself, no extra text.";
                    const userPrompt = `User Queries:\n${representativeQueries.map(q => `- "${q}"`).join('\n')}\n\nTopic Label:`;

                    const llmLabel = await openaiService.getChatCompletion( // Corrected to use openaiService.
                        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                        'gpt-3.5-turbo', 0.3, 20
                    );

                    if (llmLabel && llmLabel.trim().length > 0) {
                        topicName = llmLabel.trim();
                    } else {
                        console.warn(`(InternalCtrl) LLM did not return a valid label for group: ${normalizedQuery}`);
                    }
                } catch (llmError) {
                    console.error(`(InternalCtrl) LLM error while generating label for group ${normalizedQuery}:`, llmError.message);
                    // Continue with default topic name
                }

                // Store in analyzed_conversation_topics
                const topicEntry = {
                    client_id: clientId,
                    topic_name: topicName,
                    normalized_query_text: normalizedQuery, // <<< ADD THIS LINE
                    representative_queries: Array.from(groupData.originalQueries).slice(0, 20),
                    query_count: groupData.logIds.size,
                    example_interaction_ids: Array.from(groupData.logIds).slice(0, 5),
                    example_conversation_ids: Array.from(groupData.conversationIds).slice(0,5),
                };

                const { error: insertTopicError } = await supabase
                    .from('analyzed_conversation_topics')
                    .insert(topicEntry);

                if (insertTopicError) {
                    console.error(`(InternalCtrl) Error inserting topic "${topicName}" for client ${clientId}:`, insertTopicError.message);
                } else {
                    totalTopicsCreated++;
                    console.log(`(InternalCtrl) Topic created/updated for client ${clientId}: "${topicName}" (from group "${normalizedQuery.substring(0,50)}...")`);

                    if (groupData.logIds.size > 0) {
                        const logIdsToUpdate = Array.from(groupData.logIds);
                        const { error: updateLogError } = await supabase
                            .from('rag_interaction_logs')
                            .update({ topic_analysis_processed_at: new Date().toISOString() })
                            .in('log_id', logIdsToUpdate);

                        if (updateLogError) {
                            console.error(`(InternalCtrl) Error updating topic_analysis_processed_at for ${logIdsToUpdate.length} RAG logs for client ${clientId}, topic "${topicName}":`, updateLogError.message);
                        } else {
                            console.log(`(InternalCtrl) Successfully marked ${logIdsToUpdate.length} RAG logs as processed for topic analysis for client ${clientId}, topic "${topicName}".`);
                        }
                    }
                }
            }
        }
        res.status(200).json({
            message: `Topic analysis process completed. Clients processed: ${activeClientIds.length}. Logs considered: ${totalLogsConsidered}. Topics created/updated: ${totalTopicsCreated}.`
        });

    } catch (error) {
        console.error('(InternalCtrl) Error in triggerProcessQueryClusters:', error);
        res.status(500).json({ error: 'Failed to process query clusters.', details: error.message });
    }
};
