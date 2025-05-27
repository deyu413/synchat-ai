// src/controllers/chatController.js
import { getChatCompletion } from '../services/openaiService.js';
import * as db from '../services/databaseService.js';

// Modelo de IA a usar y Temperatura
const CHAT_MODEL = "gpt-3.5-turbo";
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
        const relevantKnowledge = await db.hybridSearch(clientId, message);
        let ragContext = "";
        if (relevantKnowledge && relevantKnowledge.length > 0) {
             ragContext = relevantKnowledge
                .map(chunk => {
                     const sourceInfo = chunk.metadata?.hierarchy?.join(" > ") || chunk.metadata?.url || '';
                     const prefix = sourceInfo ? `Fuente: ${sourceInfo}\n` : '';
                     return `${prefix}Contenido: ${chunk.content}`;
                 })
                .join("\n\n---\n\n");
        }

        const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado de SynChat AI (synchatai.com). Tu ÚNICA fuente de información es el "Contexto" proporcionado a continuación. NO debes usar ningún conocimiento externo ni hacer suposiciones.

Instrucciones ESTRICTAS:
1.  Responde SOLAMENTE basándote en la información encontrada en el "Contexto".
2.  Si la respuesta a la pregunta del usuario se encuentra en el "Contexto", respóndela de forma clara y concisa (máximo 3-4 frases). Cita la fuente si es relevante usando la información de "Fuente:" del contexto.
3.  Si la información necesaria para responder NO se encuentra en el "Contexto", responde EXACTAMENTE con: "${BOT_CANNOT_ANSWER_MSG}" NO intentes adivinar ni buscar en otro lado.
4.  Sé amable y profesional.`;
        const finalSystemPrompt = systemPromptBase + (ragContext ? `\n\n--- Contexto ---\n${ragContext}\n--- Fin del Contexto ---` : '\n\n(No se encontró contexto relevante para esta pregunta)');
        const messagesForAPI = [{ role: "system", content: finalSystemPrompt }, ...conversationHistory, { role: "user", content: message }];

        let botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);
        const originalBotReplyText = botReplyText;

        if (originalBotReplyText && originalBotReplyText.trim() === BOT_CANNOT_ANSWER_MSG) {
            console.log(`(Controller) Bot cannot answer. Escalating conversation CV:${conversationId} for C:${clientId}`);
            try {
                await db.updateConversationStatusByAgent(conversationId, clientId, null, 'escalated_to_human');
                console.log(`(Controller) Conversation CV:${conversationId} status updated to escalated_to_human.`);
                botReplyText = BOT_ESCALATION_NOTIFICATION_MSG;
            } catch (statusUpdateError) {
                console.error(`(Controller) Failed to update conversation status to escalated_to_human for CV:${conversationId}:`, statusUpdateError);
                // botReplyText remains originalBotReplyText (the "I cannot answer" message)
            }
        }

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
