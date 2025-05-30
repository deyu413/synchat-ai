// src/controllers/chatController.js
import { getChatCompletion } from '../services/openaiService.js';
import * as db from '../services/databaseService.js';
import { encode } from 'gpt-tokenizer';

// Modelo de IA a usar y Temperatura
const CHAT_MODEL = "gpt-3.5-turbo";
const MAX_CONTEXT_TOKENS_FOR_LLM = 3000; // Max tokens for context, leaving room for response
const CHAT_TEMPERATURE = 0.3; // Más baja para reducir alucinaciones

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

            // Update conversation status
            await db.updateConversationStatusByAgent(conversationId, clientId, null, 'escalated_to_human');
            console.log(`(Controller) Conversation CV:${conversationId} status updated to escalated_to_human due to user request.`);

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
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', cachedReply)
            ]).catch(err => console.error("Error guardando mensajes (cache hit):", err));
             return res.status(200).json({ reply: cachedReply });
        }

        console.log("(Controller) No encontrado en caché. Procesando...");

        const conversationHistory = await db.getConversationHistory(conversationId);

        // Call hybridSearch and expect the new return structure
        const hybridSearchResult = await db.hybridSearch(clientId, message, conversationId, {});
        const relevantKnowledge = hybridSearchResult.results; // These are the top N results
        const searchParamsUsed = hybridSearchResult.searchParams;
        const queriesThatWereEmbedded = hybridSearchResult.queriesEmbedded;
        // hybridSearchResult.rawRankedResultsForLog contains more items before final slicing, if needed for deeper logging

        let ragContext = "";
        if (relevantKnowledge && relevantKnowledge.length > 0) {
             ragContext = relevantKnowledge
                .map(chunk => { // relevantKnowledge here are the final top N results
                     const sourceInfo = chunk.metadata?.hierarchy?.join(" > ") || chunk.metadata?.url || '';
                     const prefix = sourceInfo ? `Fuente: ${sourceInfo}\n` : '';
                     return `${prefix}Contenido: ${chunk.content}`;
                 })
                .join("\n\n---\n\n");
        }

        // --- Token Counting and Truncation Logic ---
        let mutableConversationHistory = [...conversationHistory];
        let mutableRagContext = ragContext;

        const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado de SynChat AI (synchatai.com). Tu ÚNICA fuente de información es el "Contexto" proporcionado a continuación. NO debes usar ningún conocimiento externo ni hacer suposiciones.

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
                await db.updateConversationStatusByAgent(conversationId, clientId, null, 'escalated_to_human');
                console.log(`(Controller) Conversation CV:${conversationId} status updated to escalated_to_human.`);
                botReplyText = BOT_ESCALATION_NOTIFICATION_MSG;
                wasEscalated = true;
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
            Promise.all([
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', botReplyText)
            ]).catch(saveError => console.error(`Error no crítico al guardar mensajes para ${conversationId}:`, saveError));
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
        const clientExists = await db.getClientConfig(clientId);
        if (!clientExists) {
            console.warn(`Intento de iniciar conversación para cliente inexistente: ${clientId}`);
            return res.status(404).json({ error: 'Cliente inválido o no encontrado.' });
        }
        const conversationId = await db.createConversation(clientId);
        console.log(`(Controller) Conversación iniciada/creada: ${conversationId} para cliente ${clientId}`);
        res.status(201).json({ conversationId });
    } catch (error) {
        console.error(`Error en startConversation para cliente ${clientId}:`, error);
        next(error);
    }
};

export default {
    handleChatMessage,
    startConversation
};
