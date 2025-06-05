// src/controllers/chatController.js
import logger from '../utils/logger.js'; // Added logger import
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
    const { message, conversationId, clarification_response_details, intent } = req.body; // clientId removed from here
    let userMessageInput = message; // The actual text sent by the user in this turn

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

    // Base checks for essential parameters
    if (!conversationId || !effectiveClientId) { // Changed clientId to effectiveClientId
        logger.warn(`(ChatCtrl) Petición inválida a /message: Missing conversationId or effectiveClientId. CV_ID: ${conversationId}, Eff_CID: ${effectiveClientId}`, req.body);
        return res.status(400).json({ error: 'Faltan datos requeridos (conversationId, clientId).' });
    }
     // Check if there's any form of input or valid intent
    if (!userMessageInput && !clarification_response_details && !(intent && intent === 'request_human_escalation')) {
        return res.status(400).json({ error: 'Missing message, clarification_response_details, or valid intent for escalation.' });
    }

    // Input Validation for message
    if (userMessageInput && typeof userMessageInput !== 'string') {
        return res.status(400).json({ error: 'Invalid message format. Must be a string.' });
    }
    if (userMessageInput && userMessageInput.length > 2000) {
        return res.status(400).json({ error: 'Message exceeds maximum length of 2000 characters.' });
    }

    // Input Validation for clarification_response_details
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

    // Input Validation for intent
    if (intent && typeof intent !== 'string') {
        return res.status(400).json({ error: 'Invalid intent format. Must be a string.' });
    }

    // Validate conversationId format
    if (!UUID_REGEX.test(conversationId)) {
        return res.status(400).json({ error: 'conversationId has an invalid format.' });
    }

    // Validate clientId format
    if (!UUID_REGEX.test(effectiveClientId)) { // Changed clientId to effectiveClientId
        return res.status(400).json({ error: 'clientId has an invalid format.' });
    }

    let effectiveQuery = userMessageInput;
    let originalQueryForContext = userMessageInput;
    let ragLogId = null;

    if (clarification_response_details && clarification_response_details.original_query) {
        console.log(`(Controller) Received a clarification response for original query: "${clarification_response_details.original_query}" with user's choice/input: "${userMessageInput}"`);
        effectiveQuery = `${clarification_response_details.original_query} - ${userMessageInput}`;
        originalQueryForContext = clarification_response_details.original_query;
        console.log(`(Controller) Using refined query for RAG: "${effectiveQuery}"`);
    }

    if (!clarification_response_details && !(intent && intent === 'request_human_escalation') && !userMessageInput) {
        return res.status(400).json({ error: 'Message input is required when not providing clarification details or requesting escalation.' });
    }

    if (intent && intent === 'request_human_escalation') {
        logger.log(`(ChatCtrl) User initiated escalation for CV:${conversationId}, C:${effectiveClientId}`);
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

        const conversationHistory = await db.getConversationHistory(conversationId);
        const hybridSearchOutput = await db.hybridSearch(
            effectiveClientId,
            effectiveQuery,
            conversationId,
            {},
            true
        );

        const resultsToMap = (hybridSearchOutput && Array.isArray(hybridSearchOutput.results))
            ? hybridSearchOutput.results
            : [];

        const propositionResults = (hybridSearchOutput && Array.isArray(hybridSearchOutput.propositionResults))
            ? hybridSearchOutput.propositionResults
            : [];

        const rawRankedResultsForLog = (hybridSearchOutput && hybridSearchOutput.pipelineDetails && Array.isArray(hybridSearchOutput.pipelineDetails.finalRankedResultsForPlayground))
            ? hybridSearchOutput.pipelineDetails.finalRankedResultsForPlayground
            : resultsToMap;

        let initialRelevantKnowledge = resultsToMap;

        let isAmbiguous = false;
        let clarificationQuestion = null;
        let clarificationOptions = [];
        const userQueryStringForAmbiguity = effectiveQuery;

        if (ENABLE_AMBIGUITY_DETECTION && initialRelevantKnowledge && initialRelevantKnowledge.length > 0 && (!clarification_response_details)) {
            try {
                const contextSnippets = initialRelevantKnowledge.slice(0, AMBIGUITY_DETECTION_TOP_N_CHUNKS).map((chunk, index) => {
                    return `Snippet ${index + 1} (ID: ${chunk.id}): "${chunk.content.substring(0, 200)}..."`;
                });

                if (contextSnippets.length > 0) {
                    const ambiguitySystemPrompt = `Eres un asistente de IA altamente especializado... (prompt as defined before)`;
                    const ambiguityUserPrompt = `User Query: "${userQueryStringForAmbiguity}"

Retrieved Context Snippets:
${contextSnippets.join('
')}

Analiza la User Query y los Retrieved Context Snippets y responde únicamente en el formato JSON especificado en las instrucciones del sistema.`;
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
            logger.info(`(ChatCtrl) Responding with clarification request for CV:${conversationId}. Original (or refined if applicable) query was: "${userQueryStringForAmbiguity}"`);
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
            let knowledgeForProcessing = initialRelevantKnowledge.slice(0, LLM_FILTER_TOP_N_CHUNKS);
            let filteredKnowledge = [];
            if (ENABLE_LLM_CONTEXT_FILTERING && knowledgeForProcessing.length > 0) {
                 for (const chunk of knowledgeForProcessing) {
                    try {
                        const relevancePrompt = `User Question: '${userQueryStringForAmbiguity}'. Is the following 'Text Snippet' directly relevant... Snippet: '${chunk.content}'`;
                        const relevanceMessages = [ { role: "system", content: "..." }, { role: "user", content: relevancePrompt }];
                        const relevanceResponse = await getChatCompletion(relevanceMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_RELEVANCE, 10);
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
                        const summaryResponse = await getChatCompletion(summaryMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_SUMMARY, summaryMaxTokens);
                        if (summaryResponse && summaryResponse.trim().length > 0) { processedKnowledgeForContext.push({ ...chunk, extracted_content: summaryResponse.trim() }); }
                        else { processedKnowledgeForContext.push(chunk); }
                    } catch (summaryError) { processedKnowledgeForContext.push(chunk); }
                }
            } else { processedKnowledgeForContext = [...filteredKnowledge]; }

            const LLM_TOKEN_SAFETY_MARGIN = 200;
            const TOKENS_PER_CHUNK_OVERHEAD = 65;

            let initialTotalTokensOfConsideredChunks = 0;
            for (const chunk of processedKnowledgeForContext) {
                const content = chunk.extracted_content || chunk.content;
                if (content) {
                    initialTotalTokensOfConsideredChunks += encode(content).length;
                }
                initialTotalTokensOfConsideredChunks += TOKENS_PER_CHUNK_OVERHEAD;
            }
            logger.info(`(ChatCtrl) [Context Selection] Initial total chunks considered: ${processedKnowledgeForContext.length}, Approx. total tokens (content + overhead): ${initialTotalTokensOfConsideredChunks}`);

            const sortedChunksForContextSelection = [...processedKnowledgeForContext].sort((a, b) => {
                const scoreA = a.reranked_score ?? a.hybrid_score ?? 0;
                const scoreB = b.reranked_score ?? b.hybrid_score ?? 0;
                return scoreB - scoreA;
            });

            logger.info(`(ChatCtrl) [Context Selection] Chunks before token-based selection: ${processedKnowledgeForContext.length}`);

            const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado... (full prompt as defined before, including ambiguity handling instructions if desired)`;
            const formattedHistoryForTokenCalc = conversationHistory.map(msg => `${msg.sender === 'user' ? 'User' : 'Assistant'}: ${msg.content || ''}`).join('
');

            let basePromptTokens = encode(systemPromptBase).length;
            basePromptTokens += encode(formattedHistoryForTokenCalc).length;
            basePromptTokens += encode(effectiveQuery).length;
            basePromptTokens += encode("Contexto de la base de conocimiento:").length;
            basePromptTokens += encode("Proposiciones Relevantes:").length;
            basePromptTokens += encode("Fragmentos de Documentos Relevantes:").length;

            logger.info(`(ChatCtrl) [Context Selection] Base prompt tokens (system, history, query, fixed instructions): ${basePromptTokens}`);

            const finalChunksForLLMContext = [];
            let currentAccumulatedTokens = basePromptTokens;
            const effectiveMaxContextTokens = MAX_CONTEXT_TOKENS_FOR_LLM - LLM_TOKEN_SAFETY_MARGIN;

            for (const chunk of sortedChunksForContextSelection) {
                const contentToTokenize = chunk.extracted_content || chunk.content;
                if (!contentToTokenize) continue;

                const chunkTokens = encode(contentToTokenize).length;
                const chunkWithOverheadTokens = chunkTokens + TOKENS_PER_CHUNK_OVERHEAD;

                if (currentAccumulatedTokens + chunkWithOverheadTokens <= effectiveMaxContextTokens) {
                    finalChunksForLLMContext.push(chunk);
                    currentAccumulatedTokens += chunkWithOverheadTokens;
                } else {
                    logger.info(`(ChatCtrl) [Context Selection] Token limit reached. Cannot add chunk ID ${chunk.id} (tokens: ${chunkTokens}).`);
                    break;
                }
            }

            logger.info(`(ChatCtrl) [Context Selection] Chunks selected for LLM context: ${finalChunksForLLMContext.length}`);
            logger.info(`(ChatCtrl) [Context Selection] Accumulated tokens after chunk selection: ${currentAccumulatedTokens}`);
            logger.info(`(ChatCtrl) [Context Selection] Effective token limit for context: ${effectiveMaxContextTokens}`);

            // ---- INICIO DE LOGGING ADICIONAL V2 ----
            logger.debug(`(ChatCtrl) [Pre-LIMM-V2] typeof finalChunksForLLMContext: ${typeof finalChunksForLLMContext}`);
            logger.debug(`(ChatCtrl) [Pre-LIMM-V2] Array.isArray(finalChunksForLLMContext): ${Array.isArray(finalChunksForLLMContext)}`);
            if (typeof finalChunksForLLMContext !== 'undefined' && finalChunksForLLMContext !== null) {
                logger.debug(`(ChatCtrl) [Pre-LIMM-V2] finalChunksForLLMContext.length: ${finalChunksForLLMContext.length}`);
                try {
                    if (finalChunksForLLMContext.length > 0) {
                        logger.debug(`(ChatCtrl) [Pre-LIMM-V2] finalChunksForLLMContext first 2 items (sample): ${JSON.stringify(finalChunksForLLMContext.slice(0,2))}`);
                    } else {
                        logger.debug(`(ChatCtrl) [Pre-LIMM-V2] finalChunksForLLMContext is an empty array.`);
                    }
                } catch (e) {
                    logger.error(`(ChatCtrl) [Pre-LIMM-V2] Error stringifying finalChunksForLLMContext: ${e.message}`);
                }
            } else {
                logger.warn(`(ChatCtrl) [Pre-LIMM-V2] finalChunksForLLMContext is null or undefined just before LIMM block.`);
            }
            // ---- FIN DE LOGGING ADICIONAL V2 ----

            // "Lost in the Middle" Mitigation: Reorder chunks - best first, second-best last.
            if (finalChunksForLLMContext && Array.isArray(finalChunksForLLMContext) && finalChunksForLLMContext.length > 1) {
                logger.info(`(ChatCtrl) [LIMM-Guard-V2] Applying LIMM. Chunk IDs before reorder: ${finalChunksForLLMContext.map(c => c.id).join(', ')}`); // Esta es aprox. la línea 296 original
                const secondBestChunk = finalChunksForLLMContext.splice(1, 1)[0];
                finalChunksForLLMContext.push(secondBestChunk);
                logger.info(`(ChatCtrl) [LIMM-Guard-V2] Applied LIMM strategy.`);
                logger.info(`(ChatCtrl) [LIMM-Guard-V2] Chunk IDs after reorder: ${finalChunksForLLMContext.map(c => c.id).join(', ')}`);
            } else if (Array.isArray(finalChunksForLLMContext)) {
                 logger.info(`(ChatCtrl) [LIMM-Guard-V2] LIMM not applied, finalChunksForLLMContext is an array with length ${finalChunksForLLMContext.length}.`);
            } else {
                 logger.warn(`(ChatCtrl) [LIMM-Guard-V2] LIMM not applied, finalChunksForLLMContext is null, undefined, or not an array. Type: ${typeof finalChunksForLLMContext}`);
            }

            let propositionsSectionText = "";
            if (propositionResults && propositionResults.length > 0) {
                 propositionsSectionText = "Proposiciones Relevantes:
";
                 propositionResults.forEach((prop, index) => {
                    propositionsSectionText += `Proposición ${index + 1} (ID: ${prop.proposition_id}, ChunkID: ${prop.source_chunk_id}, Similitud: ${prop.similarity.toFixed(3)}):
${prop.proposition_text}
---
`;
                 });
            }

            let fullChunksSectionText = "";
            if (finalChunksForLLMContext.length > 0) { // Check against the potentially modified finalChunksForLLMContext
                fullChunksSectionText = "Fragmentos de Documentos Relevantes:
";
                finalChunksForLLMContext.forEach((chunk, index) => {
                    let chunkString = "";
                    chunkString += `--- Document Start (ID: ${chunk.id}, Score: ${(chunk.reranked_score ?? chunk.hybrid_score ?? 0).toFixed(3)}) ---
`;
                    chunkString += `Source: ${chunk.metadata?.source_name || 'N/A'}
`;

                    if (chunk.metadata?.hierarchy && Array.isArray(chunk.metadata.hierarchy) && chunk.metadata.hierarchy.length > 0) {
                        chunkString += `Section Path: ${chunk.metadata.hierarchy.map(h => h.text).join(' > ')}
`;
                    } else {
                        chunkString += "Section Path: N/A
";
                    }

                    if (chunk.metadata?.page_number) {
                        chunkString += `Page: ${chunk.metadata.page_number}
`;
                    } else {
                        chunkString += "Page: N/A
";
                    }

                    const content = chunk.extracted_content || chunk.content || "No content available";
                    chunkString += `Content: ${content}
`;
                    chunkString += `--- Document End (ID: ${chunk.id}) ---

`;
                    fullChunksSectionText += chunkString;

                    if (index === 0) {
                        logger.debug(`(ChatCtrl) [Context Formatting] Example of first formatted chunk string:
${chunkString}`);
                    }
                });
            }

            let ragContext = propositionsSectionText + fullChunksSectionText;
            if (!ragContext.trim() && !(propositionsSectionText.trim())) {
                 ragContext = "(No se encontró contexto relevante o procesado para esta pregunta)";
            } else if (!fullChunksSectionText.trim() && propositionsSectionText.trim()) {
                ragContext = propositionsSectionText + "
(No se encontraron fragmentos de documentos adicionales relevantes dentro del límite de contexto)";
            } else if (fullChunksSectionText.trim() && !propositionsSectionText.trim()) {
                ragContext = fullChunksSectionText;
            }

            let mutableConversationHistory = [...conversationHistory];
            let mutableRagContext = ragContext;
            let finalSystemPromptContent = `${systemPromptBase}

Historial de Conversación Previa:
${formattedHistoryForTokenCalc}

Contexto de la base de conocimiento:
${mutableRagContext}`;

            let finalSystemPromptTokens = encode(finalSystemPromptContent).length;
            logger.info(`(ChatCtrl) [Prompt Assembly] Final assembled system prompt tokens (before last-resort truncation): ${finalSystemPromptTokens}`);
            const maxSystemPromptTokens = MAX_CONTEXT_TOKENS_FOR_LLM * 0.8;

            if (finalSystemPromptTokens > maxSystemPromptTokens) {
                logger.warn(`(ChatCtrl) Truncating finalSystemPromptContent as it still exceeds ${maxSystemPromptTokens} tokens after context selection. Original: ${finalSystemPromptTokens}`);
                const excessTokens = finalSystemPromptTokens - maxSystemPromptTokens;
                const ragContextTokens = encode(mutableRagContext).length;
                if (ragContextTokens > excessTokens) {
                    const charsToKeep = Math.floor(mutableRagContext.length * ( (ragContextTokens - excessTokens) / ragContextTokens ) * 0.9);
                    mutableRagContext = mutableRagContext.substring(0, charsToKeep) + "... (contexto truncado)";
                    finalSystemPromptContent = `${systemPromptBase}

Historial de Conversación Previa:
${formattedHistoryForTokenCalc}

Contexto de la base de conocimiento:
${mutableRagContext}`;
                    finalSystemPromptTokens = encode(finalSystemPromptContent).length;
                    logger.warn(`(ChatCtrl) Truncated ragContext. New finalSystemPromptTokens: ${finalSystemPromptTokens}`);
                } else {
                    logger.warn(`(ChatCtrl) Cannot effectively truncate ragContext to fit. It's smaller than excess. Prompt might be too large due to history/base.`);
                }
            }

            const messagesForAPI = [{ role: "system", content: finalSystemPromptContent }, ...mutableConversationHistory, { role: "user", content: effectiveQuery }];
            let botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);

            const originalBotReplyText = botReplyText;
            let wasEscalated = false;
            if (originalBotReplyText && originalBotReplyText.trim() === BOT_CANNOT_ANSWER_MSG) {
                 db.updateAnalyticOnBotCannotAnswer(conversationId, effectiveQuery).catch(err => logger.error(`(ChatCtrl) Analytics: Failed to update bot_cannot_answer for CV:${conversationId}`, err));
                 await db.updateConversationStatusByAgent(conversationId, effectiveClientId, null, 'escalated_to_human');
                 botReplyText = BOT_ESCALATION_NOTIFICATION_MSG; wasEscalated = true;
                 db.updateAnalyticOnEscalation(conversationId, new Date(), effectiveQuery).catch(err => logger.error(`(ChatCtrl) Analytics: Failed to update escalation data for CV:${conversationId}`, err));
            }

            const queriesThatWereEmbeddedForLog = hybridSearchOutput?.queriesEmbeddedForLog || [];
            const searchParamsUsedForLog = hybridSearchOutput?.searchParams || {};
            const predictedCategoryValueForLog = hybridSearchOutput?.predictedCategory || null;

            const messagesForAPI_for_log = typeof messagesForAPI !== 'undefined' ? messagesForAPI : [{role:"system", content:"Error: messagesForAPI not constructed"}, {role:"user", content: effectiveQuery || ""}];
            const botReplyText_for_log = typeof botReplyText !== 'undefined' ? botReplyText : "Error: Reply not generated";

            logger.debug('(ChatCtrl) Pre-map Debugging:');
            logger.debug(`(ChatCtrl) typeof hybridSearchOutput: ${typeof hybridSearchOutput}`);
            if (hybridSearchOutput && typeof hybridSearchOutput === 'object') {
                logger.debug(`(ChatCtrl) hybridSearchOutput.results exists: ${hybridSearchOutput.hasOwnProperty('results')}, isArray: ${Array.isArray(hybridSearchOutput.results)}`);
                if (hybridSearchOutput.hasOwnProperty('results')) {
                    logger.debug(`(ChatCtrl) hybridSearchOutput.results (first few): ${JSON.stringify(hybridSearchOutput.results?.slice(0,2))}`);
                }
                logger.debug(`(ChatCtrl) hybridSearchOutput.pipelineDetails exists: ${hybridSearchOutput.hasOwnProperty('pipelineDetails')}`);
                if (hybridSearchOutput.pipelineDetails && typeof hybridSearchOutput.pipelineDetails === 'object') {
                    logger.debug(`(ChatCtrl) hybridSearchOutput.pipelineDetails.finalRankedResultsForPlayground exists: ${hybridSearchOutput.pipelineDetails.hasOwnProperty('finalRankedResultsForPlayground')}, isArray: ${Array.isArray(hybridSearchOutput.pipelineDetails.finalRankedResultsForPlayground)}`);
                    if (hybridSearchOutput.pipelineDetails.hasOwnProperty('finalRankedResultsForPlayground')) {
                         logger.debug(`(ChatCtrl) hybridSearchOutput.pipelineDetails.finalRankedResultsForPlayground (first few): ${JSON.stringify(hybridSearchOutput.pipelineDetails.finalRankedResultsForPlayground?.slice(0,2))}`);
                    }
                } else {
                    logger.debug("(ChatCtrl) hybridSearchOutput.pipelineDetails is null or not an object.");
                }
            } else {
                logger.debug("(ChatCtrl) hybridSearchOutput is null, undefined, or not an object.");
            }

            logger.debug(`(ChatCtrl) resultsToMap (derived from hybridSearchOutput.results): isArray: ${Array.isArray(resultsToMap)}, length: ${resultsToMap?.length}`);
            logger.debug(`(ChatCtrl) resultsToMap (first few): ${JSON.stringify(resultsToMap?.slice(0,2))}`);

            logger.debug(`(ChatCtrl) rawRankedResultsForLog (derived): isArray: ${Array.isArray(rawRankedResultsForLog)}, length: ${rawRankedResultsForLog?.length}`);
            logger.debug(`(ChatCtrl) rawRankedResultsForLog (first few): ${JSON.stringify(rawRankedResultsForLog?.slice(0,2))}`);

            const retrievedContextForLog = (Array.isArray(rawRankedResultsForLog) ? rawRankedResultsForLog : []).map(c => ({
                id: c.id,
                content_preview: (typeof c.content === 'string' ? c.content.substring(0,150) : "") + "...",
                score: c.reranked_score ?? c.hybrid_score ?? 0,
                metadata: c.metadata
            }));

            const logData = {
                clientId: effectiveClientId,
                conversationId,
                userQuery: effectiveQuery || "",
                retrievedContext: retrievedContextForLog,
                finalPromptToLlm: JSON.stringify(messagesForAPI_for_log),
                llmResponse: botReplyText_for_log,
                queryEmbeddingsUsed: queriesThatWereEmbeddedForLog,
                vectorSearchParams: searchParamsUsedForLog,
                wasEscalated: wasEscalated,
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

            if (botReplyText) {
                await db.saveMessage(conversationId, 'user', userMessageInput);
                db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => logger.error("(ChatCtrl) Analytics err:", err));
                await db.saveMessage(conversationId, 'bot', botReplyText, ragLogId);
                db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => logger.error("(ChatCtrl) Analytics err:", err));

                if (!(clarification_response_details && clarification_response_details.original_query)) {
                    db.setCache(cacheKey, botReplyText);
                }
                res.status(200).json({ reply: botReplyText });
            } else {
                res.status(503).json({ reply: 'Lo siento, estoy teniendo problemas para procesar tu solicitud en este momento.' });
            }
        }
    } catch (error) {
        logger.error(`(ChatCtrl) Error general en handleChatMessage para ${conversationId}:`, error);
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

        const convDetails = await supabase.from('conversations').select('created_at').eq('conversation_id', newConversationId).single();
        if (convDetails.data) {
            db.createConversationAnalyticEntry(newConversationId, effectiveClientId, convDetails.data.created_at)
             .catch(err => logger.error(`(ChatCtrl) Analytics: Failed to create entry for CV:${newConversationId}`, err));
        } else {
             logger.error(`(ChatCtrl) Analytics: Could not fetch created_at for new CV:${newConversationId}`);
        }

        res.status(201).json({ conversationId: newConversationId });
    } catch (error) {
        logger.error(`(ChatCtrl) Error en startConversation para cliente ${effectiveClientId}:`, error);
        next(error);
    }
};
export default { handleChatMessage, startConversation };
