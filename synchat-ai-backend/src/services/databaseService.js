// src/services/databaseService.js
import { supabase } from './supabaseClient.js'; // Importar cliente inicializado
import { getEmbedding } from './embeddingService.js'; // Necesario para búsqueda híbrida

// --- Configuración ---
const HYBRID_SEARCH_VECTOR_WEIGHT = 0.5;
const HYBRID_SEARCH_FTS_WEIGHT = 0.5;
const HYBRID_SEARCH_LIMIT = 5;
const VECTOR_MATCH_THRESHOLD = 0.65; // Umbral de similitud coseno (0 a 1, más alto es más similar)
const HISTORY_MESSAGE_LIMIT = 8;       // Límite de mensajes de historial

// --- Cache (Simple en Memoria) ---
const questionCache = new Map();

export function getCache(key) {
    const cacheKey = key.toLowerCase().trim();
    const cached = questionCache.get(cacheKey);
    if (cached) {
        console.log(`(Cache) HIT para: "${cacheKey.substring(0, 50)}..."`);
        return cached;
    }
    console.log(`(Cache) MISS para: "${cacheKey.substring(0, 50)}..."`);
    return null;
}

export function setCache(key, value) {
    const cacheKey = key.toLowerCase().trim();
    console.log(`(Cache) SET para: "${cacheKey.substring(0, 50)}..."`);
    questionCache.set(key, value);
}
// --------------------------------

/**
 * Obtiene la configuración específica del cliente.
 */
export const getClientConfig = async (clientId) => {
    console.log(`(DB Service) Buscando config para cliente: ${clientId} en 'synchat_clients'`);
    try {
        const { data, error } = await supabase
            .from('synchat_clients')
            .select('client_id, client_name, base_prompt_override, widget_config, knowledge_source_url, last_ingest_status, last_ingest_at, subscription_status')
            .eq('client_id', clientId)
            .maybeSingle();

        if (error) {
            if (error.code !== 'PGRST116') {
                console.error(`(DB Service) Error DB al obtener config del cliente ${clientId}:`, error.message, error.details);
                return null;
            } else {
                console.log(`(DB Service) Cliente ${clientId} no encontrado en 'synchat_clients' (PGRST116).`);
            }
        }
        
        if (data) {
            console.log(`(DB Service) Configuración encontrada para cliente ${clientId}.`);
        } else {
            console.warn(`(DB Service) No se encontró registro para el cliente ${clientId} en 'synchat_clients'.`);
        }
        return data;
    } catch (error) {
        console.error(`(DB Service) Excepción en getClientConfig para cliente ${clientId}:`, error.message);
        return null;
    }
};

/**
 * Obtiene el historial de conversación formateado para OpenAI.
 */
export const getConversationHistory = async (conversationId) => {
    console.log(`(DB Service) Buscando historial para conversación: ${conversationId}, límite: ${HISTORY_MESSAGE_LIMIT}`);
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('sender, content')
            .eq('conversation_id', conversationId)
            .order('timestamp', { ascending: true })
            .limit(HISTORY_MESSAGE_LIMIT);

        if (error) throw error;

        const formattedHistory = data.map(row => ({
            role: row.sender === 'bot' ? 'assistant' : 'user', // Assumes sender ENUM matches 'bot' or 'user'
            content: row.content
        }));

        console.log(`(DB Service) Historial formateado encontrado para ${conversationId}: ${formattedHistory.length} mensajes.`);
        return formattedHistory;
    } catch (error) {
        console.error(`(DB Service) Error al obtener historial de ${conversationId}:`, error.message);
        return [];
    }
};

/**
 * Guarda un mensaje en la base de datos.
 */
export const saveMessage = async (conversationId, sender, textContent) => {
    console.log(`(DB Service) Guardando mensaje para ${conversationId}: (${sender})`);
    try {
        const { error } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversationId,
                sender: sender, // This should match the 'message_sender_type' ENUM
                content: textContent
            });

        if (error) throw error;
        console.log(`(DB Service) Mensaje guardado para ${conversationId}.`);
    } catch (error) {
        console.error(`(DB Service) Error al guardar mensaje para ${conversationId}:`, error.message);
    }
};

/**
 * Crea una nueva conversación. Devuelve el ID de la conversación.
 */
export const createConversation = async (clientId) => {
    console.log(`(DB Service) Creando nueva conversación para cliente ${clientId}`);
    try {
        const { data, error } = await supabase
            .from('conversations')
            .insert({
                client_id: clientId
                // status will use its default 'open' or 'bot_active'
            })
            .select('conversation_id')
            .single();

        if (error) throw error;

        const createdId = data.conversation_id;
        console.log(`(DB Service) Nueva conversación creada con ID: ${createdId} para cliente ${clientId}`);
        return createdId;

    } catch (error) {
        console.error(`(DB Service) Error en createConversation para cliente ${clientId}:`, error.message);
        throw error;
    }
};


/**
 * Realiza una búsqueda híbrida (vectorial + FTS) usando funciones RPC de Supabase.
 */
export const hybridSearch = async (clientId, queryText) => {
    console.log(`(DB Service) Iniciando búsqueda híbrida RPC para cliente ${clientId}, query: "${queryText.substring(0, 50)}..."`);
    try {
        const queryEmbedding = await getEmbedding(queryText);
        if (!queryEmbedding) {
            console.warn("(DB Service) No se pudo generar embedding para la consulta. Saltando búsqueda vectorial.");
            return [];
        }

        const [vectorResponse, ftsResponse] = await Promise.all([
            supabase.rpc('vector_search', {
                client_id_param: clientId,
                query_embedding: queryEmbedding,
                match_threshold: VECTOR_MATCH_THRESHOLD,
                match_count: HYBRID_SEARCH_LIMIT * 2
            }),
            supabase.rpc('fts_search_with_rank', {
                client_id_param: clientId,
                query_text: queryText,
                match_count: HYBRID_SEARCH_LIMIT * 2
            })
        ]);

        if (vectorResponse.error) console.error("(DB Service) Error en RPC vector_search:", vectorResponse.error.message);
        const vectorResults = vectorResponse.data || [];

        if (ftsResponse.error) console.error("(DB Service) Error en RPC fts_search_with_rank:", ftsResponse.error.message);
        const textResults = ftsResponse.data || [];

        const combinedResults = {};
        vectorResults.forEach(row => {
            if (!row.id) return;
            const id = String(row.id);
            combinedResults[id] = { ...row, vector_similarity: row.similarity || 0, fts_score: 0 };
        });
        textResults.forEach(row => {
            if (!row.id) return;
            const id = String(row.id);
            const ftsScore = row.rank || 0;
            if (!combinedResults[id]) {
                combinedResults[id] = { ...row, vector_similarity: 0, fts_score: ftsScore };
            } else {
                combinedResults[id].fts_score = Math.max(combinedResults[id].fts_score || 0, ftsScore);
                if (!combinedResults[id].content && row.content) combinedResults[id].content = row.content;
                if (!combinedResults[id].metadata && row.metadata) combinedResults[id].metadata = row.metadata;
            }
        });

        const rankedResults = Object.values(combinedResults)
            .filter(item => item.id && item.content)
            .map(item => ({
                ...item,
                hybrid_score: ((item.vector_similarity || 0) * HYBRID_SEARCH_VECTOR_WEIGHT) + ((item.fts_score || 0) * HYBRID_SEARCH_FTS_WEIGHT)
            }))
            .sort((a, b) => b.hybrid_score - a.hybrid_score)
            .slice(0, HYBRID_SEARCH_LIMIT);

        console.log(`(DB Service) Búsqueda híbrida completada. Resultados finales: ${rankedResults.length}`);
        return rankedResults.map(r => ({ id: r.id, content: r.content, metadata: r.metadata }));
    } catch (error) {
        console.error(`(DB Service) Error general durante la búsqueda híbrida para cliente ${clientId}:`, error.message, error.stack);
        return [];
    }
};

/**
 * Logs an AI resolution event.
 */
export const logAiResolution = async (clientId, conversationId, billingCycleId, detailsJson) => {
    console.log(`(DB Service) Logging AI resolution for Client: ${clientId}, Conv: ${conversationId}, Cycle: ${billingCycleId}`);
    try {
        const { error } = await supabase
            .from('ia_resolutions_log')
            .insert({
                client_id: clientId,
                conversation_id: conversationId,
                billing_cycle_id: billingCycleId,
                details: detailsJson
            });
        if (error) console.error(`(DB Service) Error logging AI resolution:`, error.message);
        else console.log(`(DB Service) AI resolution logged successfully for Client: ${clientId}, Conv: ${conversationId}.`);
    } catch (err) {
        console.error(`(DB Service) Unexpected error in logAiResolution for Client: ${clientId}:`, err.message);
    }
};

// --- New Shared Inbox Functions ---

/**
 * Fetches a paginated list of conversations for a given client, filterable by status.
 */
export const getClientConversations = async (clientId, statusFilters = [], page = 1, pageSize = 20) => {
    console.log(`(DB Service) Fetching conversations for client ${clientId}, page ${page}, size ${pageSize}, statuses: ${statusFilters.join(', ')}`);
    const offset = (page - 1) * pageSize;
    let query = supabase
        .from('conversations')
        .select('conversation_id, client_id, status, created_at, last_message_at, last_agent_message_at, last_message_preview, assigned_agent_id', { count: 'exact' })
        .eq('client_id', clientId);

    const effectiveStatusFilters = statusFilters.length > 0 ? statusFilters : ['escalated_to_human', 'awaiting_agent_reply', 'agent_replied', 'open']; // Default active filters

    query = query.in('status', effectiveStatusFilters);

    query = query.order('last_message_at', { ascending: false, nullsFirst: false }) // Assuming recent messages are more relevant
                 .range(offset, offset + pageSize - 1);

    try {
        const { data, error, count } = await query;
        if (error) {
            console.error(`(DB Service) Error fetching conversations for client ${clientId}:`, error.message);
            throw error;
        }

        const totalPages = Math.ceil(count / pageSize);
        console.log(`(DB Service) Found ${count} conversations for client ${clientId} matching filters. Page ${page}/${totalPages}.`);
        return {
            data: data || [],
            totalCount: count || 0,
            page,
            pageSize,
            totalPages
        };
    } catch (err) {
        console.error(`(DB Service) Exception in getClientConversations for client ${clientId}:`, err.message);
        // Return a structure indicating error or empty result to prevent frontend crashes
        return { data: [], totalCount: 0, page, pageSize, totalPages: 0, error: err.message };
    }
};

/**
 * Fetches all messages for a specific conversation, ensuring it belongs to the client.
 */
export const getMessagesForConversation = async (conversationId, clientId) => {
    console.log(`(DB Service) Verifying ownership and fetching messages for conversation ${conversationId}, client ${clientId}`);
    try {
        // 1. Verify conversation ownership
        const { data: convData, error: convError } = await supabase
            .from('conversations')
            .select('conversation_id')
            .eq('conversation_id', conversationId)
            .eq('client_id', clientId)
            .single();

        if (convError || !convData) {
            const errorMsg = `(DB Service) Conversation ${conversationId} not found or does not belong to client ${clientId}.`;
            console.error(errorMsg, convError?.message);
            throw new Error(convError?.code === 'PGRST116' ? "Conversation not found or access denied." : convError?.message || "Ownership verification failed.");
        }

        // 2. Fetch messages
        console.log(`(DB Service) Fetching messages for conversation ${conversationId}`);
        const { data: messages, error: messagesError } = await supabase
            .from('messages')
            .select('message_id, conversation_id, sender, content, timestamp, agent_user_id') // Assuming agent_user_id might be on messages
            .eq('conversation_id', conversationId)
            .order('timestamp', { ascending: true });

        if (messagesError) {
            console.error(`(DB Service) Error fetching messages for conversation ${conversationId}:`, messagesError.message);
            throw messagesError;
        }

        console.log(`(DB Service) Found ${messages.length} messages for conversation ${conversationId}.`);
        return messages || [];
    } catch (err) {
        console.error(`(DB Service) Exception in getMessagesForConversation for conv ${conversationId}:`, err.message);
        throw err; // Re-throw to be handled by controller
    }
};

/**
 * Adds a message from an agent to a conversation and updates conversation metadata.
 */
export const addAgentMessageToConversation = async (conversationId, clientId, agentUserId, content) => {
    console.log(`(DB Service) Adding agent message to conversation ${conversationId} by agent ${agentUserId}`);
    try {
        // 1. Verify Conversation Ownership
        const { data: convData, error: convError } = await supabase
            .from('conversations')
            .select('conversation_id, assigned_agent_id')
            .eq('conversation_id', conversationId)
            .eq('client_id', clientId)
            .single();

        if (convError || !convData) {
            const errorMsg = `(DB Service) Conversation ${conversationId} for agent message not found or does not belong to client ${clientId}.`;
            console.error(errorMsg, convError?.message);
            throw new Error(convError?.code === 'PGRST116' ? "Conversation not found or access denied." : convError?.message || "Ownership verification failed.");
        }

        // 2. Insert the new message
        const { data: newMessage, error: messageInsertError } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversationId,
                sender: 'agent', // Matches 'message_sender_type' ENUM
                content: content,
                agent_user_id: agentUserId // Assuming you add this column to messages table
            })
            .select() // Select the newly inserted message
            .single();

        if (messageInsertError) {
            console.error(`(DB Service) Error inserting agent message into conversation ${conversationId}:`, messageInsertError.message);
            throw messageInsertError;
        }
        console.log(`(DB Service) Agent message inserted for conversation ${conversationId}. ID: ${newMessage.message_id}`);

        // 3. Update conversation metadata
        const updatePayload = {
            last_message_at: new Date().toISOString(),
            last_agent_message_at: new Date().toISOString(),
            status: 'agent_replied', // Matches 'conversation_status_type' ENUM
            last_message_preview: content.substring(0, 255)
        };
        // Optionally assign agent if not already assigned or if different agent replies
        if (!convData.assigned_agent_id || convData.assigned_agent_id !== agentUserId) {
            updatePayload.assigned_agent_id = agentUserId;
        }

        const { error: conversationUpdateError } = await supabase
            .from('conversations')
            .update(updatePayload)
            .eq('conversation_id', conversationId);

        if (conversationUpdateError) {
            console.error(`(DB Service) Error updating conversation metadata for ${conversationId} after agent message:`, conversationUpdateError.message);
            // Note: Message is inserted, but conversation update failed. This might require a compensating action or be acceptable.
            // For now, log and proceed, returning the message.
        } else {
            console.log(`(DB Service) Conversation ${conversationId} metadata updated after agent message.`);
        }

        return newMessage;

    } catch (err) {
        console.error(`(DB Service) Exception in addAgentMessageToConversation for conv ${conversationId}:`, err.message);
        throw err; // Re-throw for controller to handle
    }
};

/**
 * Updates the status of a conversation by an agent.
 */
export const updateConversationStatusByAgent = async (conversationId, clientId, agentUserId, newStatus) => {
    console.log(`(DB Service) Updating status of conversation ${conversationId} by agent ${agentUserId} to ${newStatus}`);
    // TODO: Later, validate newStatus against a list of allowed statuses an agent can set.
    // For now, assuming newStatus is valid according to 'conversation_status_type' ENUM.

    try {
        // 1. Verify Conversation Ownership
        const { data: convData, error: convError } = await supabase
            .from('conversations')
            .select('conversation_id, status, assigned_agent_id')
            .eq('conversation_id', conversationId)
            .eq('client_id', clientId)
            .single();

        if (convError || !convData) {
            const errorMsg = `(DB Service) Conversation ${conversationId} for status update not found or does not belong to client ${clientId}.`;
            console.error(errorMsg, convError?.message);
            throw new Error(convError?.code === 'PGRST116' ? "Conversation not found or access denied." : convError?.message || "Ownership verification failed.");
        }

        // 2. Prepare update payload
        const updatePayload = {
            status: newStatus,
            // updated_at is likely handled by a DB trigger, if not, add: updated_at: new Date().toISOString()
        };

        // If an agent is involved and the conversation is being assigned or an agent is taking an action that implies assignment
        if (agentUserId && (newStatus === 'awaiting_agent_reply' || newStatus === 'agent_replied' || newStatus === 'escalated_to_human')) {
            if (!convData.assigned_agent_id || convData.assigned_agent_id !== agentUserId) { // Assign if no one is assigned or if a different agent is acting
                updatePayload.assigned_agent_id = agentUserId;
                console.log(`(DB Service) Assigning agent ${agentUserId} to conversation ${conversationId} due to status change to ${newStatus}.`);
            }
        } else if (newStatus === 'escalated_to_human' && !agentUserId) {
            // Bot-initiated escalation, ensure assigned_agent_id remains null or is explicitly set to null
            // if it wasn't already. Typically, it would be null if bot was handling.
            // If it was previously assigned and bot escalates again, policy might vary.
            // For now, if bot escalates, we don't assign an agent here; it becomes unassigned in 'escalated_to_human' pool.
            // If an agent was assigned and bot escalates, current logic keeps existing agent.
            // To clear agent on bot escalation: updatePayload.assigned_agent_id = null;
            console.log(`(DB Service) Bot escalated conversation ${conversationId}. No agent assigned by this action.`);
        }


        // 3. Update the conversation
        const { data: updatedConversation, error: updateError } = await supabase
            .from('conversations')
            .update(updatePayload)
            .eq('conversation_id', conversationId)
            .select() // Select the updated conversation
            .single();

        if (updateError) {
            console.error(`(DB Service) Error updating status for conversation ${conversationId}:`, updateError.message);
            throw updateError;
        }

        console.log(`(DB Service) Status for conversation ${conversationId} updated successfully to ${newStatus}.`);
        return updatedConversation;

    } catch (err) {
        console.error(`(DB Service) Exception in updateConversationStatusByAgent for conv ${conversationId}:`, err.message);
        throw err; // Re-throw for controller to handle
    }
};

