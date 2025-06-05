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
        // This specific console.warn might be redundant given the logic above, but kept for safety.
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
    // Specific handling for 'request_human_escalation' is done later based on intent value

    // Validate conversationId format
    if (!UUID_REGEX.test(conversationId)) {
        return res.status(400).json({ error: 'conversationId has an invalid format.' });
    }

    // Validate clientId format
    if (!UUID_REGEX.test(effectiveClientId)) { // Changed clientId to effectiveClientId
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
    // Ensure that userMessageInput is not null if intent is not 'request_human_escalation' and no clarification_response_details
    if (!clarification_response_details && !(intent && intent === 'request_human_escalation') && !userMessageInput) {
        return res.status(400).json({ error: 'Message input is required when not providing clarification details or requesting escalation.' });
    }


    if (intent && intent === 'request_human_escalation') { // Use validated intent variable
        logger.log(`(ChatCtrl) User initiated escalation for CV:${conversationId}, C:${effectiveClientId}`); // Changed clientId to effectiveClientId
        try {
            // Even if userMessageInput is empty, we log a generic escalation message.
            const escalationMessage = userMessageInput ? `El usuario ha solicitado hablar con un agente humano. Mensaje: "${userMessageInput}"` : 'El usuario ha solicitado hablar con un agente humano.';
            await db.saveMessage(conversationId, 'user', escalationMessage);
            db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => logger.error(`(ChatCtrl) Analytics: Failed to increment user message count for CV:${conversationId}`, err));
            await db.updateConversationStatusByAgent(conversationId, effectiveClientId, null, 'escalated_to_human'); // Changed clientId to effectiveClientId
            db.updateAnalyticOnEscalation(conversationId, new Date(), `User explicitly requested human escalation. Associated message: "${userMessageInput || ''}"`)
                .catch(err => logger.error(`(ChatCtrl) Analytics: Failed to update escalation data for CV:${conversationId}`, err));
            return res.status(200).json({ status: "escalation_requested", reply: "Tu solicitud para hablar con un agente ha sido recibida. Alguien se pondrá en contacto contigo pronto." });
        } catch (escalationError) {
        logger.error(`(ChatCtrl) Error during user-initiated escalation for CV:${conversationId}:`, escalationError);
            return res.status(500).json({ error: "No se pudo procesar tu solicitud de escalación en este momento." });
        }
    }
    // If we reach here and userMessageInput is still null/empty (e.g. intent was something else but message was empty), it's an error.
    // This case should ideally be caught by the initial check:
    // `if (!userMessageInput && !clarification_response_details && !(intent && intent === 'request_human_escalation'))`
    // However, as a safeguard:
    if (!userMessageInput && !clarification_response_details) {
        // This implies intent was present but not 'request_human_escalation', and message was empty.
        // This situation should be clarified based on product requirements if other intents can have empty messages.
        // For now, assuming any other intent path requires a message if no clarification is given.
        logger.warn(`(ChatCtrl) handleChatMessage: Potentially unhandled case - intent provided ('${intent}') without a message for CV ${conversationId}.`);
        return res.status(400).json({ error: 'Message input is required for the provided intent.' });
    }


    logger.info(`(ChatCtrl) Mensaje (effectiveQuery) recibido C:${effectiveClientId}, CV:${conversationId}: "${effectiveQuery.substring(0, 100)}..."`); // Changed clientId to effectiveClientId

    try {
        const cacheKey = `${effectiveClientId}:${conversationId}:${effectiveQuery}`; // Cache based on effective query, Changed clientId to effectiveClientId
        const cachedReply = db.getCache(cacheKey);
        if (cachedReply) {
            // Save user's actual typed message, not the effectiveQuery if it was combined
            db.saveMessage(conversationId, 'user', userMessageInput).then(() => db.incrementAnalyticMessageCount(conversationId, 'user')).catch(err => logger.error("(ChatCtrl) Analytics save user msg err (cache):", err));
            db.saveMessage(conversationId, 'bot', cachedReply).then(() => db.incrementAnalyticMessageCount(conversationId, 'bot')).catch(err => logger.error("(ChatCtrl) Analytics save bot msg err (cache):", err));
            return res.status(200).json({ reply: cachedReply });
        }
        logger.debug("(ChatCtrl) No encontrado en caché. Procesando...");

        const conversationHistory = await db.getConversationHistory(conversationId);
        // Use effectiveQuery for the search
        const hybridSearchOutput = await db.hybridSearch(
            effectiveClientId,
            effectiveQuery,
            conversationId,
            {},   // options
            true  // returnPipelineDetails - assuming this is for detailed logging/debugging
        );

        // Safely access results, defaulting to an empty array if not present or not an array
        const resultsToMap = (hybridSearchOutput && Array.isArray(hybridSearchOutput.results))
            ? hybridSearchOutput.results
            : [];

        // Safely access propositionResults, defaulting to an empty array
        const propositionResults = (hybridSearchOutput && Array.isArray(hybridSearchOutput.propositionResults))
            ? hybridSearchOutput.propositionResults
            : [];

        // Derive rawRankedResultsForLog safely, using resultsToMap as a final fallback
        const rawRankedResultsForLog = (hybridSearchOutput && hybridSearchOutput.pipelineDetails && Array.isArray(hybridSearchOutput.pipelineDetails.finalRankedResultsForPlayground))
            ? hybridSearchOutput.pipelineDetails.finalRankedResultsForPlayground
            : resultsToMap;

        let initialRelevantKnowledge = resultsToMap; // Use resultsToMap (which is safely derived hybridSearchOutput.results)

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

                    logger.debug(`(ChatCtrl) Calling LLM for ambiguity detection for CV:${conversationId}`);
                    const ambiguityResponseString = await getChatCompletion(ambiguityMessages, AMBIGUITY_LLM_MODEL, AMBIGUITY_LLM_TEMP, AMBIGUITY_LLM_MAX_TOKENS_OUTPUT); // Assuming openaiService.getChatCompletion was a typo and it's the imported getChatCompletion

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
            // Save user's actual ambiguous message that LED to this clarification
            await db.saveMessage(conversationId, 'user', userMessageInput);
            db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => logger.error("(ChatCtrl) Analytics err (ambig):", err));
            // Save bot's clarification question
            await db.saveMessage(conversationId, 'bot', clarificationQuestion);
            db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => logger.error("(ChatCtrl) Analytics err (ambig):", err));

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
                        const relevanceResponse = await getChatCompletion(relevanceMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_RELEVANCE, 10);  // Assuming openaiService.getChatCompletion was a typo
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
                        const summaryResponse = await getChatCompletion(summaryMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_SUMMARY, summaryMaxTokens); // Assuming openaiService.getChatCompletion was a typo
                        if (summaryResponse && summaryResponse.trim().length > 0) { processedKnowledgeForContext.push({ ...chunk, extracted_content: summaryResponse.trim() }); }
                        else { processedKnowledgeForContext.push(chunk); }
                    } catch (summaryError) { processedKnowledgeForContext.push(chunk); }
                }
            } else { processedKnowledgeForContext = [...filteredKnowledge]; }

            // --- Score-based Prioritization and Token-limited Truncation of Context Chunks ---
            const LLM_TOKEN_SAFETY_MARGIN = 200; // Safety margin for LLM response and other formatting.
            const TOKENS_PER_CHUNK_OVERHEAD = 65; // Updated estimate for detailed chunk formatting (markers, ID, score, source, path, page)

            // Sort chunks by score (descending)
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

            // Calculate base token count (system prompt, history, query, and other fixed elements)
            // This is an approximation; actual prompt construction might vary slightly.
            const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado... (full prompt as defined before, including ambiguity handling instructions if desired)`; // Re-evaluate this if it's already defined elsewhere or make it a shared constant
            const formattedHistoryForTokenCalc = conversationHistory.map(msg => `${msg.sender === 'user' ? 'User' : 'Assistant'}: ${msg.content || ''}`).join('\n');

            let basePromptTokens = encode(systemPromptBase).length;
            basePromptTokens += encode(formattedHistoryForTokenCalc).length;
            basePromptTokens += encode(effectiveQuery).length;
            basePromptTokens += encode("Contexto de la base de conocimiento:").length; // Example fixed part
            basePromptTokens += encode("Proposiciones Relevantes:").length; // Example fixed part
            basePromptTokens += encode("Fragmentos de Documentos Relevantes:").length; // Example fixed part
            // Add tokens for any other structural separators or instructions that are always present.

            logger.info(`(ChatCtrl) [Context Selection] Base prompt tokens (system, history, query, fixed instructions): ${basePromptTokens}`);

            const finalChunksForLLMContext = [];
            let currentAccumulatedTokens = basePromptTokens;
            const effectiveMaxContextTokens = MAX_CONTEXT_TOKENS_FOR_LLM - LLM_TOKEN_SAFETY_MARGIN;

            for (const chunk of sortedChunksForContextSelection) {
                const contentToTokenize = chunk.extracted_content || chunk.content;
                if (!contentToTokenize) continue; // Skip if no content

                const chunkTokens = encode(contentToTokenize).length;
                const chunkWithOverheadTokens = chunkTokens + TOKENS_PER_CHUNK_OVERHEAD;

                if (currentAccumulatedTokens + chunkWithOverheadTokens <= effectiveMaxContextTokens) {
                    finalChunksForLLMContext.push(chunk);
                    currentAccumulatedTokens += chunkWithOverheadTokens;
                } else {
                    logger.info(`(ChatCtrl) [Context Selection] Token limit reached. Cannot add chunk ID ${chunk.id} (tokens: ${chunkTokens}).`);
                    break; // Stop adding chunks
                }
            }

            logger.info(`(ChatCtrl) [Context Selection] Chunks selected for LLM context: ${finalChunksForLLMContext.length}`);
            logger.info(`(ChatCtrl) [Context Selection] Accumulated tokens after chunk selection: ${currentAccumulatedTokens}`);
            logger.info(`(ChatCtrl) [Context Selection] Effective token limit for context: ${effectiveMaxContextTokens}`);

            // ---- INICIO DE LOGGING ADICIONAL ----
            logger.debug(`(ChatCtrl) [Pre-LIMM] typeof finalChunksForLLMContext: ${typeof finalChunksForLLMContext}`);
            logger.debug(`(ChatCtrl) [Pre-LIMM] Array.isArray(finalChunksForLLMContext): ${Array.isArray(finalChunksForLLMContext)}`);
            if (finalChunksForLLMContext) {
                logger.debug(`(ChatCtrl) [Pre-LIMM] finalChunksForLLMContext.length: ${finalChunksForLLMContext.length}`);
                try {
                    // Intentar loguear una porción del contenido para inspección, si no está vacío.
                    if (finalChunksForLLMContext.length > 0) {
                        logger.debug(`(ChatCtrl) [Pre-LIMM] finalChunksForLLMContext first 2 items (sample): ${JSON.stringify(finalChunksForLLMContext.slice(0,2))}`);
                    } else {
                        logger.debug(`(ChatCtrl) [Pre-LIMM] finalChunksForLLMContext is an empty array.`);
                    }
                } catch (e) {
                    logger.error(`(ChatCtrl) [Pre-LIMM] Error stringifying finalChunksForLLMContext: ${e.message}`);
                    logger.debug(`(ChatCtrl) [Pre-LIMM] finalChunksForLLMContext (raw, could not stringify):`, finalChunksForLLMContext);
                }
            } else {
                logger.warn(`(ChatCtrl) [Pre-LIMM] finalChunksForLLMContext is null or undefined just before LIMM block.`);
            }
            // ---- FIN DE LOGGING ADICIONAL ----

            // "Lost in the Middle" Mitigation: Reorder chunks - best first, second-best last.
            if (finalChunksForLLMContext && finalChunksForLLMContext.length > 1) { // Chequeo explícito
                logger.info(`(ChatCtrl) [Context Reorder] Chunk IDs before LIMM reorder: ${finalChunksForLLMContext.map(c => c.id).join(', ')}`);
                const secondBestChunk = finalChunksForLLMContext.splice(1, 1)[0];
                finalChunksForLLMContext.push(secondBestChunk);
                logger.info(`(ChatCtrl) [Context Reorder] Applied "Lost in the Middle" strategy.`);
                logger.info(`(ChatCtrl) [Context Reorder] Chunk IDs after LIMM reorder: ${finalChunksForLLMContext.map(c => c.id).join(', ')}`);
            } else if (Array.isArray(finalChunksForLLMContext)) { // Es un array pero no .length > 1
                 logger.info(`(ChatCtrl) [Context Reorder] LIMM not applied, finalChunksForLLMContext length is ${finalChunksForLLMContext.length}`);
            } else { // Es null o undefined o no es un array
                 logger.warn(`(ChatCtrl) [Context Reorder] LIMM not applied, finalChunksForLLMContext is null, undefined, or not an array.`);
            }

            // Now, construct propositionsSectionText and fullChunksSectionText using finalChunksForLLMContext
            // This part needs to be adapted from the original logic to use finalChunksForLLMContext
            // instead of propositionResults directly for propositions (if they were part of processedKnowledgeForContext)
            // or processedKnowledgeForContext for chunks.
            // For now, we assume propositionResults are handled separately and only `fullChunksSectionText` is built from `finalChunksForLLMContext`.
            // The prompt implies `processedKnowledgeForContext` was the source for `fullChunksSectionText`.

            let propositionsSectionText = ""; // This might need separate handling if propositions are not part of the sortable chunks
            if (propositionResults && propositionResults.length > 0) {
                 propositionsSectionText = "Proposiciones Relevantes:\n";
                 propositionResults.forEach((prop, index) => {
                    propositionsSectionText += `Proposición ${index + 1} (ID: ${prop.proposition_id}, ChunkID: ${prop.source_chunk_id}, Similitud: ${prop.similarity.toFixed(3)}):\n${prop.proposition_text}\n---\n`;
                 });
            }

            let fullChunksSectionText = "";
            if (finalChunksForLLMContext.length > 0) {
                fullChunksSectionText = "Fragmentos de Documentos Relevantes:\n";
                finalChunksForLLMContext.forEach((chunk, index) => {
                    let chunkString = "";
                    chunkString += `--- Document Start (ID: ${chunk.id}, Score: ${(chunk.reranked_score ?? chunk.hybrid_score ?? 0).toFixed(3)}) ---\n`;
                    chunkString += `Source: ${chunk.metadata?.source_name || 'N/A'}\n`;

                    if (chunk.metadata?.hierarchy && Array.isArray(chunk.metadata.hierarchy) && chunk.metadata.hierarchy.length > 0) {
                        chunkString += `Section Path: ${chunk.metadata.hierarchy.map(h => h.text).join(' > ')}\n`;
                    } else {
                        chunkString += "Section Path: N/A\n";
                    }

                    if (chunk.metadata?.page_number) {
                        chunkString += `Page: ${chunk.metadata.page_number}\n`;
                    } else {
                        chunkString += "Page: N/A\n";
                    }

                    const content = chunk.extracted_content || chunk.content || "No content available";
                    chunkString += `Content: ${content}\n`;
                    chunkString += `--- Document End (ID: ${chunk.id}) ---\n\n`;
                    fullChunksSectionText += chunkString;

                    if (index === 0) { // Log only the first formatted chunk for debugging
                        logger.debug(`(ChatCtrl) [Context Formatting] Example of first formatted chunk string:\n${chunkString}`);
                    }
                });
            }

            let ragContext = propositionsSectionText + fullChunksSectionText;
            if (!ragContext.trim() && !(propositionsSectionText.trim())) { // Check if both are empty or just whitespace
                 ragContext = "(No se encontró contexto relevante o procesado para esta pregunta)";
            } else if (!fullChunksSectionText.trim() && propositionsSectionText.trim()) {
                ragContext = propositionsSectionText + "\n(No se encontraron fragmentos de documentos adicionales relevantes dentro del límite de contexto)";
            } else if (fullChunksSectionText.trim() && !propositionsSectionText.trim()) {
                ragContext = fullChunksSectionText; // Only chunks, no specific message needed
            }


            let mutableConversationHistory = [...conversationHistory];
            let mutableRagContext = ragContext;
            // const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado...`; // Already defined above for token calculation
            let finalSystemPromptContent = `${systemPromptBase}\n\nHistorial de Conversación Previa:\n${formattedHistoryForTokenCalc}\n\nContexto de la base de conocimiento:\n${mutableRagContext}`;

            // Simplified token counting and truncation logic (the detailed selection is done above)
            // The primary goal now is to ensure the assembled prompt respects the absolute model limits,
            // though the context selection should have already managed this for the RAG part.
            let finalSystemPromptTokens = encode(finalSystemPromptContent).length;
            logger.info(`(ChatCtrl) [Prompt Assembly] Final assembled system prompt tokens (before last-resort truncation): ${finalSystemPromptTokens}`);
            const maxSystemPromptTokens = MAX_CONTEXT_TOKENS_FOR_LLM * 0.8; // Example: 80% of total for system prompt with context

            if (finalSystemPromptTokens > maxSystemPromptTokens) {
                logger.warn(`(ChatCtrl) Truncating finalSystemPromptContent as it still exceeds ${maxSystemPromptTokens} tokens after context selection. Original: ${finalSystemPromptTokens}`);
                // This truncation should ideally not be hit often if context selection is effective
                const excessTokens = finalSystemPromptTokens - maxSystemPromptTokens;
                // Simple truncation of ragContext part for now. More sophisticated truncation might be needed.
                const ragContextTokens = encode(mutableRagContext).length;
                if (ragContextTokens > excessTokens) {
                    const charsToKeep = Math.floor(mutableRagContext.length * ( (ragContextTokens - excessTokens) / ragContextTokens ) * 0.9); // 0.9 for safety
                    mutableRagContext = mutableRagContext.substring(0, charsToKeep) + "... (contexto truncado)";
                    finalSystemPromptContent = `${systemPromptBase}\n\nHistorial de Conversación Previa:\n${formattedHistoryForTokenCalc}\n\nContexto de la base de conocimiento:\n${mutableRagContext}`;
                    finalSystemPromptTokens = encode(finalSystemPromptContent).length;
                    logger.warn(`(ChatCtrl) Truncated ragContext. New finalSystemPromptTokens: ${finalSystemPromptTokens}`);
                } else {
                    logger.warn(`(ChatCtrl) Cannot effectively truncate ragContext to fit. It's smaller than excess. Prompt might be too large due to history/base.`);
                    // Consider truncating history if this happens
                }
            }


            const messagesForAPI = [{ role: "system", content: finalSystemPromptContent }, ...mutableConversationHistory, { role: "user", content: effectiveQuery }]; // Use effectiveQuery for final LLM call
            let botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);

            const originalBotReplyText = botReplyText;
            let wasEscalated = false;
            if (originalBotReplyText && originalBotReplyText.trim() === BOT_CANNOT_ANSWER_MSG) { /* ... escalation logic as before, using effectiveQuery in analytics ... */
                 db.updateAnalyticOnBotCannotAnswer(conversationId, effectiveQuery).catch(err => logger.error(`(ChatCtrl) Analytics: Failed to update bot_cannot_answer for CV:${conversationId}`, err));
                 await db.updateConversationStatusByAgent(conversationId, effectiveClientId, null, 'escalated_to_human'); // Changed clientId to effectiveClientId
                 botReplyText = BOT_ESCALATION_NOTIFICATION_MSG; wasEscalated = true;
                 db.updateAnalyticOnEscalation(conversationId, new Date(), effectiveQuery).catch(err => logger.error(`(ChatCtrl) Analytics: Failed to update escalation data for CV:${conversationId}`, err));
            }

            // Ensure these variables used for logData are defined with fallbacks
            const queriesThatWereEmbeddedForLog = hybridSearchOutput?.queriesEmbeddedForLog || [];
            const searchParamsUsedForLog = hybridSearchOutput?.searchParams || {};
            const predictedCategoryValueForLog = hybridSearchOutput?.predictedCategory || null;

            // botReplyText and messagesForAPI are defined within this try block before this point
            // wasEscalated is also defined within this try block
            const messagesForAPI_for_log = typeof messagesForAPI !== 'undefined' ? messagesForAPI : [{role:"system", content:"Error: messagesForAPI not constructed"}, {role:"user", content: effectiveQuery || ""}];
            const botReplyText_for_log = typeof botReplyText !== 'undefined' ? botReplyText : "Error: Reply not generated";

            // ---- START DEBUG LOGGING ----
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
            // ---- END DEBUG LOGGING ----

            const retrievedContextForLog = (Array.isArray(rawRankedResultsForLog) ? rawRankedResultsForLog : []).map(c => ({
                id: c.id,
                content_preview: (typeof c.content === 'string' ? c.content.substring(0,150) : "") + "...", // Safe substring
                score: c.reranked_score ?? c.hybrid_score ?? 0,
                metadata: c.metadata
            }));

            const logData = {
                clientId: effectiveClientId,
                conversationId,
                userQuery: effectiveQuery || "",
                retrievedContext: retrievedContextForLog, // Already an array
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
                // Save the user's actual typed message, and bot's reply
                await db.saveMessage(conversationId, 'user', userMessageInput); // User message does not get ragLogId
                db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => logger.error("(ChatCtrl) Analytics err:", err));
                await db.saveMessage(conversationId, 'bot', botReplyText, ragLogId); // Pass ragLogId here for bot message
                db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => logger.error("(ChatCtrl) Analytics err:", err));

                if (!(clarification_response_details && clarification_response_details.original_query)) { // Don't cache if it was a clarification cycle that led to this answer
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
    // const { clientId } = req.body; // Removed from here

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

    if (!effectiveClientId) { // Should be caught by the logic above, but as a safeguard
        logger.warn('(ChatCtrl) Petición inválida a /start. Falta effectiveClientId.');
        return res.status(400).json({ error: 'Falta clientId.' });
    }

    // Validate effectiveClientId format
    if (!UUID_REGEX.test(effectiveClientId)) {
        return res.status(400).json({ error: 'clientId has an invalid format.' });
    }
    try {
        logger.info(`(ChatCtrl) startConversation: effectiveClientId recibido/derivado es: '${effectiveClientId}'`);
        const clientExists = await db.getClientConfig(effectiveClientId); // Changed clientId to effectiveClientId
        if (!clientExists) {
            logger.warn(`(ChatCtrl) Intento de iniciar conversación para cliente inexistente: ${effectiveClientId}`);
            return res.status(404).json({ error: 'Cliente inválido o no encontrado.' });
        }
        const newConversationId = await db.createConversation(effectiveClientId); // Changed clientId to effectiveClientId
        if (!newConversationId) {
            throw new Error("Failed to create conversation or retrieve its ID.");
        }
        logger.info(`(ChatCtrl) Conversación iniciada/creada: ${newConversationId} para cliente ${effectiveClientId}`);

        // Fetch the full conversation object to get created_at for analytics
        const convDetails = await supabase.from('conversations').select('created_at').eq('conversation_id', newConversationId).single();
        if (convDetails.data) {
            db.createConversationAnalyticEntry(newConversationId, effectiveClientId, convDetails.data.created_at) // Changed clientId to effectiveClientId
             .catch(err => logger.error(`(ChatCtrl) Analytics: Failed to create entry for CV:${newConversationId}`, err));
        } else {
             logger.error(`(ChatCtrl) Analytics: Could not fetch created_at for new CV:${newConversationId}`);
        }

        res.status(201).json({ conversationId: newConversationId });
    } catch (error) {
        logger.error(`(ChatCtrl) Error en startConversation para cliente ${effectiveClientId}:`, error); // Changed clientId to effectiveClientId
        next(error);
    }
};
export default { handleChatMessage, startConversation };

// Ensure all other existing functions (getClientConfig etc.) are maintained below if they were part of the original file.
// For this operation, only handleChatMessage and startConversation were shown in the prompt for context.
// The overwrite will replace the entire file, so all exports must be present.
// (The full file content from previous steps should be used as a base for the overwrite)
