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
 * Utilizado por chatController.startConversation para verificar si el cliente existe.
 * Y potencialmente por otros servicios que necesiten detalles del cliente.
 */
export const getClientConfig = async (clientId) => {
    console.log(`(DB Service) Buscando config para cliente: ${clientId} en 'synchat_clients'`);
    try {
        const { data, error } = await supabase
            .from('synchat_clients') // CORREGIDO: Nombre de la tabla
            .select('client_id, client_name, base_prompt_override, widget_config, knowledge_source_url, last_ingest_status, last_ingest_at, subscription_status') // Selecciona campos relevantes
            .eq('client_id', clientId)
            .maybeSingle(); // Devuelve un solo objeto o null si no se encuentra, sin error si 0 filas

        if (error) {
            // Manejar solo errores que no sean 'cero filas encontradas'
            if (error.code !== 'PGRST116') { // PGRST116 es el código para "zero rows returned" con maybeSingle
                console.error(`(DB Service) Error DB al obtener config del cliente ${clientId}:`, error.message, error.details);
                // No relanzar, simplemente devolver null para que la lógica que llama pueda manejarlo
                return null;
            } else {
                // Esto es normal si el cliente no existe, 'data' será null.
                console.log(`(DB Service) Cliente ${clientId} no encontrado en 'synchat_clients' (PGRST116).`);
            }
        }
        
        if (data) {
            console.log(`(DB Service) Configuración encontrada para cliente ${clientId}.`);
        } else {
            // Esto ocurrirá si el cliente no existe (error.code === 'PGRST116' o no hay error pero data es null)
            console.warn(`(DB Service) No se encontró registro para el cliente ${clientId} en 'synchat_clients'.`);
        }
        return data; // Devuelve 'data' (que será null si no se encontró)
    } catch (error) { 
        // Captura cualquier otro error inesperado durante la ejecución de la función
        console.error(`(DB Service) Excepción en getClientConfig para cliente ${clientId}:`, error.message);
        return null; // Devolver null en caso de excepción
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
            role: row.sender === 'bot' ? 'assistant' : 'user',
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
                sender: sender,
                content: textContent
                // timestamp es DEFAULT now() en la DB
            });

        if (error) throw error;
        console.log(`(DB Service) Mensaje guardado para ${conversationId}.`);
    } catch (error) {
        console.error(`(DB Service) Error al guardar mensaje para ${conversationId}:`, error.message);
    }
};

/**
 * Crea una nueva conversación. Devuelve el ID de la conversación.
 * Asume que la existencia del cliente ya ha sido verificada.
 */
export const createConversation = async (clientId) => {
    console.log(`(DB Service) Creando nueva conversación para cliente ${clientId}`);
    try {
        const { data, error } = await supabase
            .from('conversations') 
            .insert({ 
                client_id: clientId 
                // created_at y last_message_at tienen defaults o se manejan por triggers/aplicación
            })
            .select('conversation_id')
            .single(); // Espera un solo registro

        if (error) throw error;

        const createdId = data.conversation_id;
        console.log(`(DB Service) Nueva conversación creada con ID: ${createdId} para cliente ${clientId}`);
        return createdId;

    } catch (error) {
        console.error(`(DB Service) Error en createConversation para cliente ${clientId}:`, error.message);
        throw error; // Relanzar para que el llamador maneje
    }
};


/**
 * Realiza una búsqueda híbrida (vectorial + FTS) usando funciones RPC de Supabase.
 */
export const hybridSearch = async (clientId, queryText) => { // Renombrado 'query' a 'queryText' por claridad
    console.log(`(DB Service) Iniciando búsqueda híbrida RPC para cliente ${clientId}, query: "${queryText.substring(0, 50)}..."`);

    try {
        const queryEmbedding = await getEmbedding(queryText);
        if (!queryEmbedding) {
            console.warn("(DB Service) No se pudo generar embedding para la consulta. Saltando búsqueda vectorial.");
            return [];
        }

        console.log("(DB Service) Ejecutando RPCs vector_search y fts_search_with_rank en paralelo...");
        const [vectorResponse, ftsResponse] = await Promise.all([
            supabase.rpc('vector_search', { 
                client_id_param: clientId,
                query_embedding: queryEmbedding,
                match_threshold: VECTOR_MATCH_THRESHOLD,
                match_count: HYBRID_SEARCH_LIMIT * 2 
            }),
            supabase.rpc('fts_search_with_rank', { 
                client_id_param: clientId,
                query_text: queryText, // Nombre del parámetro en la función RPC
                match_count: HYBRID_SEARCH_LIMIT * 2
                // language_config es opcional y usará el default 'english' de la función RPC
            })
        ]);

        if (vectorResponse.error) {
            console.error("(DB Service) Error en RPC vector_search:", vectorResponse.error.message);
            // Considerar si continuar solo con FTS o devolver error/vacío
        }
        const vectorResults = vectorResponse.data || [];
        console.log(`(DB Service) Vector search (RPC) encontró ${vectorResults.length} resultados.`);

        if (ftsResponse.error) {
            console.error("(DB Service) Error en RPC fts_search_with_rank:", ftsResponse.error.message);
            // Considerar si continuar solo con Vector o devolver error/vacío
        }
        const textResults = ftsResponse.data || []; 
        console.log(`(DB Service) FTS search (RPC) encontró ${textResults.length} resultados.`);

        // Combinar y Re-rankear Resultados
        const combinedResults = {};

        vectorResults.forEach(row => {
            const id = String(row.id); // Usar string para claves de objeto consistentemente
            if (!row.id) return; // Saltar si no hay id
            if (!combinedResults[id]) {
                combinedResults[id] = { ...row, vector_similarity: row.similarity || 0, fts_score: 0 };
            } else {
                combinedResults[id].vector_similarity = Math.max(combinedResults[id].vector_similarity || 0, row.similarity || 0);
            }
        });

        textResults.forEach(row => {
            const id = String(row.id); // Usar string para claves de objeto
            if (!row.id) return; // Saltar si no hay id
            const ftsScore = row.rank || 0; // La función RPC devuelve 'rank'
            if (!combinedResults[id]) {
                combinedResults[id] = { ...row, vector_similarity: 0, fts_score: ftsScore };
            } else {
                combinedResults[id].fts_score = Math.max(combinedResults[id].fts_score || 0, ftsScore);
                // Asegurar que el contenido y metadata no se pierdan si una búsqueda los tiene y la otra no
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
        
        return rankedResults.map(r => ({
             id: r.id, // Mantener el tipo original (BIGINT de la DB)
             content: r.content,
             metadata: r.metadata
            }));

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
                details: detailsJson // 'details' es JSONB en la DB
            });

        if (error) {
            console.error(`(DB Service) Error logging AI resolution:`, error.message);
        } else {
            console.log(`(DB Service) AI resolution logged successfully for Client: ${clientId}, Conv: ${conversationId}.`);
        }
    } catch (err) {
        console.error(`(DB Service) Unexpected error in logAiResolution for Client: ${clientId}:`, err.message);
    }
};
