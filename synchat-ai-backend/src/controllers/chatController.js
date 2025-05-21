// src/controllers/chatController.js
import { getChatCompletion } from '../services/openaiService.js';
import * as db from '../services/databaseService.js';

// Modelo de IA a usar y Temperatura
const CHAT_MODEL = "gpt-3.5-turbo";
const CHAT_TEMPERATURE = 0.3; // Más baja para reducir alucinaciones

/**
 * Maneja la recepción de un nuevo mensaje de chat.
 */
export const handleChatMessage = async (req, res, next) => {
    const { message, conversationId, clientId } = req.body;

    if (!message || !conversationId || !clientId) {
        console.warn('Petición inválida a /message:', req.body);
        return res.status(400).json({ error: 'Faltan datos requeridos (message, conversationId, clientId).' });
    }

    console.log(`(Controller) Mensaje recibido C:${clientId}, CV:${conversationId}: "${message.substring(0, 100)}..."`);

    try {
        // --- Cache ---
        const cacheKey = `${clientId}:${conversationId}:${message}`;
        const cachedReply = db.getCache(cacheKey);
        if (cachedReply) {
            // Guardar mensajes incluso si la respuesta es de caché (no bloqueante)
            Promise.all([
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', cachedReply)
            ]).catch(err => console.error("Error guardando mensajes (cache hit):", err));
             return res.status(200).json({ reply: cachedReply });
        }

        console.log("(Controller) No encontrado en caché. Procesando...");

        // --- Obtener Historial ---
        const conversationHistory = await db.getConversationHistory(conversationId);
        console.log(`(Controller) Historial recuperado: ${conversationHistory.length} mensajes.`);
        // Nota: clientConfig se carga en startConversation para validación,
        // pero el prompt ahora es específico para SynChat AI y no usa clientConfig.base_prompt

        // --- Búsqueda Híbrida (RAG) ---
        const relevantKnowledge = await db.hybridSearch(clientId, message);
        let ragContext = "";
        if (relevantKnowledge && relevantKnowledge.length > 0) {
             console.log(`(Controller) ${relevantKnowledge.length} fragmentos RAG encontrados.`);
             ragContext = relevantKnowledge
                .map(chunk => {
                     const sourceInfo = chunk.metadata?.hierarchy?.join(" > ") || chunk.metadata?.url || '';
                     // Añadir prefijo solo si hay sourceInfo
                     const prefix = sourceInfo ? `Fuente: ${sourceInfo}\n` : '';
                     return `${prefix}Contenido: ${chunk.content}`;
                 })
                .join("\n\n---\n\n");
        } else {
             console.log("(Controller) No se encontraron fragmentos RAG relevantes.");
        }

        // --- Construir Prompt del Sistema MEJORADO ---
        const systemPromptBase = `Eres Zoe, el asistente virtual IA especializado de SynChat AI (synchatai.com). Tu ÚNICA fuente de información es el "Contexto" proporcionado a continuación. NO debes usar ningún conocimiento externo ni hacer suposiciones.

Instrucciones ESTRICTAS:
1.  Responde SOLAMENTE basándote en la información encontrada en el "Contexto".
2.  Si la respuesta a la pregunta del usuario se encuentra en el "Contexto", respóndela de forma clara y concisa (máximo 3-4 frases). Cita la fuente si es relevante usando la información de "Fuente:" del contexto.
3.  Si la información necesaria para responder NO se encuentra en el "Contexto", responde EXACTAMENTE con: "Lo siento, no tengo información específica sobre eso en la base de datos de SynChat AI." NO intentes adivinar ni buscar en otro lado.
4.  Sé amable y profesional.`;

        const finalSystemPrompt = systemPromptBase +
            (ragContext ? `\n\n--- Contexto ---\n${ragContext}\n--- Fin del Contexto ---` : '\n\n(No se encontró contexto relevante para esta pregunta)');

        // --- Construir Mensajes para OpenAI ---
        const messagesForAPI = [
            { role: "system", content: finalSystemPrompt },
            ...conversationHistory,
            { role: "user", content: message }
        ];

        // --- Llamar a OpenAI ---
        console.log(`(Controller) Enviando ${messagesForAPI.length} mensajes a OpenAI (Modelo: ${CHAT_MODEL}, Temp: ${CHAT_TEMPERATURE}).`);
        const botReplyText = await getChatCompletion(messagesForAPI, CHAT_MODEL, CHAT_TEMPERATURE);

        // --- Procesar Respuesta y Guardar ---
        if (botReplyText) {
            Promise.all([
                 db.saveMessage(conversationId, 'user', message),
                 db.saveMessage(conversationId, 'bot', botReplyText)
            ]).catch(saveError => {
                 console.error(`Error no crítico al guardar mensajes para ${conversationId}:`, saveError);
            });

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
 * ¡¡ESTA ES LA FUNCIÓN QUE FALTABA DEFINIR!!
 */
export const startConversation = async (req, res, next) => {
    console.log('>>> chatController.js: DENTRO de startConversation');
    const { clientId } = req.body;

    if (!clientId) {
        console.warn('Petición inválida a /start. Falta clientId.');
        return res.status(400).json({ error: 'Falta clientId.' });
    }

    try {
        // Verificar si el cliente existe (buena práctica)
        const clientExists = await db.getClientConfig(clientId);
        if (!clientExists) {
            console.warn(`Intento de iniciar conversación para cliente inexistente: ${clientId}`);
            return res.status(404).json({ error: 'Cliente inválido o no encontrado.' });
        }

        // Crear una nueva conversación
        const conversationId = await db.getOrCreateConversation(clientId);
        console.log(`(Controller) Conversación iniciada/creada: ${conversationId} para cliente ${clientId}`);

        res.status(201).json({ conversationId }); // 201 Created

    } catch (error) {
        console.error(`Error en startConversation para cliente ${clientId}:`, error);
        next(error); // Pasar al middleware de errores
    }
};


// --- Exportar AMBAS funciones ---
export default {
    handleChatMessage,
    startConversation // Ahora sí está definida antes de exportarla
};

// Ahora sí está definida antes de exportarla// Ahora sí está definida antes de exportarla