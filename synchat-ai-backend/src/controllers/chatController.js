// src/controllers/chatController.js
import { getChatCompletion } from '../services/openaiService.js';
import * as db from '../services/databaseService.js';
import { encode } from 'gpt-tokenizer';
import { supabase } from '../services/supabaseClient.js'; // Added for direct Supabase access

// Modelo de IA a usar y Temperatura
const CHAT_MODEL = "gpt-3.5-turbo";
const MAX_CONTEXT_TOKENS_FOR_LLM = 3000; // Max tokens for context, leaving room for response
const CHAT_TEMPERATURE = 0.3; // Más baja para reducir alucinaciones

// Configuration for LLM-based Context Filtering & Summarization
const LLM_FILTER_TOP_N_CHUNKS = 5; // Number of top chunks to process with LLM filtering/summarization
const LLM_FILTER_MODEL = "gpt-3.5-turbo"; // Model for filtering/summarization calls
const LLM_FILTER_TEMP_RELEVANCE = 0.2; // Temperature for YES/NO relevance check
const LLM_FILTER_TEMP_SUMMARY = 0.3; // Temperature for summary extraction
const ENABLE_LLM_CONTEXT_FILTERING = true; // Feature flag for filtering
const ENABLE_LLM_CONTEXT_SUMMARIZATION = true; // Feature flag for summarization

const BOT_CANNOT_ANSWER_MSG = "Lo siento, no tengo información específica sobre eso en la base de datos de SynChat AI.";
const BOT_ESCALATION_NOTIFICATION_MSG = "Un momento, por favor. Voy a transferirte con un agente humano para que pueda ayudarte con tu consulta.";

/**
 * Maneja la recepción de un nuevo mensaje de chat.
 */
export const handleChatMessage = async (req, res, next) => {
    const { message, conversationId, clientId } = req.body;

    if (!message || !conversationId || !clientId) {
        console.warn('Petición inválida a /message:', req.body);
        return res.status(400).json({ error: 'Faltan datos requeridos (message, conversationId, clientId).' });
    }

    // Check for user-initiated escalation first
    if (req.body.intent && req.body.intent === 'request_human_escalation') {
        console.log(`(Controller) User initiated escalation for CV:${conversationId}, C:${clientId}`);
        try {
            // Save a message indicating user requested escalation
            await db.saveMessage(conversationId, 'user', 'El usuario ha solicitado hablar con un agente humano.');
            // Increment user message count for analytics
            db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => console.error(`Analytics: Failed to increment user message count for CV:${conversationId}`, err));

            // Update conversation status
            await db.updateConversationStatusByAgent(conversationId, clientId, null, 'escalated_to_human');
            console.log(`(Controller) Conversation CV:${conversationId} status updated to escalated_to_human due to user request.`);

            // Update analytics for escalation
            db.updateAnalyticOnEscalation(conversationId, new Date(), `User explicitly requested human escalation. Associated message: "${message}"`)
                .catch(err => console.error(`Analytics: Failed to update escalation data for CV:${conversationId}`, err));

            // Send a specific response to the widget
            return res.status(200).json({
                status: "escalation_requested",
                reply: "Tu solicitud para hablar con un agente ha sido recibida. Alguien se pondrá en contacto contigo pronto."
            });
        } catch (escalationError) {
            console.error(`(Controller) Error during user-initiated escalation for CV:${conversationId}:`, escalationError);
            return res.status(500).json({ error: "No se pudo procesar tu solicitud de escalación en este momento." });
        }
    }

    console.log(`(Controller) Mensaje recibido C:${clientId}, CV:${conversationId}: "${message.substring(0, 100)}..."`);

    try {
        // --- Cache ---
        const cacheKey = `${clientId}:${conversationId}:${message}`;
        const cachedReply = db.getCache(cacheKey);
        if (cachedReply) {
            Promise.all([
                 db.saveMessage(conversationId, 'user', message)
                    .then(() => db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => console.error(`Analytics: Failed to increment user message count (cache) for CV:${conversationId}`, err))),
                 db.saveMessage(conversationId, 'bot', cachedReply)
                    .then(() => db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => console.error(`Analytics: Failed to increment bot message count (cache) for CV:${conversationId}`, err)))
            ]).catch(err => console.error("Error guardando mensajes (cache hit):", err));
             return res.status(200).json({ reply: cachedReply });
        }

        console.log("(Controller) No encontrado en caché. Procesando...");

        const conversationHistory = await db.getConversationHistory(conversationId);

        // Call hybridSearch and expect the new return structure
        const hybridSearchResult = await db.hybridSearch(clientId, message, conversationId, {});
        let initialRelevantKnowledge = hybridSearchResult.results; // These are the top N chunk results
        const propositionResults = hybridSearchResult.propositionResults || []; // Propositions
        const searchParamsUsed = hybridSearchResult.searchParams;
        const queriesThatWereEmbedded = hybridSearchResult.queriesEmbedded;
        const rawRankedResultsForLog = hybridSearchResult.rawRankedResultsForLog;

        // --- LLM-based Context Filtering ---
        let knowledgeForProcessing = initialRelevantKnowledge.slice(0, LLM_FILTER_TOP_N_CHUNKS);
        let filteredKnowledge = [];

        if (ENABLE_LLM_CONTEXT_FILTERING && knowledgeForProcessing.length > 0) {
            console.log(`(Controller) Starting LLM-based context filtering for top ${knowledgeForProcessing.length} chunks. CV:${conversationId}`);
            for (const chunk of knowledgeForProcessing) {
                try {
                    const relevancePrompt = `User Question: '${message}'. Is the following 'Text Snippet' directly relevant and useful for answering the user's question? Respond with only 'YES' or 'NO'. Text Snippet: '${chunk.content}'`;
                    const relevanceMessages = [
                        { role: "system", content: "You are an AI assistant that judges relevance. Respond with only YES or NO." },
                        { role: "user", content: relevancePrompt }
                    ];
                    const relevanceResponse = await getChatCompletion(relevanceMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_RELEVANCE, 10); // max_tokens: 10 for YES/NO

                    if (relevanceResponse && relevanceResponse.trim().toLowerCase().startsWith('yes')) {
                        filteredKnowledge.push(chunk);
                        console.log(`(Controller) Chunk ID ${chunk.id} deemed RELEVANT by LLM. CV:${conversationId}`);
                    } else {
                        console.log(`(Controller) Chunk ID ${chunk.id} deemed NOT RELEVANT by LLM (Response: ${relevanceResponse}). CV:${conversationId}`);
                    }
                } catch (filterError) {
                    console.error(`(Controller) Error during LLM relevance check for chunk ID ${chunk.id}: ${filterError.message}. Keeping chunk. CV:${conversationId}`);
                    filteredKnowledge.push(chunk); // Keep chunk if filtering fails
                }
            }
            // If filtering resulted in an empty list, fall back to original top N (or fewer if less than N initially)
            if (filteredKnowledge.length === 0 && knowledgeForProcessing.length > 0) {
                console.warn(`(Controller) LLM filtering removed all chunks. Falling back to original top ${knowledgeForProcessing.length} chunks. CV:${conversationId}`);
                filteredKnowledge = [...knowledgeForProcessing];
            }
             console.log(`(Controller) LLM filtering complete. ${filteredKnowledge.length} chunks remaining. CV:${conversationId}`);
        } else {
            filteredKnowledge = [...knowledgeForProcessing]; // Use top N if filtering is disabled or no chunks
            if (!ENABLE_LLM_CONTEXT_FILTERING) console.log("(Controller) LLM context filtering is disabled.");
        }

        // --- LLM-based Context Summarization/Extraction ---
        let processedKnowledgeForContext = [];
        if (ENABLE_LLM_CONTEXT_SUMMARIZATION && filteredKnowledge.length > 0) {
            console.log(`(Controller) Starting LLM-based context summarization for ${filteredKnowledge.length} chunks. CV:${conversationId}`);
            for (const chunk of filteredKnowledge) {
                try {
                    const summaryPrompt = `User Question: '${message}'. From the 'Text Snippet' below, extract only the sentence(s) or key phrases that directly help answer the question. If no part is relevant, or if the snippet is already very concise and relevant, return the original snippet. If absolutely no part is relevant, return an empty string. Text Snippet: '${chunk.content}'`;
                    const summaryMessages = [
                        { role: "system", content: "You are an AI assistant that extracts key relevant sentences from text based on a user question." },
                        { role: "user", content: summaryPrompt }
                    ];
                    // Estimate max_tokens for summary: not more than original chunk, capped at e.g. 250-300
                    const summaryMaxTokens = Math.min(encode(chunk.content).length + 50, 300);
                    const summaryResponse = await getChatCompletion(summaryMessages, LLM_FILTER_MODEL, LLM_FILTER_TEMP_SUMMARY, summaryMaxTokens);

                    if (summaryResponse && summaryResponse.trim().length > 0) {
                        processedKnowledgeForContext.push({ ...chunk, extracted_content: summaryResponse.trim() });
                        console.log(`(Controller) Chunk ID ${chunk.id} summarized/extracted by LLM. CV:${conversationId}`);
                    } else {
                        // If LLM returns empty or summary fails, use original content
                        processedKnowledgeForContext.push(chunk);
                        console.log(`(Controller) Summarization for chunk ID ${chunk.id} resulted in empty or failed, using original. CV:${conversationId}`);
                    }
                } catch (summaryError) {
                    console.error(`(Controller) Error during LLM summarization for chunk ID ${chunk.id}: ${summaryError.message}. Using original chunk. CV:${conversationId}`);
                    processedKnowledgeForContext.push(chunk); // Use original chunk if summarization call fails
                }
            }
            console.log(`(Controller) LLM summarization complete. ${processedKnowledgeForContext.length} chunks processed. CV:${conversationId}`);
        } else {
            processedKnowledgeForContext = [...filteredKnowledge]; // Use filtered (or top N) if summarization is disabled
            if (!ENABLE_LLM_CONTEXT_SUMMARIZATION) console.log("(Controller) LLM context summarization is disabled.");
        }

        // --- RAG Context Assembly ---
        let propositionsSectionText = "";
        // (Proposition processing logic remains unchanged from previous state)
        if (propositionResults.length > 0) {
            console.log(`(Controller) Processing ${propositionResults.length} proposition results for CV:${conversationId}.`);
            const propositionContextLines = [];
            for (const proposition of propositionResults) {
                try {
                    if (!proposition.source_chunk_id) {
                        console.warn(`(Controller) Proposition missing source_chunk_id: ${proposition.proposition_text.substring(0,50)}...`);
                        continue;
                    }
                    const { data: parentChunk, error: pcError } = await supabase
                        .from('knowledge_base')
                        .select('content, metadata')
                        .eq('id', proposition.source_chunk_id)
                        .eq('client_id', clientId)
                        .single();

                    if (pcError) {
                        console.error(`(Controller) Error fetching parent chunk ${proposition.source_chunk_id} for proposition:`, pcError.message);
                        continue;
                    }

                    if (parentChunk && parentChunk.content) {
                        const parentChunkSourceInfo = parentChunk.metadata?.hierarchy?.join(" > ") || parentChunk.metadata?.url || parentChunk.metadata?.source_name || 'Contexto Adicional';
                        let contextSnippet = parentChunk.content;
                        if (contextSnippet.includes(proposition.proposition_text) && contextSnippet.length > proposition.proposition_text.length + 50) {
                             const propIndex = contextSnippet.indexOf(proposition.proposition_text);
                             const start = Math.max(0, propIndex - 75);
                             const end = Math.min(contextSnippet.length, propIndex + proposition.proposition_text.length + 75);
                             contextSnippet = contextSnippet.substring(start, end);
                             if (start > 0) contextSnippet = "..." + contextSnippet;
                             if (end < parentChunk.content.length) contextSnippet = contextSnippet + "...";
                        } else {
                            contextSnippet = contextSnippet.substring(0, 250) + (contextSnippet.length > 250 ? "..." : "");
                        }
                        propositionContextLines.push(
`Afirmación Relevante: ${proposition.proposition_text}
(Contexto de Afirmación de ${parentChunkSourceInfo}: ${contextSnippet})`
                        );
                    }
                } catch (propContextError) {
                    console.error(`(Controller) Exception fetching context for proposition ${proposition.proposition_id || proposition.proposition_text.substring(0,30)}:`, propContextError.message);
                }
            }
            if (propositionContextLines.length > 0) {
                propositionsSectionText = "--- Afirmaciones Clave Encontradas ---\n" + propositionContextLines.join("\n---\n") + "\n\n";
            }
        }

        let fullChunksSectionText = "";
        // Now use processedKnowledgeForContext instead of relevantKnowledge for building this section
        if (processedKnowledgeForContext.length > 0) {
            fullChunksSectionText = processedKnowledgeForContext
                .map(chunk => {
                    const sourceInfo = chunk.metadata?.hierarchy?.join(" > ") || chunk.metadata?.url || chunk.metadata?.source_name || 'Documento Relevante';
                    const prefix = `Fuente: ${sourceInfo}\n`;
                    // Use extracted_content if available, otherwise fall back to original content
                    const contentToDisplay = chunk.extracted_content || chunk.content;
                    return `${prefix}Contenido: ${contentToDisplay}`;
                })
                .join("\n\n---\n\n");

            if (fullChunksSectionText) {
                 fullChunksSectionText = "--- Fragmentos de Documentos Relevantes (potencialmente resumidos) ---\n" + fullChunksSectionText;
            }
        }

        let ragContext = propositionsSectionText + fullChunksSectionText;
        if (!ragContext) {
            ragContext = "(No se encontró contexto relevante o procesado para esta pregunta)";
        }

        // --- Token Counting and Truncation Logic ---
        let mutableConversationHistory = [...conversationHistory];
        let mutableRagContext = ragContext; // ragContext now includes propositions and full chunks

        const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado de SynChat AI (synchatai.com). Tu ÚNICA fuente de información es el "Contexto" proporcionado a continuación. NO debes usar ningún conocimiento externo ni hacer suposiciones.

Instrucciones ESTRICTAS:
1.  Responde SOLAMENTE basándote en la información encontrada en el "Contexto". El contexto puede incluir "Afirmaciones Clave Encontradas" (proposiciones específicas) y "Fragmentos de Documentos Relevantes" (contexto más amplio).
2.  Prioriza la información de "Afirmaciones Clave Encontradas" si son directamente aplicables y cubren la pregunta del usuario. Utiliza los "Fragmentos de Documentos Relevantes" para obtener detalles adicionales o si no hay afirmaciones clave directas.
3.  Si la respuesta a la pregunta del usuario se encuentra en el "Contexto", respóndela de forma clara y concisa (máximo 3-4 frases).
4.  Si varios fragmentos del contexto responden a la pregunta del usuario, sintetiza la información en una respuesta única y coherente en español. No te limites a enumerar los fragmentos.
5.  Cuando utilices información de una fuente específica del contexto, menciónala de forma breve al final de tu respuesta de la siguiente manera: '(Fuente: [Nombre de la Fuente del Contexto])'. Por ejemplo: "La configuración se encuentra en el panel de administración (Fuente: Manual de Usuario Avanzado)." o "Sí, el límite es de 50MB (Contexto de Afirmación de Especificaciones Técnicas: ...el tamaño máximo de archivo es 50MB...)".
6.  Si el contexto no contiene una respuesta clara, o si la información es contradictoria o ambigua, responde ÚNICA Y EXACTAMENTE con: "${BOT_CANNOT_ANSWER_MSG}" NO intentes adivinar ni buscar en otro lado.
7.  Sé amable y profesional.

A continuación, algunos ejemplos de cómo debes responder:

Ejemplo 1:
Usuario: ¿Cómo configuro las notificaciones por correo?
Contexto Proporcionado:
--- Afirmaciones Clave Encontradas ---
Afirmación Relevante: Las notificaciones por email se activan en Perfil > Notificaciones.
(Contexto de Afirmación de Guía Rápida: ...Para notificaciones, ve a Perfil > Notificaciones y activa "Email"...)
--- Fragmentos de Documentos Relevantes ---
Fuente: Guía Rápida de Configuración
Contenido: Para ajustar las notificaciones, ve a tu Perfil, luego a Configuración de Notificaciones y activa la opción de "Email".
Zoe: Puedes configurar las notificaciones por correo yendo a tu Perfil, luego a Configuración de Notificaciones y activando la opción "Email". (Contexto de Afirmación de Guía Rápida)

Ejemplo 2:
Usuario: ¿Cuál es el horario de atención al cliente?
Contexto Proporcionado:
--- Fragmentos de Documentos Relevantes ---
Fuente: Página de Contacto
Contenido: Nuestro equipo de soporte está disponible de Lunes a Viernes, de 9:00 a 18:00 (hora local).
---
Fuente: Detalles del Servicio Premium
Contenido: Los clientes Premium tienen acceso a soporte 24/7.
Zoe: El equipo de soporte general está disponible de Lunes a Viernes, de 9:00 a 18:00 (hora local) (Fuente: Página de Contacto). Los clientes Premium tienen acceso a soporte 24/7 (Fuente: Detalles del Servicio Premium).

Ejemplo 3:
Usuario: ¿Tienen planes para implementar la función X?
Contexto Proporcionado:
(No se encontró contexto relevante para esta pregunta)
Zoe: Lo siento, no tengo información específica sobre eso en la base de datos de SynChat AI.
`;

        let finalSystemPromptContent = systemPromptBase + (mutableRagContext && mutableRagContext !== "(No se encontró contexto relevante para esta pregunta)" ? `\n\n--- Contexto ---\n${mutableRagContext}\n--- Fin del Contexto ---` : '\n\n(No se encontró contexto relevante para esta pregunta)');

        let systemPromptTokens = encode(finalSystemPromptContent).length;

Instrucciones ESTRICTAS:
1.  Responde SOLAMENTE basándote en la información encontrada en el "Contexto". NO debes usar ningún conocimiento externo ni hacer suposiciones.
2.  Si la respuesta a la pregunta del usuario se encuentra en el "Contexto", respóndela de forma clara y concisa (máximo 3-4 frases).
3.  Si varios fragmentos del contexto responden a la pregunta del usuario, sintetiza la información en una respuesta única y coherente en español. No te limites a enumerar los fragmentos.
4.  Cuando utilices información de una fuente específica del contexto, menciónala de forma breve al final de tu respuesta de la siguiente manera: '(Fuente: [Nombre de la Fuente del Contexto])'. Por ejemplo: "La configuración se encuentra en el panel de administración (Fuente: Manual de Usuario Avanzado)."
5.  Si el contexto no contiene una respuesta clara, o si la información es contradictoria o ambigua, responde ÚNICA Y EXACTAMENTE con: "${BOT_CANNOT_ANSWER_MSG}" NO intentes adivinar ni buscar en otro lado.
6.  Sé amable y profesional.

A continuación, algunos ejemplos de cómo debes responder:

Ejemplo 1:
Usuario: ¿Cómo configuro las notificaciones por correo?
Contexto Proporcionado:
Fuente: Guía Rápida de Configuración
Contenido: Para ajustar las notificaciones, ve a tu Perfil, luego a Configuración de Notificaciones y activa la opción de "Email".
---
Fuente: FAQ del Producto
Contenido: Las alertas por email se pueden activar en la sección de Preferencias de tu cuenta.
Zoe: Puedes configurar las notificaciones por correo yendo a tu Perfil, luego a Configuración de Notificaciones y activando la opción "Email". (Fuente: Guía Rápida de Configuración)

Ejemplo 2:
Usuario: ¿Cuál es el horario de atención al cliente?
Contexto Proporcionado:
Fuente: Página de Contacto
Contenido: Nuestro equipo de soporte está disponible de Lunes a Viernes, de 9:00 a 18:00 (hora local).
---
Fuente: Detalles del Servicio Premium
Contenido: Los clientes Premium tienen acceso a soporte 24/7.
Zoe: El equipo de soporte general está disponible de Lunes a Viernes, de 9:00 a 18:00 (hora local) (Fuente: Página de Contacto). Los clientes Premium tienen acceso a soporte 24/7 (Fuente: Detalles del Servicio Premium).

Ejemplo 3:
Usuario: ¿Tienen planes para implementar la función X?
Contexto Proporcionado:
Fuente: Hoja de Ruta Q3
Contenido: Se está evaluando la viabilidad de la función X para Q4.
---
Fuente: Anuncios Recientes
Contenido: La función Y será lanzada la próxima semana.
Zoe: Actualmente se está evaluando la viabilidad de implementar la función X para el cuarto trimestre (Fuente: Hoja de Ruta Q3).
`;

        let finalSystemPromptContent = systemPromptBase + (mutableRagContext ? `\n\n--- Contexto ---\n${mutableRagContext}\n--- Fin del Contexto ---` : '\n\n(No se encontró contexto relevante para esta pregunta)');

        let systemPromptTokens = encode(finalSystemPromptContent).length;
        let userMessageTokens = encode(message).length;
        let historyTokens = mutableConversationHistory.reduce((sum, msg) => sum + encode(msg.content).length, 0);
        // RagContext tokens are implicitly included in systemPromptTokens if mutableRagContext is not empty.
        // If mutableRagContext is empty, systemPromptTokens already reflects that.

        let totalCurrentTokens = systemPromptTokens + userMessageTokens + historyTokens;

        if (totalCurrentTokens > MAX_CONTEXT_TOKENS_FOR_LLM) {
            console.log(`(Controller) Token limit exceeded (${totalCurrentTokens}). Starting truncation for CV:${conversationId}. Max: ${MAX_CONTEXT_TOKENS_FOR_LLM}`);

            // 1. Truncate Conversation History
            const originalHistoryLength = mutableConversationHistory.length;
            while (totalCurrentTokens > MAX_CONTEXT_TOKENS_FOR_LLM && mutableConversationHistory.length > 0) {
                // Remove oldest messages (user/assistant pair if possible, or one by one)
                // For simplicity, removing one by one from the start.
                const removedMessage = mutableConversationHistory.shift();
                historyTokens -= encode(removedMessage.content).length;
                totalCurrentTokens = systemPromptTokens + userMessageTokens + historyTokens;
            }
            if (mutableConversationHistory.length < originalHistoryLength) {
                console.log(`(Controller) Truncated conversation history from ${originalHistoryLength} to ${mutableConversationHistory.length} messages for CV:${conversationId}.`);
            }

            // 2. Truncate RAG Context (if still over budget)
            // This recalculates systemPromptTokens as RAG context is part of it.
            if (totalCurrentTokens > MAX_CONTEXT_TOKENS_FOR_LLM && mutableRagContext) {
                console.log(`(Controller) Still over token limit after history truncation. Truncating RAG context for CV:${conversationId}.`);
                const ragChunks = mutableRagContext.split("\n\n---\n\n");
                let initialRagChunksCount = ragChunks.length;

                while (totalCurrentTokens > MAX_CONTEXT_TOKENS_FOR_LLM && ragChunks.length > 0) {
                    // Sort by length descending and remove the longest. This is a simple heuristic.
                    ragChunks.sort((a, b) => b.length - a.length);
                    const removedChunk = ragChunks.shift(); // Remove the longest

                    mutableRagContext = ragChunks.join("\n\n---\n\n");
                    finalSystemPromptContent = systemPromptBase + (mutableRagContext ? `\n\n--- Contexto ---\n${mutableRagContext}\n--- Fin del Contexto ---` : '\n\n(No se encontró contexto relevante para esta pregunta)');
                    systemPromptTokens = encode(finalSystemPromptContent).length;
                    totalCurrentTokens = systemPromptTokens + userMessageTokens + historyTokens;
                }
                if (ragChunks.length < initialRagChunksCount) {
                    console.log(`(Controller) Truncated RAG context from ${initialRagChunksCount} to ${ragChunks.length} chunks for CV:${conversationId}.`);
                }
            }
        }

        const messagesForAPI = [{ role: "system", content: finalSystemPromptContent }, ...mutableConversationHistory, { role: "user", content: message }];

        let botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);
        const originalBotReplyText = botReplyText;
        let wasEscalated = false;

        if (originalBotReplyText && originalBotReplyText.trim() === BOT_CANNOT_ANSWER_MSG) {
            console.log(`(Controller) Bot cannot answer. Escalating conversation CV:${conversationId} for C:${clientId}`);
            try {
                // Log that bot cannot answer first
                db.updateAnalyticOnBotCannotAnswer(conversationId, message) // `message` is the user query
                    .catch(err => console.error(`Analytics: Failed to update bot_cannot_answer for CV:${conversationId}`, err));

                await db.updateConversationStatusByAgent(conversationId, clientId, null, 'escalated_to_human');
                console.log(`(Controller) Conversation CV:${conversationId} status updated to escalated_to_human because bot cannot answer.`);
                botReplyText = BOT_ESCALATION_NOTIFICATION_MSG;
                wasEscalated = true;

                // Then log the escalation event itself
                db.updateAnalyticOnEscalation(conversationId, new Date(), message) // `message` is the user query that led to this
                    .catch(err => console.error(`Analytics: Failed to update escalation data (bot_cannot_answer) for CV:${conversationId}`, err));

            } catch (statusUpdateError) {
                console.error(`(Controller) Failed to update conversation status to escalated_to_human for CV:${conversationId}:`, statusUpdateError);
                // botReplyText remains originalBotReplyText (the "I cannot answer" message)
            }
        }

        // Prepare data for RAG interaction logging
        const retrievedContextForLog = hybridSearchResult.rawRankedResultsForLog.map(chunk => ({
            id: chunk.id,
            content_preview: chunk.content.substring(0, 150) + (chunk.content.length > 150 ? "..." : ""),
            score: chunk.reranked_score, // or hybrid_score if reranked_score is not always present
            metadata: chunk.metadata
        }));

        const logData = {
            clientId: clientId,
            conversationId: conversationId,
            userQuery: message, // Original user message
            retrievedContext: retrievedContextForLog,
            finalPromptToLlm: JSON.stringify(messagesForAPI), // Stringify the whole messages array
            llmResponse: botReplyText,
            queryEmbeddingsUsed: queriesThatWereEmbedded, // Array of query strings
            vectorSearchParams: searchParamsUsed,
            wasEscalated: wasEscalated
        };

        db.logRagInteraction(logData).catch(err => console.error("(Controller) Failed to log RAG interaction:", err.message));


        if (botReplyText) {
            // Save user message and increment count (if not already done for cache hit)
            // Note: If it was a cache hit, messages are already saved. This block is for non-cache hits.
            db.saveMessage(conversationId, 'user', message)
                .then(() => db.incrementAnalyticMessageCount(conversationId, 'user').catch(err => console.error(`Analytics: Failed to increment user message count for CV:${conversationId}`, err)))
                .catch(saveError => console.error(`Error no crítico al guardar mensaje de usuario para ${conversationId}:`, saveError));

            // Save bot message and increment count
            db.saveMessage(conversationId, 'bot', botReplyText)
                .then(() => db.incrementAnalyticMessageCount(conversationId, 'bot').catch(err => console.error(`Analytics: Failed to increment bot message count for CV:${conversationId}`, err)))
                .catch(saveError => console.error(`Error no crítico al guardar mensaje de bot para ${conversationId}:`, saveError));

            db.setCache(cacheKey, botReplyText);
            res.status(200).json({ reply: botReplyText });
        } else {
            console.error(`(Controller) Respuesta vacía o nula de OpenAI para ${conversationId}`);
            res.status(503).json({ reply: 'Lo siento, estoy teniendo problemas para procesar tu solicitud en este momento.' });
        }
    } catch (error) {
        console.error(`(Controller) Error general en handleChatMessage para ${conversationId}:`, error);
        next(error);
    }
};

/**
 * Inicia una nueva conversación para un cliente.
 */
export const startConversation = async (req, res, next) => {
    console.log('>>> chatController.js: DENTRO de startConversation');
    const { clientId } = req.body;
    if (!clientId) {
        console.warn('Petición inválida a /start. Falta clientId.');
        return res.status(400).json({ error: 'Falta clientId.' });
    }
    try {
        const clientExists = await db.getClientConfig(clientId); // ClientId here is from req.body
        if (!clientExists) {
            console.warn(`Intento de iniciar conversación para cliente inexistente: ${clientId}`);
            return res.status(404).json({ error: 'Cliente inválido o no encontrado.' });
        }
        // db.createConversation returns the conversation object which includes id, client_id, created_at
        const newConversation = await db.createConversation(clientId);
        if (!newConversation || !newConversation.conversation_id) {
            throw new Error("Failed to create conversation or retrieve its ID.");
        }
        console.log(`(Controller) Conversación iniciada/creada: ${newConversation.conversation_id} para cliente ${clientId}`);

        // Create initial analytics entry
        db.createConversationAnalyticEntry(newConversation.conversation_id, newConversation.client_id, newConversation.created_at)
            .catch(err => console.error(`Analytics: Failed to create entry for CV:${newConversation.conversation_id}`, err));

        res.status(201).json({ conversationId: newConversation.conversation_id });
    } catch (error) {
        console.error(`Error en startConversation para cliente ${clientId}:`, error);
        next(error);
    }
};

export default {
    handleChatMessage,
    startConversation
};
