// src/controllers/chatController.js
import { getChatCompletion } from '../services/openaiService.js';
import * as db from '../services/databaseService.js';
import { encode } from 'gpt-tokenizer';
import { supabase } from '../services/supabaseClient.js';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Modelo de IA a usar y Temperatura
const CHAT_MODEL = "gpt-3.5-turbo";
const MAX_CONTEXT_TOKENS_FOR_LLM = 3000;
const CHAT_TEMPERATURE = 0.3;

// LLM-based Context Filtering & Summarization Config
const LLM_FILTER_TOP_N_CHUNKS = 5;
const LLM_FILTER_MODEL = "gpt-3.5-turbo";
const LLM_FILTER_TEMP_RELEVANCE = 0.2;
const LLM_FILTER_TEMP_SUMMARY = 0.3;
const ENABLE_LLM_CONTEXT_FILTERING = true;
const ENABLE_LLM_CONTEXT_SUMMARIZATION = true;

// Ambiguity Detection Config
const ENABLE_AMBIGUITY_DETECTION = process.env.ENABLE_AMBIGUITY_DETECTION === 'true' || true;
const AMBIGUITY_LLM_MODEL = "gpt-3.5-turbo";
const AMBIGUITY_LLM_TEMP = 0.1;
const AMBIGUITY_LLM_MAX_TOKENS_OUTPUT = 250;
const AMBIGUITY_DETECTION_TOP_N_CHUNKS = 3;

const BOT_CANNOT_ANSWER_MSG = "Lo siento, no tengo información específica sobre eso en la base de datos de SynChat AI.";
const BOT_ESCALATION_NOTIFICATION_MSG = "Un momento, por favor. Voy a transferirte con un agente humano para que pueda ayudarte con tu consulta.";

export const handleChatMessage = async (req, res, next) => {
    const { message, conversationId, clientId, clarification_response_details } = req.body;
    let userMessageInput = message; // The actual text sent by the user in this turn

    if (!userMessageInput || !conversationId || !clientId) {
        console.warn('Petición inválida a /message:', req.body);
        return res.status(400).json({ error: 'Faltan datos requeridos (message, conversationId, clientId).' });
    }

    // Validate conversationId format
    if (!UUID_REGEX.test(conversationId)) {
        return res.status(400).json({ error: 'conversationId has an invalid format.' });
    }

    // Validate clientId format
    if (!UUID_REGEX.test(clientId)) {
        return res.status(400).json({ error: 'clientId has an invalid format.' });
    }

    let effectiveQuery = userMessageInput;
    let originalQueryForContext = userMessageInput; // Used for some prompts, might be overridden by clarification
    let ragLogId = null; // <<<< Initialize ragLogId here

    if (clarification_response_details && clarification_response_details.original_query) {
        console.log(`(Controller) Received a clarification response for original query: "${clarification_response_details.original_query}" with user's choice/input: "${userMessageInput}"`);
        // Refine the query: combine original ambiguous query with user's clarification.
        effectiveQuery = `${clarification_response_details.original_query} - ${userMessageInput}`;
        originalQueryForContext = clarification_response_details.original_query; // Keep for prompts that need the "original" intent
        console.log(`(Controller) Using refined query for RAG: "${effectiveQuery}"`);
        // `clarification_response_details.original_chunks` are available if needed, but current strategy is to re-search.
    }


    if (req.body.intent && req.body.intent === 'request_human_escalation') {
        console.log(`(Controller) User initiated escalation for CV:${conversationId}, C:${clientId}`);
        try {
            await db.saveMessage(conversationId, 'user', 'El usuario ha solicitado hablar con un agente humano.');
            db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => console.error(`Analytics: Failed to increment user message count for CV:${conversationId}`, err));
            await db.updateConversationStatusByAgent(conversationId, clientId, null, 'escalated_to_human');
            db.updateAnalyticOnEscalation(conversationId, new Date(), `User explicitly requested human escalation. Associated message: "${userMessageInput}"`) // Use userMessageInput here
                .catch(err => console.error(`Analytics: Failed to update escalation data for CV:${conversationId}`, err));
            return res.status(200).json({ status: "escalation_requested", reply: "Tu solicitud para hablar con un agente ha sido recibida. Alguien se pondrá en contacto contigo pronto." });
        } catch (escalationError) {
            console.error(`(Controller) Error during user-initiated escalation for CV:${conversationId}:`, escalationError);
            return res.status(500).json({ error: "No se pudo procesar tu solicitud de escalación en este momento." });
        }
    }

    console.log(`(Controller) Mensaje (effectiveQuery) recibido C:${clientId}, CV:${conversationId}: "${effectiveQuery.substring(0, 100)}..."`);

    try {
        const cacheKey = `${clientId}:${conversationId}:${effectiveQuery}`; // Cache based on effective query
        const cachedReply = db.getCache(cacheKey);
        if (cachedReply) {
            // Save user's actual typed message, not the effectiveQuery if it was combined
            db.saveMessage(conversationId, 'user', userMessageInput).then(() => db.incrementAnalyticMessageCount(conversationId, 'user')).catch(err => console.error("Analytics save user msg err (cache):", err));
            db.saveMessage(conversationId, 'bot', cachedReply).then(() => db.incrementAnalyticMessageCount(conversationId, 'bot')).catch(err => console.error("Analytics save bot msg err (cache):", err));
            return res.status(200).json({ reply: cachedReply });
        }
        console.log("(Controller) No encontrado en caché. Procesando...");

        const conversationHistory = await db.getConversationHistory(conversationId);
        // Use effectiveQuery for the search
        const {
            results: hybridSearchResultsOnly, // Renamed to avoid conflict with a var name `results` if any
            propositionResults,
            searchParams: searchParamsUsed,
            queriesEmbeddedForLog: queriesThatWereEmbedded,
            predictedCategory, // Capture predictedCategory
            rawRankedResultsForLog // Ensure this is also captured if it was part of hybridSearchResult
        } = await db.hybridSearch(clientId, effectiveQuery, conversationId, {});

        let initialRelevantKnowledge = hybridSearchResultsOnly; // Use the renamed variable

        // --- Ambiguity Detection ---
        let isAmbiguous = false;
        let clarificationQuestion = null;
        let clarificationOptions = [];
        // Use effectiveQuery for ambiguity detection input userQueryString
        const userQueryStringForAmbiguity = effectiveQuery;

        if (ENABLE_AMBIGUITY_DETECTION && initialRelevantKnowledge && initialRelevantKnowledge.length > 0 && (!clarification_response_details) /* Only run ambiguity if not already a clarification response */) {
            try {
                const contextSnippets = initialRelevantKnowledge.slice(0, AMBIGUITY_DETECTION_TOP_N_CHUNKS).map((chunk, index) => {
                    return `Snippet ${index + 1} (ID: ${chunk.id}): "${chunk.content.substring(0, 200)}..."`;
                });

                if (contextSnippets.length > 0) {
                    const ambiguitySystemPrompt = `Eres un asistente de IA altamente especializado... (prompt as defined before)`; // Full prompt
                    const ambiguityUserPrompt = `User Query: "${userQueryStringForAmbiguity}"\n\nRetrieved Context Snippets:\n${contextSnippets.join('\n')}\n\nAnaliza la User Query y los Retrieved Context Snippets y responde únicamente en el formato JSON especificado en las instrucciones del sistema.`;
                    const ambiguityMessages = [ { role: "system", content: ambiguitySystemPrompt }, { role: "user", content: ambiguityUserPrompt }];

                    console.log(`(Controller) Calling LLM for ambiguity detection for CV:${conversationId}`);
                    const ambiguityResponseString = await openaiService.getChatCompletion(ambiguityMessages, AMBIGUITY_LLM_MODEL, AMBIGUITY_LLM_TEMP, AMBIGUITY_LLM_MAX_TOKENS_OUTPUT);

                    if (ambiguityResponseString) {
                        try {
                            const parsedResponse = JSON.parse(ambiguityResponseString);
                            if (parsedResponse && typeof parsedResponse.is_ambiguous === 'boolean') {
                                isAmbiguous = parsedResponse.is_ambiguous;
                                clarificationQuestion = parsedResponse.clarification_question || null;
                                clarificationOptions = Array.isArray(parsedResponse.options) ? parsedResponse.options : [];
                                if (isAmbiguous) { console.log(`(Controller) Query deemed AMBIGUOUS for CV:${conversationId}. Question: '${clarificationQuestion}', Options: ${clarificationOptions.join(', ')}`); }
                                else { console.log(`(Controller) Query deemed NOT AMBIGUOUS for CV:${conversationId}.`); }
                            } else { console.warn("(Controller) Ambiguity LLM response invalid JSON or missing fields:", ambiguityResponseString); }
                        } catch (parseError) { console.error("(Controller) Error parsing ambiguity LLM JSON:", parseError, "Raw:", ambiguityResponseString); }
                    } else { console.warn("(Controller) Ambiguity LLM call returned empty."); }
                } else { console.log("(Controller) No context snippets for ambiguity detection."); }
            } catch (error) { console.error("(Controller) Error during ambiguity detection LLM call:", error.message); }
        }

        if (isAmbiguous && clarificationQuestion) {
            console.log(`(Controller) Responding with clarification request for CV:${conversationId}. Original (or refined if applicable) query was: "${userQueryStringForAmbiguity}"`);
            // Save user's actual ambiguous message that LED to this clarification
            await db.saveMessage(conversationId, 'user', userMessageInput);
            db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => console.error("Analytics err (ambig):", err));
            // Save bot's clarification question
            await db.saveMessage(conversationId, 'bot', clarificationQuestion);
            db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => console.error("Analytics err (ambig):", err));

            return res.status(200).json({
                reply: clarificationQuestion,
                action_required: "request_clarification",
                clarification_options: clarificationOptions,
                original_ambiguous_query: userQueryStringForAmbiguity, // The query that was ambiguous
                original_retrieved_chunks: initialRelevantKnowledge.slice(0, AMBIGUITY_DETECTION_TOP_N_CHUNKS)
            });
        } else {
            // --- LLM-based Context Filtering & Summarization ---
            // Use `userQueryStringForAmbiguity` (which is `effectiveQuery`) for prompts here
            let knowledgeForProcessing = initialRelevantKnowledge.slice(0, LLM_FILTER_TOP_N_CHUNKS);
            let filteredKnowledge = [];
            if (ENABLE_LLM_CONTEXT_FILTERING && knowledgeForProcessing.length > 0) {
                 for (const chunk of knowledgeForProcessing) {
                    try {
                        const relevancePrompt = `User Question: '${userQueryStringForAmbiguity}'. Is the following 'Text Snippet' directly relevant... Snippet: '${chunk.content}'`;
                        const relevanceMessages = [ { role: "system", content: "..." }, { role: "user", content: relevancePrompt }];
                        const relevanceResponse = await openaiService.getChatCompletion(relevanceMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_RELEVANCE, 10);
                        if (relevanceResponse && relevanceResponse.trim().toLowerCase().startsWith('yes')) { filteredKnowledge.push(chunk); }
                    } catch (filterError) { filteredKnowledge.push(chunk); }
                }
                if (filteredKnowledge.length === 0 && knowledgeForProcessing.length > 0) filteredKnowledge = [...knowledgeForProcessing];
            } else { filteredKnowledge = [...knowledgeForProcessing]; }

            let processedKnowledgeForContext = [];
            if (ENABLE_LLM_CONTEXT_SUMMARIZATION && filteredKnowledge.length > 0) {
                for (const chunk of filteredKnowledge) {
                    try {
                        const summaryPrompt = `User Question: '${userQueryStringForAmbiguity}'. From the 'Text Snippet' below, extract... Snippet: '${chunk.content}'`;
                        const summaryMessages = [ { role: "system", content: "..." }, { role: "user", content: summaryPrompt }];
                        const summaryMaxTokens = Math.min(encode(chunk.content || "").length + 50, 300);
                        const summaryResponse = await openaiService.getChatCompletion(summaryMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_SUMMARY, summaryMaxTokens);
                        if (summaryResponse && summaryResponse.trim().length > 0) { processedKnowledgeForContext.push({ ...chunk, extracted_content: summaryResponse.trim() }); }
                        else { processedKnowledgeForContext.push(chunk); }
                    } catch (summaryError) { processedKnowledgeForContext.push(chunk); }
                }
            } else { processedKnowledgeForContext = [...filteredKnowledge]; }

            let propositionsSectionText = "";
            if (propositionResults.length > 0) { /* ... as before ... */ }

            let fullChunksSectionText = "";
            if (processedKnowledgeForContext.length > 0) { /* ... as before, using processedKnowledgeForContext ... */ }

            let ragContext = propositionsSectionText + fullChunksSectionText;
            if (!ragContext) { ragContext = "(No se encontró contexto relevante o procesado para esta pregunta)"; }

            let mutableConversationHistory = [...conversationHistory];
            let mutableRagContext = ragContext;
            const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado... (full prompt as defined before, including ambiguity handling instructions if desired)`;
            let finalSystemPromptContent = systemPromptBase + (/* ... context string construction ... */);
            // ... (Token counting and truncation logic as before) ...

            const messagesForAPI = [{ role: "system", content: finalSystemPromptContent }, ...mutableConversationHistory, { role: "user", content: effectiveQuery }]; // Use effectiveQuery for final LLM call
            let botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);

            const originalBotReplyText = botReplyText;
            let wasEscalated = false;
            if (originalBotReplyText && originalBotReplyText.trim() === BOT_CANNOT_ANSWER_MSG) { /* ... escalation logic as before, using effectiveQuery in analytics ... */
                 db.updateAnalyticOnBotCannotAnswer(conversationId, effectiveQuery).catch(err => console.error(`Analytics: Failed to update bot_cannot_answer for CV:${conversationId}`, err));
                 await db.updateConversationStatusByAgent(conversationId, clientId, null, 'escalated_to_human');
                 botReplyText = BOT_ESCALATION_NOTIFICATION_MSG; wasEscalated = true;
                 db.updateAnalyticOnEscalation(conversationId, new Date(), effectiveQuery).catch(err => console.error(`Analytics: Failed to update escalation data for CV:${conversationId}`, err));
            }

            const retrievedContextForLog = rawRankedResultsForLog ? rawRankedResultsForLog.map(c => ({ id: c.id, content_preview: c.content.substring(0,150)+"...", score: c.reranked_score, metadata: c.metadata })) : [];
            const logData = {
                clientId,
                conversationId,
                userQuery: effectiveQuery,
                retrievedContext: retrievedContextForLog,
                finalPromptToLlm: JSON.stringify(messagesForAPI),
                llmResponse: botReplyText,
                queryEmbeddingsUsed: queriesThatWereEmbedded,
                vectorSearchParams: searchParamsUsed,
                wasEscalated,
                predicted_query_category: predictedCategory // Add this line
            };

            try {
                const ragLogResult = await db.logRagInteraction(logData);
                if (ragLogResult && ragLogResult.rag_interaction_log_id) {
                    ragLogId = ragLogResult.rag_interaction_log_id;
                    console.log(`(Controller) RAG Interaction logged with ID: ${ragLogId}`);
                } else {
                    console.error("(Controller) Failed to get rag_interaction_log_id from logRagInteraction result:", ragLogResult);
                }
            } catch (err) {
                console.error("(Controller) Error logging RAG interaction:", err.message);
            }

            if (botReplyText) {
                // Save the user's actual typed message, and bot's reply
                await db.saveMessage(conversationId, 'user', userMessageInput); // User message does not get ragLogId
                db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => console.error("Analytics err:", err));
                await db.saveMessage(conversationId, 'bot', botReplyText, ragLogId); // Pass ragLogId here for bot message
                db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => console.error("Analytics err:", err));

                if (!(clarification_response_details && clarification_response_details.original_query)) { // Don't cache if it was a clarification cycle that led to this answer
                    db.setCache(cacheKey, botReplyText);
                }
                res.status(200).json({ reply: botReplyText });
            } else {
                res.status(503).json({ reply: 'Lo siento, estoy teniendo problemas para procesar tu solicitud en este momento.' });
            }
        }
    } catch (error) {
        console.error(`(Controller) Error general en handleChatMessage para ${conversationId}:`, error);
        next(error);
    }
};

export const startConversation = async (req, res, next) => { /* ... existing ... */
    console.log('>>> chatController.js: DENTRO de startConversation');
    const { clientId } = req.body;
    if (!clientId) {
        console.warn('Petición inválida a /start. Falta clientId.');
        return res.status(400).json({ error: 'Falta clientId.' });
    }

    // Validate clientId format
    if (!UUID_REGEX.test(clientId)) {
        return res.status(400).json({ error: 'clientId has an invalid format.' });
    }
    try {
        const clientExists = await db.getClientConfig(clientId);
        if (!clientExists) {
            console.warn(`Intento de iniciar conversación para cliente inexistente: ${clientId}`);
            return res.status(404).json({ error: 'Cliente inválido o no encontrado.' });
        }
        const newConversationId = await db.createConversation(clientId); // Assuming this returns just the ID now
        if (!newConversationId) {
            throw new Error("Failed to create conversation or retrieve its ID.");
        }
        console.log(`(Controller) Conversación iniciada/creada: ${newConversationId} para cliente ${clientId}`);

        // Fetch the full conversation object to get created_at for analytics
        const convDetails = await supabase.from('conversations').select('created_at').eq('conversation_id', newConversationId).single();
        if (convDetails.data) {
            db.createConversationAnalyticEntry(newConversationId, clientId, convDetails.data.created_at)
             .catch(err => console.error(`Analytics: Failed to create entry for CV:${newConversationId}`, err));
        } else {
             console.error(`Analytics: Could not fetch created_at for new CV:${newConversationId}`);
        }


        res.status(201).json({ conversationId: newConversationId });
    } catch (error) {
        console.error(`Error en startConversation para cliente ${clientId}:`, error);
        next(error);
    }
};
export default { handleChatMessage, startConversation };

// Ensure all other existing functions (getClientConfig etc.) are maintained below if they were part of the original file.
// For this operation, only handleChatMessage and startConversation were shown in the prompt for context.
// The overwrite will replace the entire file, so all exports must be present.
// (The full file content from previous steps should be used as a base for the overwrite)
