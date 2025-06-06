// src/controllers/chatController.js
import logger from '../utils/logger.js';
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
    const { message, conversationId, clarification_response_details, intent } = req.body;
    let userMessageInput = message;

    let effectiveClientId;
    if (req.user && req.user.id) {
        effectiveClientId = req.user.id;
        if (req.body.clientId && req.body.clientId !== effectiveClientId) {
            logger.warn(`(ChatCtrl) User ${effectiveClientId} attempted to use clientId ${req.body.clientId} in authenticated route.`);
        }
    } else if (req.body.clientId) {
        effectiveClientId = req.body.clientId;
    } else {
        return res.status(400).json({ error: 'Falta clientId o no se pudo determinar.' });
    }

    if (!conversationId || !effectiveClientId) {
        logger.warn(`(ChatCtrl) Petición inválida a /message: Missing conversationId or effectiveClientId. CV_ID: ${conversationId}, Eff_CID: ${effectiveClientId}`, req.body);
        return res.status(400).json({ error: 'Faltan datos requeridos (conversationId, clientId).' });
    }
    if (!userMessageInput && !clarification_response_details && !(intent && intent === 'request_human_escalation')) {
        return res.status(400).json({ error: 'Missing message, clarification_response_details, or valid intent for escalation.' });
    }
    if (userMessageInput && typeof userMessageInput !== 'string') {
        return res.status(400).json({ error: 'Invalid message format. Must be a string.' });
    }
    if (userMessageInput && userMessageInput.length > 2000) {
        return res.status(400).json({ error: 'Message exceeds maximum length of 2000 characters.' });
    }
    if (clarification_response_details) {
        if (typeof clarification_response_details !== 'object' || clarification_response_details === null) {
            return res.status(400).json({ error: 'Invalid clarification_response_details format. Must be an object.' });
        }
        if (clarification_response_details.hasOwnProperty('original_query') &&
            (typeof clarification_response_details.original_query !== 'string' || clarification_response_details.original_query.trim() === '')) {
            return res.status(400).json({ error: 'Invalid original_query in clarification_response_details. Must be a non-empty string.' });
        }
        if (clarification_response_details.hasOwnProperty('original_chunks') &&
            !Array.isArray(clarification_response_details.original_chunks)) {
            return res.status(400).json({ error: 'Invalid original_chunks in clarification_response_details. Must be an array.' });
        }
    }
    if (intent && typeof intent !== 'string') {
        return res.status(400).json({ error: 'Invalid intent format. Must be a string.' });
    }
    if (!UUID_REGEX.test(conversationId)) {
        return res.status(400).json({ error: 'conversationId has an invalid format.' });
    }
    if (!UUID_REGEX.test(effectiveClientId)) {
        return res.status(400).json({ error: 'clientId has an invalid format.' });
    }

    let effectiveQuery = userMessageInput;
    let originalQueryForContext = userMessageInput;
    let ragLogId = null;

    if (clarification_response_details && clarification_response_details.original_query) {
        logger.info(`(ChatCtrl) Received a clarification response for original query: "${clarification_response_details.original_query}" with user's choice/input: "${userMessageInput}"`);
        effectiveQuery = `${clarification_response_details.original_query} - ${userMessageInput}`;
        originalQueryForContext = clarification_response_details.original_query;
        logger.info(`(ChatCtrl) Using refined query for RAG: "${effectiveQuery}"`);
    }

    if (!clarification_response_details && !(intent && intent === 'request_human_escalation') && !userMessageInput) {
        return res.status(400).json({ error: 'Message input is required when not providing clarification details or requesting escalation.' });
    }

    if (intent && intent === 'request_human_escalation') {
        logger.info(`(ChatCtrl) User initiated escalation for CV:${conversationId}, C:${effectiveClientId}`);
        try {
            const escalationMessage = userMessageInput ? `El usuario ha solicitado hablar con un agente humano. Mensaje: "${userMessageInput}"` : 'El usuario ha solicitado hablar con un agente humano.';
            await db.saveMessage(conversationId, 'user', escalationMessage);
            db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => logger.error(`(ChatCtrl) Analytics: Failed to increment user message count for CV:${conversationId}`, err));
            await db.updateConversationStatusByAgent(conversationId, effectiveClientId, null, 'escalated_to_human');
            db.updateAnalyticOnEscalation(conversationId, new Date(), `User explicitly requested human escalation. Associated message: "${userMessageInput || ''}"`)
                .catch(err => logger.error(`(ChatCtrl) Analytics: Failed to update escalation data for CV:${conversationId}`, err));
            return res.status(200).json({ status: "escalation_requested", reply: "Tu solicitud para hablar con un agente ha sido recibida. Alguien se pondrá en contacto contigo pronto." });
        } catch (escalationError) {
            logger.error(`(ChatCtrl) Error during user-initiated escalation for CV:${conversationId}:`, escalationError);
            return res.status(500).json({ error: "No se pudo procesar tu solicitud de escalación en este momento." });
        }
    }
    if (!userMessageInput && !clarification_response_details) {
        logger.warn(`(ChatCtrl) handleChatMessage: Potentially unhandled case - intent provided ('${intent}') without a message for CV ${conversationId}.`);
        return res.status(400).json({ error: 'Message input is required for the provided intent.' });
    }

    logger.info(`(ChatCtrl) Mensaje (effectiveQuery) recibido C:${effectiveClientId}, CV:${conversationId}: "${effectiveQuery.substring(0, 100)}..."`);

    try {
        const cacheKey = `${effectiveClientId}:${conversationId}:${effectiveQuery}`;
        const cachedReply = db.getCache(cacheKey);
        if (cachedReply) {
            db.saveMessage(conversationId, 'user', userMessageInput).then(() => db.incrementAnalyticMessageCount(conversationId, 'user')).catch(err => logger.error("(ChatCtrl) Analytics save user msg err (cache):", err));
            db.saveMessage(conversationId, 'bot', cachedReply).then(() => db.incrementAnalyticMessageCount(conversationId, 'bot')).catch(err => logger.error("(ChatCtrl) Analytics save bot msg err (cache):", err));
            return res.status(200).json({ reply: cachedReply });
        }
        logger.debug("(ChatCtrl) No encontrado en caché. Procesando...");

        let conversationHistory = await db.getConversationHistory(conversationId);
        if (!Array.isArray(conversationHistory)) {
            logger.warn(`(ChatCtrl) conversationHistory for CV:${conversationId} was not an array, defaulting to empty. Original value:`, conversationHistory);
            conversationHistory = []; // Ensure it's an array
        }
        const hybridSearchOutput = await db.hybridSearch(
            effectiveClientId,
            effectiveQuery,
            conversationId,
            {},   // options
            true  // returnPipelineDetails
        );

        // *** INICIO DEL CAMBIO IMPORTANTE ***
        // Validación de robustez para prevenir el crash
        if (!hybridSearchOutput || !Array.isArray(hybridSearchOutput.results)) {
            logger.error(`(ChatCtrl) hybridSearch devolvió un resultado inesperado o nulo para la consulta: "${effectiveQuery}"`);
            // Devuelve una respuesta segura en lugar de fallar
            await db.saveMessage(conversationId, 'user', userMessageInput);
            await db.saveMessage(conversationId, 'bot', BOT_CANNOT_ANSWER_MSG);
            db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => logger.error("(ChatCtrl) Analytics err (robustness fallback):", err));
            db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => logger.error("(ChatCtrl) Analytics err (robustness fallback):", err));
            return res.status(200).json({ reply: BOT_CANNOT_ANSWER_MSG });
        }
        // *** FIN DEL CAMBIO IMPORTANTE ***
        
        logger.debug("(ChatCtrl) hybridSearchOutput recibido:", JSON.stringify(hybridSearchOutput, null, 2));

        const resultsForMapping = hybridSearchOutput.results;
        
        logger.debug(`(ChatCtrl) ANTES DEL MAP - Variable 'resultsForMapping': isArray: ${Array.isArray(resultsForMapping)}, length: ${resultsForMapping.length}`);
        if (resultsForMapping === undefined) { 
            logger.error("(ChatCtrl) ERROR CRÍTICO: 'resultsForMapping' ES UNDEFINED justo antes del .map()");
        }

        let retrievedContextForLog = [];
        if (Array.isArray(resultsForMapping)) {
            try {
                retrievedContextForLog = resultsForMapping.map(c => {
                    if (!c) {
                        logger.warn("(ChatCtrl) Elemento 'c' dentro de resultsForMapping.map es null o undefined. Saltando este elemento.");
                        return { id: 'INVALID_CHUNK_IN_MAP', content_preview: 'Chunk inválido en map', score: 0, metadata: {} };
                    }
                    return {
                        id: c.id,
                        content_preview: (c.content && typeof c.content === 'string' ? c.content.substring(0,150) : "Contenido no disponible") + "...",
                        score: c.reranked_score ?? c.hybrid_score ?? 0,
                        metadata: c.metadata
                    };
                });
            } catch (mapError) {
                logger.error("(ChatCtrl) Error DENTRO del .map() de resultsForMapping:", mapError.message, mapError.stack?.substring(0,300));
                logger.error("(ChatCtrl) resultsForMapping que causó el error en .map():", JSON.stringify(resultsForMapping));
            }
        } else {
            logger.warn("(ChatCtrl) 'resultsForMapping' NO ES UN ARRAY justo antes del .map(). Se usará array vacío para retrievedContextForLog.");
        }
        logger.debug(`(ChatCtrl) DESPUÉS DEL MAP - retrievedContextForLog (primeros 2): ${JSON.stringify(retrievedContextForLog.slice(0,2))}`);


        const initialRelevantKnowledge = resultsForMapping;
        const propositionResults = (hybridSearchOutput && Array.isArray(hybridSearchOutput.propositionResults))
            ? hybridSearchOutput.propositionResults
            : [];

        // --- Ambiguity Detection ---
        let isAmbiguous = false;
        let clarificationQuestion = null;
        let clarificationOptions = [];
        const userQueryStringForAmbiguity = effectiveQuery;

        if (ENABLE_AMBIGUITY_DETECTION && initialRelevantKnowledge && initialRelevantKnowledge.length > 0 && (!clarification_response_details)) {
            try {
                const contextSnippets = initialRelevantKnowledge.slice(0, AMBIGUITY_DETECTION_TOP_N_CHUNKS).map((chunk, index) => {
                    return `Snippet ${index + 1} (ID: ${chunk.id}): "${(chunk.content || "").substring(0, 200)}..."`;
                });

                if (contextSnippets.length > 0) {
                    const ambiguitySystemPrompt = `Eres un asistente de IA altamente especializado en identificar ambigüedades en consultas de usuarios basándote en un contexto limitado. Dada la "User Query" y varios "Retrieved Context Snippets", determina si la consulta es ambigua EN RELACIÓN A LOS FRAGMENTOS PROPORCIONADOS. Una consulta es ambigua si los fragmentos sugieren múltiples interpretaciones o respuestas posibles válidas, o si la consulta es demasiado general y los fragmentos cubren varios subtemas que podrían ser relevantes. Responde en formato JSON con los siguientes campos: "is_ambiguous" (boolean), "clarification_question" (string, null si no es ambigua, debe ser una pregunta directa al usuario para resolver la ambigüedad), "options" (array de strings, null o vacío si no hay opciones claras, deben ser opciones concisas para que el usuario elija). La "clarification_question" NO debe pedir al usuario que reformule, sino que concrete su necesidad. Ejemplo: si la consulta es "info sobre producto" y los fragmentos hablan de "Producto A" y "Producto B", la pregunta podría ser "¿Te refieres al Producto A o al Producto B?" con opciones ["Producto A", "Producto B"]. Si la consulta es clara o los fragmentos no ofrecen múltiples caminos claros, "is_ambiguous" debe ser false.`;
                    const ambiguityUserPrompt = `User Query: "${userQueryStringForAmbiguity}"\n\nRetrieved Context Snippets:\n${contextSnippets.join('\n')}\n\nAnaliza la User Query y los Retrieved Context Snippets y responde únicamente en el formato JSON especificado en las instrucciones del sistema.`;
                    const ambiguityMessages = [ { role: "system", content: ambiguitySystemPrompt }, { role: "user", content: ambiguityUserPrompt }];

                    logger.debug(`(ChatCtrl) Calling LLM for ambiguity detection for CV:${conversationId}`);
                    const ambiguityResponseString = await getChatCompletion(ambiguityMessages, AMBIGUITY_LLM_MODEL, AMBIGUITY_LLM_TEMP, AMBIGUITY_LLM_MAX_TOKENS_OUTPUT);

                    if (ambiguityResponseString) {
                        try {
                            const parsedResponse = JSON.parse(ambiguityResponseString);
                            if (parsedResponse && typeof parsedResponse.is_ambiguous === 'boolean') {
                                isAmbiguous = parsedResponse.is_ambiguous;
                                clarificationQuestion = parsedResponse.clarification_question || null;
                                clarificationOptions = Array.isArray(parsedResponse.options) ? parsedResponse.options : [];
                                if (isAmbiguous) { logger.info(`(ChatCtrl) Query deemed AMBIGUOUS for CV:${conversationId}. Question: '${clarificationQuestion}', Options: ${clarificationOptions.join(', ')}`); }
                                else { logger.info(`(ChatCtrl) Query deemed NOT AMBIGUOUS for CV:${conversationId}.`); }
                            } else { logger.warn("(ChatCtrl) Ambiguity LLM response invalid JSON or missing fields:", ambiguityResponseString); }
                        } catch (parseError) { logger.error("(ChatCtrl) Error parsing ambiguity LLM JSON:", parseError, "Raw:", ambiguityResponseString); }
                    } else { logger.warn("(ChatCtrl) Ambiguity LLM call returned empty."); }
                } else { logger.debug("(ChatCtrl) No context snippets for ambiguity detection."); }
            } catch (error) { logger.error("(ChatCtrl) Error during ambiguity detection LLM call:", error.message); }
        }

        if (isAmbiguous && clarificationQuestion) {
            logger.info(`(ChatCtrl) Responding with clarification request for CV:${conversationId}. Original query was: "${userQueryStringForAmbiguity}"`);
            await db.saveMessage(conversationId, 'user', userMessageInput);
            db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => logger.error("(ChatCtrl) Analytics err (ambig):", err));
            await db.saveMessage(conversationId, 'bot', clarificationQuestion);
            db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => logger.error("(ChatCtrl) Analytics err (ambig):", err));

            return res.status(200).json({
                reply: clarificationQuestion,
                action_required: "request_clarification",
                clarification_options: clarificationOptions,
                original_ambiguous_query: userQueryStringForAmbiguity,
                original_retrieved_chunks: initialRelevantKnowledge.slice(0, AMBIGUITY_DETECTION_TOP_N_CHUNKS)
            });
        } else {
            // --- LLM-based Context Filtering & Summarization ---
            let knowledgeForProcessing = initialRelevantKnowledge.slice(0, LLM_FILTER_TOP_N_CHUNKS);
            let filteredKnowledge = [];

            if (ENABLE_LLM_CONTEXT_FILTERING && knowledgeForProcessing.length > 0) {
                 for (const chunk of knowledgeForProcessing) {
                    try {
                        const relevancePrompt = `User Question: '${userQueryStringForAmbiguity}'. Is the following 'Text Snippet' directly relevant and useful for answering the user's question? Respond with only 'YES' or 'NO'. Text Snippet: '${chunk.content}'`;
                        const relevanceMessages = [ { role: "system", content: "You are an AI assistant that judges relevance. Respond with only YES or NO." }, { role: "user", content: relevancePrompt }];
                        const relevanceResponse = await getChatCompletion(relevanceMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_RELEVANCE, 10);
                        if (relevanceResponse && relevanceResponse.trim().toLowerCase().startsWith('yes')) { filteredKnowledge.push(chunk); }
                    } catch (filterError) {
                        logger.warn(`(ChatCtrl) LLM relevance check error for chunk ID ${chunk.id}, keeping chunk. Error: ${filterError.message}`);
                        filteredKnowledge.push(chunk);
                    }
                }
                if (filteredKnowledge.length === 0 && knowledgeForProcessing.length > 0) {
                    logger.warn("(ChatCtrl) LLM filtering removed all chunks, falling back to original top N for processing.");
                    filteredKnowledge = [...knowledgeForProcessing];
                }
            } else {
                filteredKnowledge = [...knowledgeForProcessing];
            }

            let processedKnowledgeForContext = [];
            if (ENABLE_LLM_CONTEXT_SUMMARIZATION && filteredKnowledge.length > 0) {
                for (const chunk of filteredKnowledge) {
                    try {
                        const summaryPrompt = `User Question: '${userQueryStringForAmbiguity}'. From the 'Text Snippet' below, extract only the sentence(s) or key phrases that directly help answer the question. If no part is relevant, or if the snippet is already very concise and relevant, return the original snippet. If absolutely no part is relevant, return an empty string. Text Snippet: '${chunk.content}'`;
                        const summaryMessages = [ { role: "system", content: "You are an AI assistant that extracts key relevant sentences from text." }, { role: "user", content: summaryPrompt }];
                        const summaryMaxTokens = Math.min(encode(chunk.content || "").length + 50, 300);
                        const summaryResponse = await getChatCompletion(summaryMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_SUMMARY, summaryMaxTokens);
                        if (summaryResponse && summaryResponse.trim().length > 0) {
                            processedKnowledgeForContext.push({ ...chunk, extracted_content: summaryResponse.trim() });
                        } else {
                            processedKnowledgeForContext.push(chunk);
                        }
                    } catch (summaryError) {
                        logger.warn(`(ChatCtrl) LLM summarization error for chunk ID ${chunk.id}, using original. Error: ${summaryError.message}`);
                        processedKnowledgeForContext.push(chunk);
                    }
                }
            } else {
                processedKnowledgeForContext = [...filteredKnowledge];
            }

            // --- Score-based Prioritization and Token-limited Truncation ---
            const LLM_TOKEN_SAFETY_MARGIN = 200;
            const TOKENS_PER_CHUNK_OVERHEAD = 65;
            const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado de SynChat AI (synchatai.com). Tu ÚNICA fuente de información es el "Contexto" proporcionado a continuación. NO debes usar ningún conocimiento externo ni hacer suposiciones. Instrucciones ESTRICTAS: 1. Responde SOLAMENTE basándote en la información encontrada en el "Contexto". 2. Si la respuesta a la pregunta del usuario se encuentra en el "Contexto", respóndela de forma clara y concisa (máximo 3-4 frases). 3. Si varios fragmentos del contexto responden a la pregunta del usuario, sintetiza la información en una respuesta única y coherente en español. No te limites a enumerar los fragmentos. 4. Cuando utilices información de una fuente específica del contexto, menciónala de forma breve al final de tu respuesta de la siguiente manera: '(Fuente: [Nombre de la Fuente del Contexto])'. 5. Si el contexto no contiene una respuesta clara, o si la información es contradictoria o ambigua, responde ÚNICA Y EXACTAMENTE con: "${BOT_CANNOT_ANSWER_MSG}" NO intentes adivinar ni buscar en otro lado. 6. Sé amable y profesional.`;
            const formattedHistoryForTokenCalc = conversationHistory.map(msg => `${msg.sender === 'user' ? 'User' : 'Assistant'}: ${msg.content || ''}`).join('\n');
            let basePromptTokens = encode(systemPromptBase).length + encode(formattedHistoryForTokenCalc).length + encode(effectiveQuery).length + encode("Contexto de la base de conocimiento:").length + encode("Proposiciones Relevantes:").length + encode("Fragmentos de Documentos Relevantes:").length;
            const finalChunksForLLMContext = [];
            let currentAccumulatedTokens = basePromptTokens;
            const effectiveMaxContextTokens = MAX_CONTEXT_TOKENS_FOR_LLM - LLM_TOKEN_SAFETY_MARGIN;

            const sortedChunksForContextSelection = [...processedKnowledgeForContext].sort((a, b) => (b.reranked_score ?? b.hybrid_score ?? 0) - (a.reranked_score ?? a.hybrid_score ?? 0));

            for (const chunk of sortedChunksForContextSelection) {
                const contentToTokenize = chunk.extracted_content || chunk.content;
                if (!contentToTokenize) continue;
                const chunkTokens = encode(contentToTokenize).length;
                const chunkWithOverheadTokens = chunkTokens + TOKENS_PER_CHUNK_OVERHEAD;
                if (currentAccumulatedTokens + chunkWithOverheadTokens <= effectiveMaxContextTokens) {
                    finalChunksForLLMContext.push(chunk);
                    currentAccumulatedTokens += chunkWithOverheadTokens;
                } else {
                    break;
                }
            }
            if (finalChunksForLLMContext && finalChunksForLLMContext.length > 1) {
                const secondBestChunk = finalChunksForLLMContext.splice(1, 1)[0];
                if (secondBestChunk) finalChunksForLLMContext.push(secondBestChunk);
            }

            // Construcción de ragContext
            let propositionsSectionText = "";
            if (propositionResults && propositionResults.length > 0) {
                 propositionsSectionText = "Proposiciones Relevantes:\n";
                 propositionResults.forEach((prop, index) => {
                    propositionsSectionText += `Proposición ${index + 1} (ID: ${prop.proposition_id}, ChunkID: ${prop.source_chunk_id}, Similitud: ${prop.similarity?.toFixed(3) || 'N/A'}):\n${prop.proposition_text}\n---\n`;
                 });
            }
            let fullChunksSectionText = "";
            if (finalChunksForLLMContext && finalChunksForLLMContext.length > 0) {
                fullChunksSectionText = "Fragmentos de Documentos Relevantes:\n";
                finalChunksForLLMContext.forEach((chunk, index) => {
                    let chunkString = `--- Document Start (ID: ${chunk.id}, Score: ${(chunk.reranked_score ?? chunk.hybrid_score ?? 0).toFixed(3)}) ---\n`;
                    chunkString += `Source: ${chunk.metadata?.source_name || 'N/A'}\n`;
                    if (chunk.metadata?.hierarchy && Array.isArray(chunk.metadata.hierarchy) && chunk.metadata.hierarchy.length > 0) {
                        chunkString += `Section Path: ${chunk.metadata.hierarchy.map(h => h.text).join(' > ')}\n`;
                    } else { chunkString += "Section Path: N/A\n"; }
                    if (chunk.metadata?.page_number) { chunkString += `Page: ${chunk.metadata.page_number}\n`; }
                    else { chunkString += "Page: N/A\n"; }
                    const content = chunk.extracted_content || chunk.content || "No content available";
                    chunkString += `Content: ${content}\n--- Document End (ID: ${chunk.id}) ---\n\n`;
                    fullChunksSectionText += chunkString;
                });
            }
            let ragContext = propositionsSectionText + fullChunksSectionText;
            if (!ragContext.trim()) {
                 ragContext = "(No se encontró contexto relevante o procesado para esta pregunta)";
            }

            // Preparación final del prompt y llamada al LLM
            let finalSystemPromptContent = `${systemPromptBase}\n\nHistorial de Conversación Previa:\n${formattedHistoryForTokenCalc}\n\nContexto de la base de conocimiento:\n${ragContext}`;
            const messagesForAPI = [{ role: "system", content: finalSystemPromptContent }, { role: "user", content: effectiveQuery }];
            let botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);

            // Manejo de respuesta y escalación
            const originalBotReplyText = botReplyText;
            let wasEscalated = false;
            if (originalBotReplyText && originalBotReplyText.trim() === BOT_CANNOT_ANSWER_MSG) {
                 db.updateAnalyticOnBotCannotAnswer(conversationId, effectiveQuery).catch(err => logger.error(`(ChatCtrl) Analytics: Failed to update bot_cannot_answer for CV:${conversationId}`, err));
                 await db.updateConversationStatusByAgent(conversationId, effectiveClientId, null, 'escalated_to_human');
                 botReplyText = BOT_ESCALATION_NOTIFICATION_MSG;
                 wasEscalated = true;
                 db.updateAnalyticOnEscalation(conversationId, new Date(), effectiveQuery).catch(err => logger.error(`(ChatCtrl) Analytics: Failed to update escalation data for CV:${conversationId}`, err));
            }

            const messagesForAPI_for_log = messagesForAPI;
            const botReplyText_for_log = botReplyText;
            const wasEscalated_for_log = wasEscalated;

            const queriesThatWereEmbeddedForLog = hybridSearchOutput?.queriesEmbeddedForLog || [];
            const searchParamsUsedForLog = hybridSearchOutput?.searchParams || {};
            const predictedCategoryValueForLog = hybridSearchOutput?.predictedCategory || null;

            const logData = {
                client_id: effectiveClientId,
                conversation_id: conversationId,
                user_query: effectiveQuery || "",
                retrieved_context: retrievedContextForLog,
                final_prompt_to_llm: JSON.stringify(messagesForAPI_for_log),
                llm_response: botReplyText_for_log,
                query_embeddings_used: queriesThatWereEmbeddedForLog,
                vector_search_params: searchParamsUsedForLog,
                was_escalated: wasEscalated_for_log,
                predicted_query_category: predictedCategoryValueForLog
            };

            try {
                const ragLogResult = await db.logRagInteraction(logData);
                if (ragLogResult && ragLogResult.rag_interaction_log_id) {
                    ragLogId = ragLogResult.rag_interaction_log_id;
                    logger.info(`(ChatCtrl) RAG Interaction logged with ID: ${ragLogId}`);
                } else {
                    logger.error("(ChatCtrl) Failed to get rag_interaction_log_id from logRagInteraction result:", ragLogResult);
                }
            } catch (err) {
                logger.error("(ChatCtrl) Error logging RAG interaction:", err.message);
            }

            if (botReplyText_for_log) {
                await db.saveMessage(conversationId, 'user', userMessageInput);
                db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => logger.error("(ChatCtrl) Analytics err:", err));
                await db.saveMessage(conversationId, 'bot', botReplyText_for_log, ragLogId);
                db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => logger.error("(ChatCtrl) Analytics err:", err));

                if (!(clarification_response_details && clarification_response_details.original_query)) {
                    db.setCache(cacheKey, botReplyText_for_log);
                }
                res.status(200).json({ reply: botReplyText_for_log });
            } else {
                logger.error(`(ChatCtrl) No se pudo generar una respuesta válida del bot para CV:${conversationId}. Respuesta del LLM fue: ${botReplyText_for_log}`);
                res.status(503).json({ reply: 'Lo siento, estoy teniendo problemas para procesar tu solicitud en este momento.' });
            }
        }
    } catch (error) {
        logger.error(`(ChatCtrl) Error general en handleChatMessage para ${conversationId}:`, error.message, error.stack?.substring(0,500));
        next(error);
    }
};

export const startConversation = async (req, res, next) => {
    logger.info('>>> chatController.js: DENTRO de startConversation');
    let effectiveClientId;
    if (req.user && req.user.id) {
        effectiveClientId = req.user.id;
        if (req.body.clientId && req.body.clientId !== effectiveClientId) {
            logger.warn(`(ChatCtrl) User ${effectiveClientId} attempted to use clientId ${req.body.clientId} in authenticated route when starting a conversation.`);
        }
    } else if (req.body.clientId) {
        effectiveClientId = req.body.clientId;
    } else {
        return res.status(400).json({ error: 'Falta clientId o no se pudo determinar.' });
    }

    if (!effectiveClientId) {
        logger.warn('(ChatCtrl) Petición inválida a /start. Falta effectiveClientId.');
        return res.status(400).json({ error: 'Falta clientId.' });
    }
    if (!UUID_REGEX.test(effectiveClientId)) {
        return res.status(400).json({ error: 'clientId has an invalid format.' });
    }
    try {
        logger.info(`(ChatCtrl) startConversation: effectiveClientId recibido/derivado es: '${effectiveClientId}'`);
        const clientExists = await db.getClientConfig(effectiveClientId);
        if (!clientExists) {
            logger.warn(`(ChatCtrl) Intento de iniciar conversación para cliente inexistente: ${effectiveClientId}`);
            return res.status(404).json({ error: 'Cliente inválido o no encontrado.' });
        }
        const newConversationId = await db.createConversation(effectiveClientId);
        if (!newConversationId) {
            throw new Error("Failed to create conversation or retrieve its ID.");
        }
        logger.info(`(ChatCtrl) Conversación iniciada/creada: ${newConversationId} para cliente ${effectiveClientId}`);

        const { data: convDetails, error: fetchConvError } = await supabase.from('conversations').select('created_at').eq('conversation_id', newConversationId).single();
        if (fetchConvError) {
             logger.error(`(ChatCtrl) Analytics: Could not fetch created_at for new CV:${newConversationId}`, fetchConvError);
        } else if (convDetails) {
            db.createConversationAnalyticEntry(newConversationId, effectiveClientId, convDetails.created_at)
             .catch(err => logger.error(`(ChatCtrl) Analytics: Failed to create entry for CV:${newConversationId}`, err));
        } else {
             logger.warn(`(ChatCtrl) Analytics: No details returned for new CV:${newConversationId} after creation to log analytics.`);
        }

        res.status(201).json({ conversationId: newConversationId });
    } catch (error) {
        logger.error(`(ChatCtrl) Error en startConversation para cliente ${effectiveClientId}:`, error.message, error.stack?.substring(0,500));
        next(error);
    }
};

export default { handleChatMessage, startConversation };
