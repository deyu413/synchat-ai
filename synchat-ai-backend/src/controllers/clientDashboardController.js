// synchat-ai-backend/src/controllers/clientDashboardController.js
import { supabase } from '../services/supabaseClient.js';
import { ingestWebsite } from '../services/ingestionService.js';
import * as db from '../services/databaseService.js';
import * as openaiService from '../services/openaiService.js'; // For LLM filtering/summarization
import { encode } from 'gpt-tokenizer'; // For token counting if needed for summarization logic

// --- Existing Controller Functions ---

export const getClientConfig = async (req, res) => {
    console.log('clientDashboardController.getClientConfig called');
    const clientId = req.user?.id;
    if (!clientId) {
        return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' });
    }
    try {
        const { data, error } = await supabase
            .from('synchat_clients')
            .select('client_name, email, widget_config, knowledge_source_url, last_ingest_status, last_ingest_at')
            .eq('client_id', clientId)
            .single();
        if (error) {
            console.error('Error fetching client config:', error.message);
            return res.status(500).json({ message: 'Error fetching client configuration.', error: error.message });
        }
        if (!data) {
            return res.status(404).json({ message: 'Client configuration not found.' });
        }
        res.status(200).json(data);
    } catch (err) {
        console.error('Unexpected error in getClientConfig:', err.message);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

export const getKnowledgeSuggestions = async (req, res) => {
    const clientId = req.user?.id;
    if (!clientId) { return res.status(401).json({ message: 'Unauthorized: Client ID not found.' }); }
    const { status = 'new', type, limit = 20, offset = 0 } = req.query;
    const options = { status, type, limit: parseInt(limit, 10), offset: parseInt(offset, 10) };
    console.log(`(ClientDashboardCtrl) Fetching knowledge suggestions for client ${clientId}, options:`, options);
    try {
        const suggestions = await db.fetchKnowledgeSuggestions(clientId, options);
        res.status(200).json(suggestions);
    } catch (error) {
        console.error(`(ClientDashboardCtrl) Error fetching knowledge suggestions for client ${clientId}:`, error);
        res.status(500).json({ message: 'Failed to retrieve knowledge suggestions.', error: error.message });
    }
};

export const updateKnowledgeSuggestionStatus = async (req, res) => {
    const clientId = req.user?.id;
    const { suggestion_id } = req.params;
    const { status: newStatus } = req.body;
    if (!clientId) { return res.status(401).json({ message: 'Unauthorized: Client ID not found.' }); }
    if (!suggestion_id) { return res.status(400).json({ message: 'Suggestion ID is required in URL parameters.' }); }
    if (!newStatus) { return res.status(400).json({ message: 'New status is required in request body.' }); }
    const validStatuses = ['new', 'reviewed_pending_action', 'action_taken', 'dismissed'];
    if (!validStatuses.includes(newStatus)) { return res.status(400).json({ message: `Invalid status value: ${newStatus}. Must be one of: ${validStatuses.join(', ')}` }); }
    console.log(`(ClientDashboardCtrl) Updating suggestion ${suggestion_id} for client ${clientId} to status ${newStatus}`);
    try {
        const updatedSuggestion = await db.updateClientKnowledgeSuggestionStatus(clientId, suggestion_id, newStatus);
        if (!updatedSuggestion) { return res.status(404).json({ message: 'Suggestion not found for this client or update failed.' }); }
        res.status(200).json(updatedSuggestion);
    } catch (error) {
        console.error(`(ClientDashboardCtrl) Error updating suggestion ${suggestion_id} status for client ${clientId}:`, error);
        if (error.message.includes("Invalid status value")) { return res.status(400).json({ message: error.message }); }
        res.status(500).json({ message: 'Failed to update knowledge suggestion status.', error: error.message });
    }
};

export const testKnowledgeQuery = async (req, res) => {
    const clientId = req.user?.id;
    const { queryText } = req.body;
    if (!clientId) { return res.status(401).json({ message: 'Unauthorized: Client ID not found.' }); }
    if (!queryText || typeof queryText !== 'string' || queryText.trim() === '') { return res.status(400).json({ message: 'queryText is required in the request body and must be a non-empty string.' }); }
    console.log(`(ClientDashboardCtrl) Testing knowledge query for client ${clientId}: "${queryText.substring(0, 100)}..."`);
    try {
        const searchResult = await db.hybridSearch(clientId, queryText, null, {});
        const testResult = {
            originalQuery: queryText,
            processedQueries: searchResult.queriesEmbeddedForLog,
            searchParamsUsed: searchResult.searchParams,
            retrievedChunks: searchResult.results.map(chunk => ({
                id: chunk.id, content: chunk.content, metadata: chunk.metadata,
                similarity: chunk.vector_similarity, fts_score: chunk.fts_score,
                hybrid_score: chunk.hybrid_score, reranked_score: chunk.reranked_score
            }))
        };
        res.status(200).json(testResult);
    } catch (error) {
        console.error(`(ClientDashboardCtrl) Error testing knowledge query for client ${clientId}:`, error);
        res.status(500).json({ message: 'Failed to test knowledge query.', error: error.message });
    }
};

export const getChatbotAnalyticsSummary = async (req, res) => {
    const clientId = req.user?.id;
    if (!clientId) { return res.status(401).json({ message: 'Unauthorized: Client ID not found.' }); }
    const { period = '30d', startDate, endDate } = req.query;
    const periodOptions = { period, startDate, endDate };
    console.log(`(ClientDashboardCtrl) Fetching analytics summary for client ${clientId}, options:`, periodOptions);
    try {
        const summaryData = await db.fetchAnalyticsSummary(clientId, periodOptions);
        if (!summaryData) { return res.status(404).json({ message: 'Analytics summary data not found.' }); }
        res.status(200).json(summaryData);
    } catch (error) {
        console.error(`(ClientDashboardCtrl) Error fetching analytics summary for client ${clientId}:`, error);
        res.status(500).json({ message: 'Failed to retrieve analytics summary.', error: error.message });
    }
};

export const getUnansweredQuerySuggestions = async (req, res) => {
    const clientId = req.user?.id;
    if (!clientId) { return res.status(401).json({ message: 'Unauthorized: Client ID not found.' }); }
    const { period = '30d', startDate, endDate, limit: limitQuery } = req.query;
    const periodOptions = { period, startDate, endDate };
    const limit = parseInt(limitQuery, 10) || 10;
    console.log(`(ClientDashboardCtrl) Fetching unanswered queries for client ${clientId}, options:`, periodOptions, `limit: ${limit}`);
    try {
        const suggestions = await db.fetchUnansweredQueries(clientId, periodOptions, limit);
        res.status(200).json(suggestions);
    } catch (error) {
        console.error(`(ClientDashboardCtrl) Error fetching unanswered query suggestions for client ${clientId}:`, error);
        res.status(500).json({ message: 'Failed to retrieve unanswered query suggestions.', error: error.message });
    }
};

export const updateClientConfig = async (req, res) => {
    console.log('clientDashboardController.updateClientConfig called');
    const clientId = req.user?.id;
    if (!clientId) { return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' }); }
    const { widget_config: newWidgetConfigData, knowledge_source_url } = req.body;
    if (newWidgetConfigData === undefined && knowledge_source_url === undefined) { return res.status(400).json({ message: 'No valid fields provided for update. Provide widget_config or knowledge_source_url.' }); }
    const updateFields = {};
    try {
        if (newWidgetConfigData !== undefined) {
            if (typeof newWidgetConfigData !== 'object' || newWidgetConfigData === null) { return res.status(400).json({ message: 'Invalid widget_config format. It must be an object.' }); }
            let currentWidgetConfig = {};
            const { data: clientRecord, error: fetchError } = await supabase.from('synchat_clients').select('widget_config').eq('client_id', clientId).single();
            if (fetchError && fetchError.code !== 'PGRST116') { console.error('Error fetching current widget_config:', fetchError.message); return res.status(500).json({ message: 'Error fetching current configuration for update.', error: fetchError.message }); }
            currentWidgetConfig = clientRecord?.widget_config || {};
            updateFields.widget_config = { ...currentWidgetConfig, ...newWidgetConfigData };
        }
        if (knowledge_source_url !== undefined) {
            try { if (knowledge_source_url !== '') { new URL(knowledge_source_url); } }
            catch (urlError) { return res.status(400).json({ message: 'Invalid knowledge_source_url format.' }); }
            updateFields.knowledge_source_url = knowledge_source_url;
        }
        if (Object.keys(updateFields).length === 0) { return res.status(200).json({ message: 'No new data provided to update.' });}
        const { data, error } = await supabase.from('synchat_clients').update(updateFields).eq('client_id', clientId).select('client_id, widget_config, knowledge_source_url, updated_at').single();
        if (error) { console.error('Error updating client config:', error.message); return res.status(500).json({ message: 'Error updating client configuration.', error: error.message });}
        if (!data) { return res.status(404).json({ message: 'Client not found or update failed to return data.' }); }
        res.status(200).json({ message: 'Client configuration updated successfully.', data });
    } catch (err) {
        console.error('Unexpected error in updateClientConfig:', err.message, err.stack);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

export const requestKnowledgeIngest = async (req, res) => {
    console.log('clientDashboardController.requestKnowledgeIngest called');
    const clientId = req.user?.id;
    if (!clientId) { return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' }); }
    try {
        const { data: clientData, error: fetchError } = await supabase.from('synchat_clients').select('knowledge_source_url').eq('client_id', clientId).single();
        if (fetchError) { console.error('Error fetching client data for ingest:', fetchError.message); return res.status(500).json({ message: 'Error fetching client data.', error: fetchError.message });}
        if (!clientData || !clientData.knowledge_source_url) { return res.status(400).json({ message: 'No knowledge source URL configured for this client. Please set it up in your configuration.' });}
        const knowledge_source_url = clientData.knowledge_source_url;
        ingestWebsite(clientId, knowledge_source_url)
            .then(result => { if (result.success) { console.log(`Ingestion completed successfully for client ${clientId}. Details:`, result.data); } else { console.error(`Ingestion failed for client ${clientId}. Error:`, result.error);}})
            .catch(error => { console.error(`Critical error during background ingestion for client ${clientId}:`, error); });
        const { error: updateError } = await supabase.from('synchat_clients').update({ last_ingest_status: 'pending', last_ingest_at: new Date().toISOString() }).eq('client_id', clientId);
        if (updateError) { console.error('Error updating client ingest status:', updateError.message); }
        console.log(`Ingestion process initiated for client ${clientId} with URL ${knowledge_source_url}`);
        res.status(202).json({ message: 'Knowledge ingestion request received and is being processed. Status set to pending.' });
    } catch (err) {
        console.error('Unexpected error in requestKnowledgeIngest:', err.message, err.stack);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

export const getClientUsageResolutions = async (req, res) => {
    console.log('clientDashboardController.getClientUsageResolutions called');
    const clientId = req.user?.id;
    if (!clientId) { return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' }); }
    let { billing_cycle_id } = req.query;
    if (!billing_cycle_id) { const now = new Date(); const year = now.getFullYear(); const month = (now.getMonth() + 1).toString().padStart(2, '0'); billing_cycle_id = `${year}-${month}`; console.log(`No billing_cycle_id provided, defaulting to current month: ${billing_cycle_id}`); }
    try {
        let query = supabase.from('ia_resolutions_log').select('*', { count: 'exact', head: true }).eq('client_id', clientId).eq('billing_cycle_id', billing_cycle_id);
        const { count, error } = await query;
        if (error) { console.error('Error fetching client usage resolutions:', error.message); return res.status(500).json({ message: 'Error fetching client usage data.', error: error.message }); }
        const resolutionCount = count === null ? 0 : count;
        res.status(200).json({ client_id: clientId, billing_cycle_id: billing_cycle_id, ai_resolutions_current_month: resolutionCount, total_queries_current_month: 'N/A' });
    } catch (err) {
        console.error('Unexpected error in getClientUsageResolutions:', err.message, err.stack);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

// --- RAG Playground Controller Function ---
const LLM_FILTER_TOP_N_CHUNKS_PLAYGROUND = 5;
const LLM_FILTER_MODEL_PLAYGROUND = "gpt-3.5-turbo";
const LLM_FILTER_TEMP_RELEVANCE_PLAYGROUND = 0.2;
const LLM_FILTER_TEMP_SUMMARY_PLAYGROUND = 0.3;
const ENABLE_LLM_CONTEXT_FILTERING_PLAYGROUND = true;
const ENABLE_LLM_CONTEXT_SUMMARIZATION_PLAYGROUND = true;

export const runRagPlaygroundQuery = async (req, res, next) => {
    const clientId = req.user?.id;
    const { queryText } = req.body;

    if (!queryText || typeof queryText !== 'string' || queryText.trim() === '') {
        return res.status(400).json({ error: 'queryText is required and must be a non-empty string.' });
    }

    console.log(`(ClientDashboardCtrl) RAG Playground query for client ${clientId}: "${queryText.substring(0, 100)}..."`);

    try {
        const hybridSearchOutput = await db.hybridSearch(
            clientId,
            queryText,
            null, /* conversationId */
            {},   /* options */
            true  /* returnPipelineDetails */
        );

        let playgroundData = { ...hybridSearchOutput.pipelineDetails };
        playgroundData.searchParams = hybridSearchOutput.searchParams;
        playgroundData.queriesUsedForEmbeddingLog = hybridSearchOutput.queriesEmbeddedForLog;

        // The initial set of chunks before LLM processing comes from hybridSearch's pipelineDetails
        let chunksToProcessForLLM = playgroundData.finalRankedResultsForPlayground || [];

        playgroundData.llmContextualization = {
            llmFilteringActions: [],
            llmSummarizationActions: [],
            processedKnowledgeForContextAssembly: [],
            finalLLMContextString: ""
        };

        let filteredChunksForPlayground = [];
        if (ENABLE_LLM_CONTEXT_FILTERING_PLAYGROUND && chunksToProcessForLLM.length > 0) {
            console.log(`(Playground) Starting LLM filtering for ${chunksToProcessForLLM.length} chunks.`);
            for (const chunk of chunksToProcessForLLM) {
                let decision = 'ERROR';
                try {
                    const relevancePrompt = `User Question: '${queryText}'. Is the following 'Text Snippet' directly relevant and useful for answering the user's question? Respond with only 'YES' or 'NO'. Text Snippet: '${chunk.contentSnippet || chunk.content}'`;
                    const relevanceMessages = [ { role: "system", content: "You are an AI assistant that judges relevance. Respond with only YES or NO." }, { role: "user", content: relevancePrompt }];
                    const relevanceResponse = await openaiService.getChatCompletion(relevanceMessages, LLM_FILTER_MODEL_PLAYGROUND, LLM_FILTER_TEMP_RELEVANCE_PLAYGROUND, 10);
                    decision = relevanceResponse && relevanceResponse.trim().toLowerCase().startsWith('yes') ? 'YES' : 'NO';
                    if (decision === 'YES') filteredChunksForPlayground.push(chunk);
                } catch (filterError) {
                    console.error(`(Playground) LLM relevance check error for chunk ID ${chunk.id}: ${filterError.message}. Keeping chunk.`);
                    filteredChunksForPlayground.push(chunk); // Keep if error
                    decision = 'ERROR_FALLBACK_KEPT';
                }
                playgroundData.llmContextualization.llmFilteringActions.push({ chunkId: chunk.id, originalContentPreview: chunk.contentSnippet || chunk.content?.substring(0,150)+'...', decision });
            }
            if (filteredChunksForPlayground.length === 0 && chunksToProcessForLLM.length > 0) {
                filteredChunksForPlayground = [...chunksToProcessForLLM]; // Fallback
                 playgroundData.llmContextualization.llmFilteringActions.push({ action: "Fallback", detail: "All chunks filtered, reverted to original top N." });
            }
        } else {
            filteredChunksForPlayground = [...chunksToProcessForLLM];
        }

        let summarizedChunksForPlayground = [];
        if (ENABLE_LLM_CONTEXT_SUMMARIZATION_PLAYGROUND && filteredChunksForPlayground.length > 0) {
            console.log(`(Playground) Starting LLM summarization for ${filteredChunksForPlayground.length} chunks.`);
            for (const chunk of filteredChunksForPlayground) {
                let summary = null;
                let actionTaken = 'Kept Original (or error)';
                try {
                    const summaryPrompt = `User Question: '${queryText}'. From the 'Text Snippet' below, extract only the sentence(s) or key phrases that directly help answer the question. If no part is relevant, or if the snippet is already very concise and relevant, return the original snippet. If absolutely no part is relevant, return an empty string. Text Snippet: '${chunk.content}'`; // Use full content for summary
                    const summaryMessages = [ { role: "system", content: "You are an AI assistant that extracts key relevant sentences from text." }, { role: "user", content: summaryPrompt }];
                    const summaryMaxTokens = Math.min(encode(chunk.content || "").length + 50, 300);
                    summary = await openaiService.getChatCompletion(summaryMessages, LLM_FILTER_MODEL_PLAYGROUND, LLM_FILTER_TEMP_SUMMARY_PLAYGROUND, summaryMaxTokens);
                    if (summary && summary.trim().length > 0) {
                        summarizedChunksForPlayground.push({ ...chunk, extracted_content: summary.trim() });
                        actionTaken = 'Summarized';
                    } else {
                        summarizedChunksForPlayground.push(chunk); // Use original if summary is empty
                        actionTaken = summary === "" ? 'Kept Original (empty summary)' : 'Kept Original (LLM error or no summary)';
                    }
                } catch (summaryError) {
                    console.error(`(Playground) LLM summarization error for chunk ID ${chunk.id}: ${summaryError.message}. Using original.`);
                    summarizedChunksForPlayground.push(chunk);
                    actionTaken = 'Kept Original (exception)';
                }
                playgroundData.llmContextualization.llmSummarizationActions.push({ chunkId: chunk.id, originalContentPreview: chunk.contentSnippet || chunk.content?.substring(0,150)+'...', summarizedContentPreview: summary || 'N/A', actionTaken });
            }
        } else {
            summarizedChunksForPlayground = [...filteredChunksForPlayground];
        }
        playgroundData.llmContextualization.processedKnowledgeForContextAssembly = summarizedChunksForPlayground;

        // Assemble finalContextForLLM (mimicking chatController)
        let finalContextString = "";
        if (playgroundData.finalPropositionResults && playgroundData.finalPropositionResults.length > 0) {
            const propositionLines = playgroundData.finalPropositionResults.map(p =>
                `Afirmación Relevante: ${p.text}\n(Contexto de Afirmación ID: ${p.sourceChunkId}, Score: ${p.score?.toFixed(4)})`
            );
            finalContextString += "--- Afirmaciones Clave Encontradas ---\n" + propositionLines.join("\n---\n") + "\n\n";
        }
        if (summarizedChunksForPlayground.length > 0) {
            const chunkLines = summarizedChunksForPlayground.map(chunk => {
                const sourceInfo = chunk.metadata?.hierarchy?.join(" > ") || chunk.metadata?.url || chunk.metadata?.source_name || 'Documento Relevante';
                const prefix = `Fuente: ${sourceInfo} (Chunk ID: ${chunk.id})\n`;
                const contentToDisplay = chunk.extracted_content || chunk.content;
                return `${prefix}Contenido: ${contentToDisplay}`;
            });
            finalContextString += "--- Fragmentos de Documentos Relevantes (potencialmente resumidos) ---\n" + chunkLines.join("\n\n---\n\n");
        }
        if (!finalContextString) {
            finalContextString = "(No se encontró contexto relevante o procesado para esta pregunta)";
        }
        playgroundData.llmContextualization.finalLLMContextString = finalContextString;

        // Add top-level results from hybridSearch to playgroundData for clarity
        playgroundData.hybridSearchResults = hybridSearchOutput.results;
        playgroundData.hybridSearchPropositionResults = hybridSearchOutput.propositionResults;

        // BEGIN RAG Interaction Logging for Playground
        const retrievedContextForLog = hybridSearchOutput.results?.map(c => ({
            id: c.id,
            content_preview: c.content?.substring(0,150)+"...",
            score: c.reranked_score || c.hybrid_score, // Use best available score
            metadata: c.metadata
        })) || [];

        const ragInteractionLogData = {
            client_id: clientId,
            user_query: queryText,
            retrieved_context: retrievedContextForLog,
            llm_response: "Playground Interaction - RAG components displayed.", // Or null
            query_embeddings_used: hybridSearchOutput.queriesEmbeddedForLog,
            vector_search_params: hybridSearchOutput.searchParams,
            was_escalated: false,
            predicted_query_category: hybridSearchOutput.predictedCategory || null, // Using direct output
            // conversation_id can be null for playground interactions if not tied to one
        };

        try {
            const ragLogResult = await db.logRagInteraction(ragInteractionLogData);
            if (ragLogResult && ragLogResult.rag_interaction_log_id) {
                playgroundData.rag_interaction_log_id = ragLogResult.rag_interaction_log_id;
                console.log(`(ClientDashboardCtrl) Playground RAG interaction logged with ID: ${ragLogResult.rag_interaction_log_id}`);
            } else {
                console.error("(ClientDashboardCtrl) Failed to get rag_interaction_log_id from db.logRagInteraction for playground.");
            }
        } catch (logError) {
            console.error("(ClientDashboardCtrl) Error logging RAG interaction for playground:", logError.message);
            // Decide if you want to still send response or error out. For now, continue and log.
        }
        // END RAG Interaction Logging for Playground

        res.status(200).json(playgroundData);

    } catch (error) {
        console.error(`(ClientDashboardCtrl) Error in RAG Playground query for client ${clientId}:`, error);
        next(error); // Pass to global error handler
    }
};

export const handlePlaygroundRagFeedback = async (req, res) => {
    const user_id = req.user?.id; // User providing the feedback
    const client_id = req.user?.id; // Client context for the feedback, assuming user is the client

    if (!user_id) { // This also covers client_id based on the assumption
        console.error('(ClientDashboardCtrl) Critical: User ID (and thus Client ID) not found for authenticated user in handlePlaygroundRagFeedback.');
        return res.status(401).json({ error: 'Unauthorized. User information not found.' });
    }

    const {
        rating,
        comment,
        feedback_type,
        rag_interaction_log_id,
        knowledge_base_chunk_id,
        // knowledge_proposition_id is intentionally omitted as it's commented out in DB
        feedback_context
    } = req.body;

    // Validate required fields
    if (typeof rating !== 'number') {
        return res.status(400).json({ error: 'Rating (number) is required.' });
    }
    if (typeof feedback_type !== 'string' || feedback_type.trim() === '') {
        return res.status(400).json({ error: 'feedback_type (string) is required.' });
    }

    // Specific validation based on feedback_type
    if (feedback_type === 'chunk_relevance' && !knowledge_base_chunk_id) {
        return res.status(400).json({ error: 'knowledge_base_chunk_id is required when feedback_type is "chunk_relevance".' });
    }
    // Add more specific validations if other feedback_types require certain IDs
    // e.g., if 'proposition_relevance' were active:
    // if (feedback_type === 'proposition_relevance' && !knowledge_proposition_id) {
    //     return res.status(400).json({ error: 'knowledge_proposition_id is required for "proposition_relevance".' });
    // }


    const feedbackData = {
        client_id,
        user_id,
        rag_interaction_log_id,
        knowledge_base_chunk_id,
        // knowledge_proposition_id: undefined, // Explicitly ensure it's not included
        feedback_type,
        rating,
        comment,
        feedback_context
        // conversation_id and message_id are null/undefined here as this is playground feedback
    };

    // Remove undefined properties to ensure they are not sent to the database service,
    // which also has logic to strip them. This is just being thorough.
    Object.keys(feedbackData).forEach(key => {
        if (feedbackData[key] === undefined) {
            delete feedbackData[key];
        }
    });

    try {
        console.log(`(ClientDashboardCtrl) Submitting RAG Playground feedback by user ${user_id} (Client: ${client_id}), type: ${feedback_type}`);
        // logRagFeedback is imported via `import * as db from ...` so it's `db.logRagFeedback`
        const result = await db.logRagFeedback(feedbackData);

        if (result.error) {
            console.error('(ClientDashboardCtrl) Error in handlePlaygroundRagFeedback calling db.logRagFeedback:', result.error);
            if (result.error.includes('Invalid input')) {
                return res.status(400).json({ error: result.error });
            }
            return res.status(500).json({ error: "Failed to submit RAG feedback due to a server error." });
        }

        res.status(201).json({ message: 'RAG Playground Feedback submitted successfully', data: result.data });
    } catch (error) {
        console.error('(ClientDashboardCtrl) Exception in handlePlaygroundRagFeedback:', error);
        res.status(500).json({ error: 'Failed to submit RAG feedback due to an unexpected server error.' });
    }
};

// --- New Analytics Controller Functions ---

export const getSentimentDistributionAnalytics = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const clientId = req.user?.id;

        if (!clientId) {
            // This should ideally be caught by authMiddleware if user is not found,
            // but as a safeguard for client_id derivation:
            console.error('(ClientDashboardCtrl) Client ID not found in req.user for getSentimentDistributionAnalytics.');
            return res.status(401).json({ error: 'Unauthorized or Client ID not determinable.' });
        }
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'startDate and endDate query parameters are required.' });
        }

        // Basic date validation (can be more sophisticated)
        if (isNaN(new Date(startDate).getTime()) || isNaN(new Date(endDate).getTime())) {
            return res.status(400).json({ error: 'Invalid date format for startDate or endDate.' });
        }

        const result = await db.getSentimentDistribution(clientId, { startDate, endDate });

        if (result.error) {
            // db.getSentimentDistribution already logs detailed error
            return res.status(500).json({ error: result.error });
        }
        res.status(200).json(result.data);
    } catch (error) {
        console.error('(ClientDashboardCtrl) Exception in getSentimentDistributionAnalytics:', error);
        res.status(500).json({ error: 'Failed to fetch sentiment distribution analytics.' });
    }
};

export const getTopicAnalyticsData = async (req, res) => {
    try {
        const { startDate, endDate } = req.query; // Period options can be expanded later
        const clientId = req.user?.id;

        if (!clientId) {
            console.error('(ClientDashboardCtrl) Client ID not found in req.user for getTopicAnalyticsData.');
            return res.status(401).json({ error: 'Unauthorized or Client ID not determinable.' });
        }
        if (!startDate || !endDate) { // Basic validation, can be expanded
            return res.status(400).json({ error: 'startDate and endDate query parameters are required for topic analytics.' });
        }
        if (isNaN(new Date(startDate).getTime()) || isNaN(new Date(endDate).getTime())) {
            return res.status(400).json({ error: 'Invalid date format for startDate or endDate.' });
        }

        const result = await db.getTopicAnalytics(clientId, { startDate, endDate });

        // Since it's a placeholder, it might return a specific structure including a message
        if (result.error) {
            return res.status(500).json({ error: result.error });
        }
        res.status(200).json(result); // Send the whole result including data and message
    } catch (error) {
        console.error('(ClientDashboardCtrl) Exception in getTopicAnalyticsData:', error);
        res.status(500).json({ error: 'Failed to fetch topic analytics data.' });
    }
};

export const getKnowledgeSourcePerformanceAnalytics = async (req, res) => {
    try {
        const { startDate, endDate } = req.query; // Period options
        const clientId = req.user?.id;

        if (!clientId) {
            console.error('(ClientDashboardCtrl) Client ID not found in req.user for getKnowledgeSourcePerformanceAnalytics.');
            return res.status(401).json({ error: 'Unauthorized or Client ID not determinable.' });
        }
        if (!startDate || !endDate) { // Basic validation
            return res.status(400).json({ error: 'startDate and endDate query parameters are required for source performance analytics.' });
        }
         if (isNaN(new Date(startDate).getTime()) || isNaN(new Date(endDate).getTime())) {
            return res.status(400).json({ error: 'Invalid date format for startDate or endDate.' });
        }

        const result = await db.getKnowledgeSourcePerformance(clientId, { startDate, endDate });

        if (result.error) {
            return res.status(500).json({ error: result.error });
        }
        res.status(200).json(result); // Send the whole result including data and message
    } catch (error) {
        console.error('(ClientDashboardCtrl) Exception in getKnowledgeSourcePerformanceAnalytics:', error);
        res.status(500).json({ error: 'Failed to fetch knowledge source performance analytics.' });
    }
};
