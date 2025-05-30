// src/services/databaseService.js
import { supabase } from './supabaseClient.js'; // Importar cliente inicializado
import { getEmbedding } from './embeddingService.js'; // Necesario para búsqueda híbrida
import { getChatCompletion } from './openaiService.js'; // Import for query reformulation

// --- Configuración ---
const HYBRID_SEARCH_VECTOR_WEIGHT = 0.5;
const HYBRID_SEARCH_FTS_WEIGHT = 0.5;
const HYBRID_SEARCH_LIMIT = 5;
const INITIAL_RETRIEVAL_MULTIPLIER = 3;
const VECTOR_MATCH_THRESHOLD = 0.65; // Umbral de similitud coseno (0 a 1, más alto es más similar)
const HISTORY_MESSAGE_LIMIT = 8;       // Límite de mensajes de historial
const DEBUG_PREPROCESSING_DATABASE_SERVICE = false; // Separate debug flag for this service
const DEBUG_RERANKING = false; // Debug flag for re-ranking logic

// Re-ranking Weights
const W_ORIGINAL_HYBRID_SCORE = 0.6;
const W_KEYWORD_MATCH_SCORE = 0.3;
const W_METADATA_RELEVANCE_SCORE = 0.1;

// Simple Spanish Stop Words List (customize as needed)
const SPANISH_STOP_WORDS = new Set([
  "de", "la", "el", "en", "y", "a", "los", "las", "del", "un", "una", "unos", "unas",
  "ser", "estar", "haber", "tener", "con", "por", "para", "como", "más", "pero", "si",
  "no", "o", "qué", "que", "cuál", "cuando", "dónde", "quién", "cómo", "desde", "hasta",
  "sobre", "este", "ese", "aquel", "esto", "eso", "aquello", "mi", "tu", "su", "yo", "tú", "él", "ella",
  "nosotros", "vosotros", "ellos", "ellas", "me", "te", "se", "le", "les", "nos", "os"
]);


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
 * Fetches a sample of chunks for a given knowledge source.
 */
export const getChunkSampleForSource = async (clientId, sourceId, limit = 5) => {
    if (!clientId || !sourceId) {
        console.error("(DB Service) getChunkSampleForSource: clientId and sourceId are required.");
        throw new Error("Client ID and Source ID are required.");
    }
    console.log(`(DB Service) Fetching chunk sample for client ${clientId}, source ${sourceId}, limit ${limit}`);
    try {
        const { data, error } = await supabase
            .from('knowledge_base')
            .select('id, content, metadata') // 'id' is the chunk_id (primary key of knowledge_base)
            .eq('client_id', clientId)
            .eq('metadata->>original_source_id', sourceId)
            .order('id', { ascending: true }) // Order by chunk_id for consistent sampling
            .limit(limit);

        if (error) {
            console.error(`(DB Service) Error fetching chunk sample for source ${sourceId}, client ${clientId}:`, error.message);
            throw error;
        }
        return data || [];
    } catch (error) {
        console.error(`(DB Service) Exception in getChunkSampleForSource for source ${sourceId}, client ${clientId}:`, error.message);
        throw error; // Re-throw to be handled by controller
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
export const hybridSearch = async (clientId, queryText, conversationId, options = {}) => { // conversationId is not used here but kept for API consistency if needed later
    const finalVectorWeight = options.vectorWeight ?? HYBRID_SEARCH_VECTOR_WEIGHT;
    const finalFtsWeight = options.ftsWeight ?? HYBRID_SEARCH_FTS_WEIGHT;
    const finalVectorMatchThreshold = options.vectorMatchThreshold ?? VECTOR_MATCH_THRESHOLD;
    const finalLimit = HYBRID_SEARCH_LIMIT;
    const initialRetrieveLimit = finalLimit * INITIAL_RETRIEVAL_MULTIPLIER;

    const searchParamsForLog = {
        vectorWeight: finalVectorWeight,
        ftsWeight: finalFtsWeight,
        threshold: finalVectorMatchThreshold,
        initialLimit: initialRetrieveLimit,
        finalLimit: finalLimit
    };

    console.log(`(DB Service) Hybrid Search Parameters: originalQuery='${queryText.substring(0,50)}...', vectorWeight=${searchParamsForLog.vectorWeight}, ftsWeight=${searchParamsForLog.ftsWeight}, vectorMatchThreshold=${searchParamsForLog.threshold}, finalLimit=${searchParamsForLog.finalLimit}, initialRetrieveLimit=${searchParamsForLog.initialLimit}, clientId=${clientId}`);

    // Tokenize original query text once for re-ranking features
    const originalQueryTokens = tokenizeText(queryText, true); // true for stopword removal

    try {
        const processedQueryText = preprocessTextForEmbedding(queryText);
        if (DEBUG_PREPROCESSING_DATABASE_SERVICE && queryText !== processedQueryText) {
            console.log(`(DB Service DEBUG) Query Preprocessing:
Original Query: "${queryText.substring(0,100)}..."
Processed Query: "${processedQueryText.substring(0,100)}..."`);
        }

        // 1. Query Reformulation
        let allQueriesToEmbed = [processedQueryText];
        const reformulationPrompt = `Dada la siguiente pregunta de usuario en español: '${processedQueryText}', genera 1 o 2 reformulaciones alternativas que capturen la misma intención pero con diferentes palabras. Devuelve solo las reformulaciones, separadas por un salto de línea. No añadas numeración ni texto introductorio.`;
        const llmMessages = [
            { role: "system", content: "Eres un asistente útil que reformula preguntas." },
            { role: "user", content: reformulationPrompt }
        ];

        try {
            const reformulationResponse = await getChatCompletion(llmMessages, "gpt-3.5-turbo", 0.7);
            if (reformulationResponse) {
                const reformulated = reformulationResponse.split('\n').map(q => q.trim()).filter(q => q.length > 0);
                if (reformulated.length > 0) {
                    allQueriesToEmbed.push(...reformulated);
                    console.log(`(DB Service) Reformulated queries: ${reformulated.join(' | ')}`);
                }
            }
        } catch (llmError) {
            console.error("(DB Service) Error during query reformulation LLM call:", llmError.message);
            // Proceed with only the original processed query
        }

        // 2. Embedding Generation for All Queries
        const allEmbeddings = [];
        for (const q of allQueriesToEmbed) {
            const embedding = await getEmbedding(q);
            if (embedding) {
                allEmbeddings.push({ query: q, embedding: embedding });
            } else {
                console.warn(`(DB Service) No se pudo generar embedding para la consulta: "${q.substring(0,50)}..."`);
            }
        }

        if (allEmbeddings.length === 0) {
            console.warn("(DB Service) No se pudieron generar embeddings para ninguna consulta. Saltando búsqueda vectorial.");
            return [];
        }

        // 3. Vector Search for All Embeddings
        let allVectorResponses = [];
        for (const { query, embedding } of allEmbeddings) {
            const { data, error } = await supabase.rpc('vector_search', {
                client_id_param: clientId,
                query_embedding: embedding,
                match_threshold: finalVectorMatchThreshold,
                match_count: initialRetrieveLimit
            });
            if (error) {
                console.error(`(DB Service) Error en RPC vector_search para query "${query.substring(0,50)}...":`, error.message);
            } else {
                console.log(`(DB Service) Vector search for query "${query.substring(0,50)}..." returned ${data?.length || 0} results.`);
                if (data) allVectorResponses.push(...data);
            }
        }

        // 4. Combine and Deduplicate Vector Search Results
        const uniqueVectorResults = {};
        allVectorResponses.forEach(row => {
            if (!row.id || (row.similarity && row.similarity < finalVectorMatchThreshold)) return; // Ensure threshold is met
            const id = String(row.id);
            if (!uniqueVectorResults[id] || row.similarity > uniqueVectorResults[id].similarity) {
                uniqueVectorResults[id] = row;
            }
        });
        const vectorResults = Object.values(uniqueVectorResults);
        console.log(`(DB Service) Total unique vector results after combining ${allQueriesToEmbed.length} queries: ${vectorResults.length}`);

        // 5. FTS Search (uses original processedQueryText)
        const { data: ftsData, error: ftsError } = await supabase.rpc('fts_search_with_rank', {
            client_id_param: clientId,
            query_text: processedQueryText,
            match_count: initialRetrieveLimit
        });

        if (ftsError) console.error("(DB Service) Error en RPC fts_search_with_rank:", ftsError.message);
        const ftsResults = ftsData || [];
        console.log(`(DB Service) FTS search returned ${ftsResults.length} results.`);

        // 6. Merging Logic (existing logic should largely work)
        const combinedResults = {};
        vectorResults.forEach(row => {
            // This check is slightly redundant due to earlier filtering but kept for safety
            if (!row.id || (row.similarity && row.similarity < finalVectorMatchThreshold)) return;
            const id = String(row.id);
            combinedResults[id] = { ...row, vector_similarity: row.similarity || 0, fts_score: 0 };
        });
        ftsResults.forEach(row => {
            if (!row.id) return;
            const id = String(row.id);
            const ftsScore = row.rank || 0;
            if (!combinedResults[id]) {
                // Only add FTS result if it wasn't already part of a vector result that fell below threshold client-side
                // This implies that if a vector result was discarded client-side, its FTS counterpart can still be included if FTS score is high.
                // This behavior might need adjustment based on desired strictness.
                // For now, if it's a pure FTS match (not in vectorResults or vectorResults was below threshold), add it.
                combinedResults[id] = { ...row, vector_similarity: 0, fts_score: ftsScore };
            } else {
                combinedResults[id].fts_score = Math.max(combinedResults[id].fts_score || 0, ftsScore);
                if (!combinedResults[id].content && row.content) combinedResults[id].content = row.content;
                if (!combinedResults[id].metadata && row.metadata) combinedResults[id].metadata = row.metadata;
            }
        });

        const rankedResults = Object.values(combinedResults)
            .filter(item => item.id && item.content)
            .filter(item => { // This filter should ideally be after hybrid_score calculation or use raw scores
                if ((item.fts_score || 0) === 0 && (item.vector_similarity || 0) < finalVectorMatchThreshold) {
                    return false;
                }
                return true;
            })
            .map(item => ({
                ...item,
                hybrid_score: ((item.vector_similarity || 0) * finalVectorWeight) + ((item.fts_score || 0) * finalFtsWeight)
            }));

        // 7. Re-ranking Logic
        const rerankedList = initialRankedList.map(item => {
            const contentTokens = tokenizeText(item.content, true);
            const keywordMatchScore = calculateJaccardSimilarity(originalQueryTokens, contentTokens);

            let metadataRelevanceScore = 0;
            if (item.metadata?.hierarchy && Array.isArray(item.metadata.hierarchy)) {
                for (const h of item.metadata.hierarchy) {
                    if (h.text) {
                        const hierarchyTokens = tokenizeText(h.text, true);
                        if (hierarchyTokens.some(ht => originalQueryTokens.includes(ht))) {
                            metadataRelevanceScore = 0.5; // Simple bonus if any keyword matches
                            break;
                        }
                    }
                }
            }
            // Normalize hybrid_score if it's not already 0-1 (assuming it might be, e.g. sum of normalized scores)
            // For now, assume hybrid_score is on a comparable scale or roughly normalized.
            // If hybrid_score can be > 1 (e.g. fts_score is unbounded rank), normalization is crucial.
            // Let's assume for now it's somewhat normalized (e.g. vector_similarity is 0-1, fts_score is also scaled or normalized).
            // If fts_score is raw rank, this calculation will be skewed.
            // For this step, proceeding with the assumption that hybrid_score is usable as is.
            const reranked_score =
                ( (item.hybrid_score || 0) * W_ORIGINAL_HYBRID_SCORE) +
                (keywordMatchScore * W_KEYWORD_MATCH_SCORE) +
                (metadataRelevanceScore * W_METADATA_RELEVANCE_SCORE);

            return { ...item, keywordMatchScore, metadataRelevanceScore, reranked_score };
        });

        rerankedList.sort((a, b) => b.reranked_score - a.reranked_score);

        if (DEBUG_RERANKING) {
            console.log("(DB Service DEBUG) Top results after re-ranking:");
            rerankedList.slice(0, 5).forEach(r => {
                console.log(`  ID: ${r.id}, Original Hybrid: ${r.hybrid_score?.toFixed(4)}, Keyword: ${r.keywordMatchScore?.toFixed(4)}, Meta: ${r.metadataRelevanceScore?.toFixed(4)}, Reranked: ${r.reranked_score?.toFixed(4)}`);
                console.log(`    Content: ${r.content.substring(0,100)}...`);
            });
        }

        const finalResults = rerankedList.slice(0, finalLimit);
        const finalResultsMapped = finalResults.map(r => ({
            id: r.id,
            content: r.content,
            metadata: r.metadata,
            // Include scores if needed by the caller for context formatting, remove if not.
            // For RAG logging, we'll use the full rerankedList items before this final mapping.
            reranked_score: r.reranked_score,
            hybrid_score: r.hybrid_score,
            keywordMatchScore: r.keywordMatchScore,
            metadataRelevanceScore: r.metadataRelevanceScore
        }));


        console.log(`(DB Service) Búsqueda híbrida completada. Resultados finales después de re-ranking: ${finalResultsMapped.length}`);
        return {
            results: finalResultsMapped, // These are the top N results after re-ranking
            searchParams: searchParamsForLog,
            queriesEmbedded: allQueriesToEmbed, // List of query strings that were embedded
            rawRankedResultsForLog: rerankedList // Provide the full list before final slicing for logging purposes
        };
    } catch (error) {
        console.error(`(DB Service) Error general durante la búsqueda híbrida para cliente ${clientId}:`, error.message, error.stack);
        return { results: [], searchParams: searchParamsForLog, queriesEmbedded: [queryText], rawRankedResultsForLog: [] }; // Return empty results on error
    }
};

// --- Helper functions for Reranking ---
function tokenizeText(text, removeStopWords = false) {
    if (!text) return [];
    let tokens = text.toLowerCase().match(/\b[\w\u00C0-\u00FF]+\b/g) || []; // Basic alphanumeric, includes accented chars
    if (removeStopWords) {
        tokens = tokens.filter(token => !SPANISH_STOP_WORDS.has(token));
    }
    return tokens;
}

function calculateJaccardSimilarity(set1Tokens, set2Tokens) {
    if (!set1Tokens || !set2Tokens || set1Tokens.length === 0 || set2Tokens.length === 0) return 0;
    const set1 = new Set(set1Tokens);
    const set2 = new Set(set2Tokens);
    const intersection = new Set([...set1].filter(token => set2.has(token)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}


// --- Funciones de Preprocesamiento de Texto (Duplicated from ingestionService for now) ---
// TODO: Move to a shared utility file to avoid duplication.
const SPANISH_ABBREVIATIONS = {
    "p. ej.": "por ejemplo",
    "p.e.": "por ejemplo",
    "ej.": "ejemplo",
    "etc.": "etcétera",
    "sr.": "señor",
    "sra.": "señora",
    "dr.": "doctor",
    "dra.": "doctora",
    "ud.": "usted",
    "uds.": "ustedes",
    "fig.": "figura",
    "cap.": "capítulo",
    "aprox.": "aproximadamente",
};

function preprocessTextForEmbedding(text) {
    if (!text) return "";
    let processedText = text.normalize('NFC');
    processedText = processedText.toLowerCase();
    for (const [abbr, expansion] of Object.entries(SPANISH_ABBREVIATIONS)) {
        const escapedAbbr = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedAbbr}\\b`, 'gi');
        processedText = processedText.replace(regex, expansion);
    }
    processedText = processedText.replace(/([!?.,;:])\1+/g, '$1');
    processedText = processedText.replace(/\s\s+/g, ' ');
    processedText = processedText.trim();
    return processedText;
}
// --- End of Duplicated Preprocessing Functions ---

/**
 * Fetches minimal details for a conversation, primarily to get client_id.
 */
export const getConversationDetails = async (conversationId) => {
    if (!conversationId) {
        console.error("(DB Service) getConversationDetails: conversationId is required.");
        return null;
    }
    try {
        const { data, error } = await supabase
            .from('conversations')
            .select('client_id, conversation_id')
            .eq('conversation_id', conversationId)
            .single();

        if (error) {
            console.error(`(DB Service) Error fetching conversation details for ${conversationId}:`, error.message);
            return null;
        }
        return data;
    } catch (error) {
        console.error(`(DB Service) Exception in getConversationDetails for ${conversationId}:`, error.message);
        return null;
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


/**
 * Logs a RAG interaction event.
 */
export const logRagInteraction = async (logData) => {
    const {
        clientId,
        conversationId,
        userQuery,
        retrievedContext, // Expected to be an array of objects {id, content_preview, score, metadata}
        finalPromptToLlm,
        llmResponse,
        queryEmbeddingsUsed, // Expected to be an array of query strings
        vectorSearchParams,  // Expected to be an object
        wasEscalated
    } = logData;

    if (!clientId || !conversationId) {
        console.error("(DB Service) logRagInteraction: clientId and conversationId are required.");
        return;
    }

    try {
        const { error } = await supabase
            .from('rag_interaction_logs')
            .insert({
                client_id: clientId,
                conversation_id: conversationId,
                user_query: userQuery,
                retrieved_context: retrievedContext, // Supabase client handles JSONB stringification
                final_prompt_to_llm: finalPromptToLlm,
                llm_response: llmResponse,
                query_embeddings_used: queryEmbeddingsUsed, // Array of strings
                vector_search_params: vectorSearchParams, // Object
                was_escalated: wasEscalated
            });

        if (error) {
            console.error(`(DB Service) Error logging RAG interaction for CV:${conversationId}, C:${clientId}:`, error.message, error.details);
        } else {
            console.log(`(DB Service) RAG interaction logged for CV:${conversationId}, C:${clientId}.`);
        }
    } catch (err) {
        console.error(`(DB Service) Unexpected error in logRagInteraction for CV:${conversationId}, C:${clientId}:`, err.message);
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

