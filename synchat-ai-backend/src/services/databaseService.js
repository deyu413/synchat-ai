// src/services/databaseService.js
import { supabase } from './supabaseClient.js'; // Importar cliente inicializado
import { getEmbedding } from './embeddingService.js'; // Necesario para búsqueda híbrida

// --- Configuración ---
const HYBRID_SEARCH_VECTOR_WEIGHT = 0.5; // Peso para la similitud vectorial (ajusta según veas necesario)
const HYBRID_SEARCH_FTS_WEIGHT = 0.5;    // Peso para el score de Full-Text Search (ajusta según veas necesario)
const HYBRID_SEARCH_LIMIT = 5;           // Límite de resultados combinados
const VECTOR_MATCH_THRESHOLD = 0.65; // Umbral de similitud coseno (0 a 1, más alto es más similar)
const HISTORY_MESSAGE_LIMIT = 8;       // Límite de mensajes de historial

// --- Cache (Simple en Memoria) ---
// Advertencia: Esta caché es volátil y no apta para entornos multi-instancia.
// Considerar Redis o similar para producción.
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
    questionCache.set(key, value); // Usar key original aquí puede ser mejor si la necesitas luego
    // Opcional: Limitar tamaño de caché o añadir TTL
}
// --------------------------------

/**
 * Obtiene la configuración base de un cliente.
 */
export const getClientConfig = async (clientId) => {
    console.log(`(DB Service) Buscando config para cliente: ${clientId}`);
    try {
        const { data, error } = await supabase
            .from('clients') // Usar nombre en minúsculas
            .select('client_id, client_name, base_prompt, knowledge_config')
            .eq('client_id', clientId)
            .maybeSingle();

        if (error) throw error;

        if (data) {
            console.log(`(DB Service) Configuración encontrada para cliente ${clientId}.`);
        } else {
            console.warn(`(DB Service) No se encontró configuración para el cliente ${clientId}.`);
        }
        return data;
    } catch (error) {
        console.error(`(DB Service) Error al obtener config del cliente ${clientId}:`, error.message);
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
            .from('messages') // Usar nombre en minúsculas
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
            .from('messages') // Usar nombre en minúsculas
            .insert({
                conversation_id: conversationId,
                sender: sender,
                content: textContent
            });

        if (error) throw error;
        console.log(`(DB Service) Mensaje guardado para ${conversationId}.`);
        // TODO (Opcional): Actualizar Conversations.last_message_at si es necesario (trigger en Supabase es buena opción)

    } catch (error) {
        console.error(`(DB Service) Error al guardar mensaje para ${conversationId}:`, error.message);
    }
};

/**
 * Obtiene o crea una conversación. Devuelve el ID de la conversación.
 */
export const getOrCreateConversation = async (clientId) => {
    console.log(`(DB Service) Creando nueva conversación para cliente ${clientId}`); // Simplificado para siempre crear
    try {
        const { data, error } = await supabase
            .from('conversations') // Usar nombre en minúsculas
            .insert({ client_id: clientId })
            .select('conversation_id')
            .single();

        if (error) throw error;

        const createdId = data.conversation_id;
        console.log(`(DB Service) Nueva conversación creada con ID: ${createdId} para cliente ${clientId}`);
        return createdId;

    } catch (error) {
        console.error(`(DB Service) Error en getOrCreateConversation para cliente ${clientId}:`, error.message);
        throw error;
    }
};

/**
 * Realiza una búsqueda híbrida (vectorial + FTS) usando funciones RPC de Supabase.
 */
export const hybridSearch = async (clientId, query) => {
    console.log(`(DB Service) Iniciando búsqueda híbrida RPC para cliente ${clientId}, query: "${query.substring(0, 50)}..."`);

    try {
        // 1. Generar Embedding para la consulta
        const queryEmbedding = await getEmbedding(query);
        if (!queryEmbedding) {
            console.warn("(DB Service) No se pudo generar embedding para la consulta. Saltando búsqueda vectorial.");
            // Podríamos optar por solo hacer FTS si falla el embedding
            // Por ahora, devolvemos vacío si no hay embedding
            return [];
        }

        // 2. Ejecutar Búsquedas RPC en Paralelo
        console.log("(DB Service) Ejecutando RPCs vector_search y fts_search_with_rank en paralelo...");
        const [vectorResponse, ftsResponse] = await Promise.all([
            supabase.rpc('vector_search', { // RPC para búsqueda vectorial
                client_id_param: clientId,
                query_embedding: queryEmbedding,
                match_threshold: VECTOR_MATCH_THRESHOLD,
                match_count: HYBRID_SEARCH_LIMIT * 2 // Pedir un poco más para combinar mejor
            }),
            supabase.rpc('fts_search_with_rank', { // RPC para FTS con ranking
                client_id_param: clientId,
                query_param: query,
                match_count: HYBRID_SEARCH_LIMIT * 2 // Pedir un poco más para combinar mejor
            })
        ]);

        // Manejar errores de las RPC
        if (vectorResponse.error) {
            console.error("(DB Service) Error en RPC vector_search:", vectorResponse.error.message);
            // Podríamos continuar solo con FTS, pero por ahora devolvemos vacío si falla vector
            return [];
        }
        const vectorResults = vectorResponse.data || [];
        console.log(`(DB Service) Vector search (RPC) encontró ${vectorResults.length} resultados.`);

        if (ftsResponse.error) {
            console.error("(DB Service) Error en RPC fts_search_with_rank:", ftsResponse.error.message);
            // Si FTS falla, podemos continuar solo con los resultados vectoriales
            console.warn("(DB Service) FTS RPC falló, continuando solo con resultados vectoriales.");
            // return vectorResults.map(r => ({...r, hybrid_score: r.similarity * HYBRID_SEARCH_VECTOR_WEIGHT })).slice(0, HYBRID_SEARCH_LIMIT); // Opcional
        }
        const textResults = ftsResponse.data || []; // Usar array vacío si FTS falló
        console.log(`(DB Service) FTS search (RPC) encontró ${textResults.length} resultados.`);


        // 3. Combinar y Re-rankear Resultados
        const combinedResults = {};

        // Añadir resultados vectoriales (tienen 'similarity')
        vectorResults.forEach(row => {
            const id = row.id; // Asume que RPC devuelve 'id' tipo bigint
            if (!id) return;
            if (!combinedResults[id]) {
                combinedResults[id] = { ...row, vector_similarity: row.similarity || 0, fts_score: 0 };
            } else {
                combinedResults[id].vector_similarity = Math.max(combinedResults[id].vector_similarity, row.similarity || 0);
            }
        });

        // Añadir resultados FTS (tienen 'score')
        textResults.forEach(row => {
            const id = row.id; // Asume que RPC devuelve 'id' tipo bigint
            if (!id) return;
            const ftsScore = row.score || 0; // Score viene de la RPC
            if (!combinedResults[id]) {
                combinedResults[id] = { ...row, vector_similarity: 0, fts_score: ftsScore };
            } else {
                combinedResults[id].fts_score = Math.max(combinedResults[id].fts_score, ftsScore);
                // Copiar metadata/content si faltaba (si RPC no los devolvió en el primer hit)
                if (!combinedResults[id].content && row.content) combinedResults[id].content = row.content;
                if (!combinedResults[id].metadata && row.metadata) combinedResults[id].metadata = row.metadata;
            }
        });

        // Calcular score híbrido y ordenar
        const rankedResults = Object.values(combinedResults)
            .filter(item => item.id && item.content) // Asegurarse que tenemos datos básicos
            .map(item => ({
                ...item,
                // Fórmula de puntuación híbrida usando los pesos definidos
                hybrid_score: ((item.vector_similarity || 0) * HYBRID_SEARCH_VECTOR_WEIGHT) + ((item.fts_score || 0) * HYBRID_SEARCH_FTS_WEIGHT)
            }))
            .sort((a, b) => b.hybrid_score - a.hybrid_score) // Ordenar por mayor puntuación híbrida
            .slice(0, HYBRID_SEARCH_LIMIT); // Aplicar límite final

        console.log(`(DB Service) Búsqueda híbrida completada. Resultados finales: ${rankedResults.length}`);
        // console.log("Resultados Híbridos:", rankedResults.map(r => ({id: r.id, score: r.hybrid_score.toFixed(4), vector_sim: (r.vector_similarity || 0).toFixed(4), fts_score: (r.fts_score || 0).toFixed(4) }))); // Log para debug

        // Devolver solo las propiedades necesarias para el controlador
        // (content y metadata son las más importantes para el prompt)
        return rankedResults.map(r => ({
             id: r.id,
             content: r.content,
             metadata: r.metadata,
             // Opcional: devolver scores si quieres mostrarlos o usarlos después
             // similarity: r.vector_similarity,
             // fts_score: r.fts_score,
             // hybrid_score: r.hybrid_score
            }));

    } catch (error) {
        console.error(`(DB Service) Error general durante la búsqueda híbrida para cliente ${clientId}:`, error.message);
        return [];
    }
};

/**
 * Logs an AI resolution event.
 */
export const logAiResolution = async (clientId, conversationId, billingCycleId) => {
    console.log(`(DB Service) Logging AI resolution for Client: ${clientId}, Conv: ${conversationId}, Cycle: ${billingCycleId}`);
    try {
        const { error } = await supabase
            .from('ia_resolutions_log')
            .insert({
                client_id: clientId,
                conversation_id: conversationId,
                billing_cycle_id: billingCycleId
                // timestamp is expected to be handled by DB default
            });

        if (error) {
            console.error(`(DB Service) Error logging AI resolution:`, error.message);
            // For this task, just log it. Caller handles its own flow.
        } else {
            console.log(`(DB Service) AI resolution logged successfully for Client: ${clientId}, Conv: ${conversationId}.`);
        }
    } catch (err) {
        console.error(`(DB Service) Unexpected error in logAiResolution for Client: ${clientId}:`, err.message);
    }
};

// NO exportamos saveKnowledgeChunk desde aquí, se maneja en el script de ingesta.