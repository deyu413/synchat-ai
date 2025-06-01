// src/controllers/internalController.js
import * as knowledgeSuggestionService from '../services/knowledgeSuggestionService.js';
import * as db from '../services/databaseService.js';
import { supabase } from '../services/supabaseClient.js'; // For direct Supabase calls if needed
import * as openaiService from '../services/openaiService.js'; // Corrected import

import { kmeans } from 'ml-kmeans'; // K-Means library

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
    console.log('(InternalCtrl) Received request to trigger process query clusters (K-Means).');
    const BATCH_SIZE_RAG_LOGS = 1000; // How many logs to fetch from DB at a time
    const MIN_CLUSTERS_PER_CLIENT = 3;
    const MAX_CLUSTERS_PER_CLIENT = 30;
    const TARGET_LOGS_PER_CLUSTER = 10;
    const MIN_LOGS_FOR_CLUSTERING = 10;
    const MAX_QUERIES_FOR_LLM_PROMPT = 10; // For representative queries for LLM labeling

    try {
        const activeClientIds = await db.getAllActiveClientIds();
        if (!activeClientIds || activeClientIds.length === 0) {
            console.log('(InternalCtrl) No active clients found.');
            return res.status(200).json({ message: 'No active clients found.' });
        }

        console.log(`(InternalCtrl) Starting K-Means topic analysis for ${activeClientIds.length} client(s).`);
        let totalTopicsCreated = 0;
        let totalLogsConsidered = 0;
        let totalLogsSuccessfullyClusteredAndProcessed = 0;

        for (const client of activeClientIds) {
            const clientId = client.client_id;
            if (!clientId) continue;

            console.log(`(InternalCtrl) Processing RAG logs for K-Means clustering: Client ${clientId}`);
            const { data: unprocessedLogs, error: logError } = await db.getUnprocessedRagLogsForClient(clientId, BATCH_SIZE_RAG_LOGS);

            if (logError) {
                console.error(`(InternalCtrl) Client ${clientId}: Error fetching unprocessed logs:`, logError);
                continue;
            }
            if (!unprocessedLogs || unprocessedLogs.length === 0) {
                console.log(`(InternalCtrl) Client ${clientId}: No unprocessed RAG logs found.`);
                continue;
            }
            totalLogsConsidered += unprocessedLogs.length;

            const logsWithEmbeddings = unprocessedLogs.filter(log => log.query_embedding && Array.isArray(log.query_embedding) && log.query_embedding.length > 0);

            if (logsWithEmbeddings.length < MIN_LOGS_FOR_CLUSTERING) {
                console.log(`(InternalCtrl) Client ${clientId}: Not enough logs with embeddings (${logsWithEmbeddings.length}) to perform clustering (min: ${MIN_LOGS_FOR_CLUSTERING}).`);
                if (logsWithEmbeddings.length > 0) {
                    const idsToMark = logsWithEmbeddings.map(l => l.log_id);
                    try {
                        await supabase.from('rag_interaction_logs').update({ topic_analysis_processed_at: new Date().toISOString() }).in('log_id', idsToMark);
                        console.log(`(InternalCtrl) Client ${clientId}: Marked ${idsToMark.length} logs (with embeddings but too few to cluster) as processed.`);
                    } catch (markError) {
                        console.error(`(InternalCtrl) Client ${clientId}: Error marking few logs as processed:`, markError.message);
                    }
                }
                continue;
            }

            const embeddingsArray = logsWithEmbeddings.map(log => log.query_embedding);
            let numClusters = Math.max(MIN_CLUSTERS_PER_CLIENT, Math.min(MAX_CLUSTERS_PER_CLIENT, Math.floor(embeddingsArray.length / TARGET_LOGS_PER_CLUSTER)));
            if (numClusters > embeddingsArray.length) numClusters = embeddingsArray.length;
            if (numClusters === 0 && embeddingsArray.length > 0) numClusters = 1; // Ensure at least 1 cluster if there's data
            if (numClusters === 0) {
                 console.log(`(InternalCtrl) Client ${clientId}: numClusters is 0, skipping K-Means.`);
                 continue;
            }


            console.log(`(InternalCtrl) Client ${clientId}: Attempting K-Means with K=${numClusters} for ${embeddingsArray.length} embeddings.`);
            let kmeansResult;
            try {
                kmeansResult = kmeans(embeddingsArray, numClusters, { maxIterations: 100 });
            } catch (clusterError) {
                console.error(`(InternalCtrl) Client ${clientId}: K-Means clustering failed:`, clusterError.message);
                const idsToMark = logsWithEmbeddings.map(l => l.log_id);
                try {
                    await supabase.from('rag_interaction_logs').update({ topic_analysis_processed_at: new Date().toISOString() }).in('log_id', idsToMark);
                    console.log(`(InternalCtrl) Client ${clientId}: Marked ${idsToMark.length} logs as processed after clustering error.`);
                } catch (markError) {
                     console.error(`(InternalCtrl) Client ${clientId}: Error marking logs as processed after clustering error:`, markError.message);
                }
                continue;
            }

            const clusters = {};
            for (let i = 0; i < logsWithEmbeddings.length; i++) {
                const clusterId = kmeansResult.clusters[i];
                if (!clusters[clusterId]) clusters[clusterId] = [];
                clusters[clusterId].push(logsWithEmbeddings[i]);
            }

            console.log(`(InternalCtrl) Client ${clientId}: Formed ${Object.keys(clusters).length} clusters.`);

            for (const clusterId in clusters) {
                const logsInCluster = clusters[clusterId];
                if (logsInCluster.length < MIN_QUERY_GROUP_SIZE_FOR_LLM_LABELING) { // Using the same constant as before, maybe rename it
                    console.log(`(InternalCtrl) Client ${clientId}: Cluster ${clusterId} too small (${logsInCluster.length} logs) for LLM labeling. Skipping.`);
                    // Optionally, still create a topic with a generic name or mark logs. For now, skipping topic creation.
                    // Mark these logs as processed to avoid them being picked up again.
                    const logIdsToMarkSmallCluster = logsInCluster.map(l => l.log_id);
                     try {
                        await supabase.from('rag_interaction_logs').update({ topic_analysis_processed_at: new Date().toISOString() }).in('log_id', logIdsToMarkSmallCluster);
                        console.log(`(InternalCtrl) Client ${clientId}: Marked ${logIdsToMarkSmallCluster.length} logs from small cluster ${clusterId} as processed.`);
                    } catch (markError) {
                        console.error(`(InternalCtrl) Client ${clientId}: Error marking logs from small cluster ${clusterId} as processed:`, markError.message);
                    }
                    continue;
                }

                const originalQueriesFromCluster = new Set(logsInCluster.map(log => log.user_query));
                const logIdsInCluster = new Set(logsInCluster.map(log => log.log_id));
                const conversationIdsInCluster = new Set(logsInCluster.map(log => log.conversation_id).filter(id => id));

                const representativeQueries = Array.from(originalQueriesFromCluster).slice(0, MAX_QUERIES_FOR_LLM_PROMPT);
                let topicName = `Cluster ${clusterId}: ${representativeQueries[0]?.substring(0, 30) || 'Generated Topic'}...`; // Default name

                try {
                    const systemPrompt = `Eres un asistente de IA experto en análisis semántico y categorización. Tu tarea es generar una etiqueta de tema (topic label) concisa y descriptiva para el siguiente grupo de consultas de usuarios.
La etiqueta debe:
1. Estar en Español.
2. Tener entre 2 y 5 palabras.
3. Ser representativa del tema principal común a las consultas.
4. Ser adecuada para mostrar en un dashboard de analíticas.
Responde ÚNICAMENTE con la etiqueta del tema, sin ninguna explicación adicional, numeración o comillas.`;
                    const userPrompt = `Consultas de Usuarios Agrupadas (representan un cluster):\n${representativeQueries.map(q => `- "${q}"`).join('\n')}\n\nEtiqueta del Tema Sugerida:`;

                    const llmLabel = await openaiService.getChatCompletion(
                        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                        'gpt-3.5-turbo', 0.3, 20
                    );
                    if (llmLabel && llmLabel.trim().length > 0) topicName = llmLabel.trim();
                    else console.warn(`(InternalCtrl) Client ${clientId}: LLM did not return a valid label for cluster ${clusterId}.`);
                } catch (llmError) {
                    console.error(`(InternalCtrl) Client ${clientId}: LLM error for cluster ${clusterId}:`, llmError.message);
                }

                const topicEntry = {
                    client_id: clientId,
                    topic_name: topicName,
                    normalized_query_text: `cluster_k${numClusters}_id${clusterId}_${topicName.replace(/\s+/g, '_').substring(0,30)}`, // Store a derived identifier
                    topic_generation_method: 'embedding_kmeans',
                    cluster_id_internal: String(clusterId),
                    representative_queries: Array.from(originalQueriesFromCluster).slice(0, 20),
                    query_count: logIdsInCluster.size,
                    example_interaction_ids: Array.from(logIdsInCluster).slice(0, 5),
                    example_conversation_ids: Array.from(conversationIdsInCluster).slice(0,5),
                };

                const { data: insertedTopicData, error: insertTopicError } = await supabase
                    .from('analyzed_conversation_topics')
                    .insert(topicEntry)
                    .select('topic_id')
                    .single();

                if (insertTopicError) {
                    console.error(`(InternalCtrl) Client ${clientId}: Error inserting topic "${topicName}" for cluster ${clusterId}:`, insertTopicError.message);
                } else {
                    totalTopicsCreated++;
                    const newTopicId = insertedTopicData.topic_id;
                    console.log(`(InternalCtrl) Client ${clientId}: Topic created for cluster ${clusterId} -> Topic ID ${newTopicId}: "${topicName}"`);

                    if (newTopicId && logIdsInCluster.size > 0) {
                        const membershipEntries = Array.from(logIdsInCluster).map(logId => ({
                            topic_id: newTopicId, rag_interaction_log_id: logId, client_id: clientId
                        }));
                        const { error: membershipError } = await supabase.from('topic_membership').insert(membershipEntries);
                        if (membershipError) console.error(`(InternalCtrl) Client ${clientId}: Error inserting memberships for topic ${newTopicId}:`, membershipError.message);
                        else console.log(`(InternalCtrl) Client ${clientId}: Inserted ${membershipEntries.length} memberships for topic ${newTopicId}.`);
                    }

                    const logIdsToUpdateArray = Array.from(logIdsInCluster);
                    const { error: updateLogError } = await supabase
                        .from('rag_interaction_logs')
                        .update({ topic_analysis_processed_at: new Date().toISOString() })
                        .in('log_id', logIdsToUpdateArray);
                    if (updateLogError) console.error(`(InternalCtrl) Client ${clientId}: Error marking ${logIdsToUpdateArray.length} RAG logs as processed for topic ${newTopicId}:`, updateLogError.message);
                    else {
                        console.log(`(InternalCtrl) Client ${clientId}: Marked ${logIdsToUpdateArray.length} RAG logs as processed for topic ${newTopicId}.`);
                        totalLogsSuccessfullyClusteredAndProcessed += logIdsToUpdateArray.length;
                    }
                }
            }
        // Removed one extra closing brace here that was prematurely ending the 'for (const client of activeClientIds)' loop
        } // This brace now correctly closes the 'for (const client of activeClientIds)' loop.

        // This response is now correctly positioned after iterating through all clients.
        res.status(200).json({
            message: `K-Means topic analysis completed. Clients processed: ${activeClientIds.length}. Logs considered: ${totalLogsConsidered}. Topics created: ${totalTopicsCreated}. Logs in created topics: ${totalLogsSuccessfullyClusteredAndProcessed}.`
        });

    } catch (error) {
        console.error('(InternalCtrl) Error in triggerProcessQueryClusters (K-Means):', error);
        res.status(500).json({ error: 'Failed to process query clusters with K-Means.', details: error.message });
    }
};

export const triggerRagFeedbackAnalysis = async (req, res) => {
    console.log('(InternalCtrl) Received request to trigger RAG feedback analysis.');
    const { client_id: clientId, period_days: periodDaysQuery } = req.body; // Or req.query

    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

    if (clientId && !UUID_REGEX.test(clientId)) {
        return res.status(400).json({ error: 'Invalid client_id format. Must be a UUID.' });
    }

    let periodDays = 30; // Default
    if (periodDaysQuery) {
        const parsedPeriodDays = parseInt(periodDaysQuery, 10);
        if (isNaN(parsedPeriodDays) || parsedPeriodDays <= 0) {
            return res.status(400).json({ error: 'Invalid period_days. Must be a positive integer.' });
        }
        periodDays = parsedPeriodDays;
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - periodDays);
    const periodOptions = {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
    };

    try {
        // This function will be created in databaseService.js
        const feedbackDetails = await db.fetchFeedbackWithInteractionDetails(clientId, periodOptions);

        if (feedbackDetails.error) {
            console.error("(InternalCtrl) Error fetching feedback details:", feedbackDetails.error);
            return res.status(500).json({ message: "Failed to fetch feedback details for analysis.", error: feedbackDetails.error });
        }

        const numRecords = feedbackDetails.data ? feedbackDetails.data.length : 0;
        console.log(`(InternalCtrl) Fetched ${numRecords} feedback entries with interaction details for client: ${clientId || 'all (if implemented)'} and period: ${periodDays} days.`);

        // Placeholder for actual analysis logic:
        if (numRecords > 0) {
            console.log("(InternalCtrl) Placeholder: Actual analysis of feedback details would occur here (e.g., chunk performance, strategy correlation).");
            // Example: console.log("Sample fetched record:", JSON.stringify(feedbackDetails.data[0], null, 2));
        }

        res.status(200).json({
            message: `RAG feedback analysis process initiated. Fetched ${numRecords} records. Placeholder analysis logic executed.`,
            clientId: clientId,
            period: periodOptions
        });

    } catch (error) {
        console.error('(InternalCtrl) Error in triggerRagFeedbackAnalysis:', error);
        res.status(500).json({ error: 'Failed to initiate RAG feedback analysis process.', details: error.message });
    }
};
