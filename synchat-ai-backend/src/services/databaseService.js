// Archivo: src/services/databaseService.js

import logger from '../utils/logger.js';
import { supabase } from './supabaseClient.js';
import { getEmbedding } from './embeddingService.js';
import { getChatCompletion } from './openaiService.js';

// --- BEGIN RERANKER CONFIG ---
const ENABLE_API_RERANKING = true;
const RERANKER_TIMEOUT_MS = 4000;
// --- END RERANKER CONFIG ---

const ENABLE_CROSS_ENCODER = false; // ¡Cambia esto a false para la prueba!

// Hardcoded Spanish Thesaurus for query expansion
const THESAURUS_ES = {
    "precio": ["costo", "tarifa", "valor", "importe"],
    "soporte": ["ayuda", "asistencia", "atención", "apoyo"],
    "problema": ["inconveniente", "error", "falla", "incidencia", "dificultad"],
    "solución": ["respuesta", "resolución", "arreglo"],
    "documento": ["archivo", "informe", "texto", "guía", "manual"],
    "buscar": ["encontrar", "localizar", "consultar", "ubicar"],
    "empezar": ["iniciar", "comenzar", "configurar", "arrancar"],
    "cómo": ["manera", "forma", "modo", "instrucciones"],
    "información": ["detalles", "datos", "especificaciones"],
    "plan": ["suscripción", "membresía", "tarifa", "modelo"],
    "pago": ["facturación", "cobro", "transacción", "abonar"],
    "cuenta": ["perfil", "usuario", "registro", "credenciales"],
    "cancelar": ["anular", "dar de baja", "suspender", "rescindir"],
    "contraseña": ["clave", "acceso", "password", "pin"],
    "límite": ["restricción", "tope", "cuota", "capacidad"],
    "característica": ["función", "funcionalidad", "opción", "capacidad"],
    "guía": ["tutorial", "manual", "documentación", "instructivo"],
    "integración": ["conectar", "sincronizar", "vincular", "enlazar"],
    "configurar": ["ajustar", "personalizar", "establecer"],
    "ejemplo": ["caso", "muestra", "ilustración"]
};

// Hardcoded Spanish Acronym/Abbreviation Dictionary for query expansion
const ACRONYMS_ES = {
    "IA": "Inteligencia Artificial",
    "CRM": "Customer Relationship Management",
    "FAQ": "Preguntas Frecuentes",
    "API": "Application Programming Interface",
    "SDK": "Software Development Kit",
    "KPI": "Key Performance Indicator"
};

// --- Configuración ---
const HYBRID_SEARCH_VECTOR_WEIGHT = 0.5;
const HYBRID_SEARCH_FTS_WEIGHT = 0.5;
const HYBRID_SEARCH_LIMIT = 5;
const INITIAL_RETRIEVAL_MULTIPLIER = 3;
const VECTOR_MATCH_THRESHOLD = 0.45;
const HISTORY_MESSAGE_LIMIT = 8;

const PROPOSITION_SEARCH_LIMIT = 3;
const PROPOSITION_MATCH_THRESHOLD = 0.60;
const DEBUG_PREPROCESSING_DATABASE_SERVICE = false;
const DEBUG_RERANKING = false;

// Cross-Encoder Configuration
const CROSS_ENCODER_TOP_K = 20;

// Query Correction Configuration
const ENABLE_ADVANCED_QUERY_CORRECTION = process.env.ENABLE_ADVANCED_QUERY_CORRECTION === 'true' || true;
const QUERY_CORRECTION_MODEL = "gpt-3.5-turbo";
const QUERY_CORRECTION_TEMP = 0.1;

// Define weights for the final re-ranking formula
const W_ORIGINAL_HYBRID_SCORE_ADJ = 0.20;
const W_CROSS_ENCODER_SCORE_ADJ = 0.30;
const W_KEYWORD_MATCH_SCORE_ADJ = 0.10;
const W_METADATA_RELEVANCE_SCORE_ADJ = 0.10;
const W_RECENCY_SCORE = 0.10;
const W_SOURCE_AUTHORITY_SCORE = 0.10;
const W_CHUNK_FEEDBACK_SCORE = 0.10;

// Simple Spanish Stop Words List
const SPANISH_STOP_WORDS = new Set([
  "de", "la", "el", "en", "y", "a", "los", "las", "del", "un", "una", "unos", "unas",
  "ser", "estar", "haber", "tener", "con", "por", "para", "como", "más", "pero", "si",
  "no", "o", "qué", "que", "cuál", "cuando", "dónde", "quién", "cómo", "desde", "hasta",
  "sobre", "este", "ese", "aquel", "esto", "eso", "aquello", "mi", "tu", "su", "yo", "tú", "él", "ella",
  "nosotros", "vosotros", "ellos", "ellas", "me", "te", "se", "le", "les", "nos", "os"
]);

// --- Cache (Simple en Memoria) ---
const questionCache = new Map();
export function getCache(key) { /* ... Tu código de caché ... */ }
export function setCache(key, value) { /* ... Tu código de caché ... */ }


export const getClientConfig = async (clientId) => {
    try {
        logger.debug(`(DB Service) getClientConfig: Buscando cliente con ID: ${clientId}`);
        const { data, error } = await supabase
            .from('synchat_clients')
            .select('client_id, widget_config, knowledge_source_url, base_prompt_override, created_at, updated_at, subscription_id, subscription_status, billing_cycle_id')
            .eq('client_id', clientId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                logger.warn(`(DB Service) getClientConfig: Cliente no encontrado con ID: ${clientId}. Error: ${error.message}`);
                return null;
            }
            logger.error(`(DB Service) Error fetching client config for ID ${clientId}:`, error);
            throw error;
        }
        logger.debug(`(DB Service) getClientConfig: Datos encontrados para cliente ${clientId}: ${data ? 'Sí' : 'No'}`);
        return data;
    } catch (err) {
        logger.error(`(DB Service) Unexpected exception fetching client config for ID ${clientId}:`, err);
        throw err;
    }
};

export const getResolutionsCount = async (clientId) => {
    logger.debug(`(DB Service) getResolutionsCount: Counting resolutions for client ${clientId}`);

    if (!clientId) {
        logger.error('(DB Service) getResolutionsCount: clientId is required.');
        throw new Error('clientId is required for getResolutionsCount.');
    }

    try {
        const { count, error } = await supabase
            .from('ia_resolutions_log')
            .select('*', { count: 'exact', head: true }) // Select any column, count is what matters
            .eq('client_id', clientId);

        if (error) {
            logger.error(`(DB Service) getResolutionsCount: Error counting resolutions for client ${clientId}: ${error.message}`, error);
            throw new Error(`Failed to count resolutions: ${error.message}`);
        }

        logger.debug(`(DB Service) getResolutionsCount: Found ${count} resolutions for client ${clientId}.`);
        return count === null ? 0 : count; // Supabase returns null for count if no rows match with head:true
    } catch (err) {
        // Errors from the try block or re-thrown Supabase errors
        logger.error(`(DB Service) getResolutionsCount: Unexpected exception for client ${clientId}: ${err.message}`, err);
        // Re-throw if it's not already a thrown error from above, or to ensure consistent error type if desired.
        // For now, just rethrowing the caught error.
        throw err;
    }
};

// --- INICIO DE LA CORRECCIÓN #2: IMPLEMENTACIÓN DE getConversationHistory ---
export const getConversationHistory = async (conversationId) => {
    if (!conversationId) {
        logger.warn('(DB Service) getConversationHistory: se necesita un conversationId.');
        return []; // Devuelve un array vacío si no hay ID
    }
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('sender, content')
            .eq('conversation_id', conversationId)
            .order('timestamp', { ascending: false }) // Obtenemos los más recientes
            .limit(HISTORY_MESSAGE_LIMIT);

        if (error) {
            logger.error(`(DB Service) Error al obtener el historial de la conversación para CV:${conversationId}`, error);
            return []; // Devuelve array vacío en caso de error
        }

        // Los mensajes vienen en orden descendente, los invertimos para que el orden sea cronológico
        return data ? data.reverse() : [];
        
    } catch (err) {
        logger.error(`(DB Service) Excepción en getConversationHistory para CV:${conversationId}`, err);
        return []; // Devuelve un array vacío en caso de excepción
    }
};
// --- FIN DE LA CORRECCIÓN #2 ---

export const saveMessage = async (conversationId, sender, textContent, ragInteractionRef = null) => {
    if (!conversationId || !sender || typeof textContent !== 'string') {
        logger.warn('(DB Service) Invalid parameters for saveMessage.');
        return { error: 'Invalid parameters: conversationId, sender, and textContent are required.' };
    }

    const messageData = {
        conversation_id: conversationId,
        sender: sender,
        content: textContent,
        sentiment: null
    };

    if (ragInteractionRef) {
        messageData.rag_interaction_ref = ragInteractionRef;
    }

    if (sender === 'user' && textContent && textContent.trim() !== '') {
        try {
            logger.debug(`(DB Service) Performing sentiment analysis for message content: "${textContent.substring(0, 50)}..."`);
            const systemPrompt = "Classify the sentiment of the following user message as positive, negative, or neutral. Respond with only one word: positive, negative, or neutral.";
            const userMessageForSentiment = `Message: "${textContent}"`;

            const sentimentResponse = await getChatCompletion(
                [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessageForSentiment }],
                'gpt-3.5-turbo',
                0.2,
                10
            );

            if (sentimentResponse) {
                let rawSentiment = sentimentResponse.trim().toLowerCase();
                if (rawSentiment.startsWith("sentiment:")) {
                    rawSentiment = rawSentiment.substring("sentiment:".length).trim();
                }
                rawSentiment = rawSentiment.replace(/[.,!?;]$/, '');

                if (['positive', 'negative', 'neutral'].includes(rawSentiment)) {
                    messageData.sentiment = rawSentiment;
                    logger.debug(`(DB Service) Sentiment classified as: ${rawSentiment}`);
                } else {
                    logger.warn(`(DB Service) Unexpected sentiment response: "${sentimentResponse}". Original message: "${textContent.substring(0,50)}..."`);
                }
            } else {
                logger.warn(`(DB Service) Sentiment analysis returned no response. Original message: "${textContent.substring(0,50)}..."`);
            }
        } catch (sentimentError) {
            logger.error('(DB Service) Error getting sentiment for message:', { error: sentimentError, messageContent: textContent.substring(0,50) });
        }
    }

    try {
        const { data, error } = await supabase
            .from('messages')
            .insert([messageData])
            .select()
            .single();

        if (error) {
            logger.error('(DB Service) Error saving message:', error);
            return { error: error.message };
        }
        logger.info(`(DB Service) Message saved successfully with ID: ${data?.message_id}, Sentiment: ${messageData.sentiment}`);
        return { data };

    } catch (err) {
        logger.error('(DB Service) General exception in saveMessage:', err);
        return { error: 'An unexpected error occurred while saving the message.' };
    }
};

export const getClientKnowledgeCategories = async (clientId) => {
    if (!clientId) {
        logger.warn('(DB Service) getClientKnowledgeCategories: clientId is required.');
        return { data: [], error: 'Client ID is required.' };
    }
    try {
        const { data, error } = await supabase
            .from('knowledge_sources')
            .select('category_tags')
            .eq('client_id', clientId)
            .not('category_tags', 'is', null);

        if (error) {
            logger.error(`(DB Service) Error fetching category_tags for client ${clientId}:`, error);
            return { data: [], error: error.message };
        }

        const uniqueCategories = new Set();
        if (data) {
            data.forEach(source => {
                if (Array.isArray(source.category_tags)) {
                    source.category_tags.forEach(tag => {
                        if (tag && typeof tag === 'string') {
                            uniqueCategories.add(tag.trim());
                        }
                    });
                }
            });
        }
        return { data: Array.from(uniqueCategories), error: null };
    } catch (err) {
        logger.error(`(DB Service) Exception in getClientKnowledgeCategories for client ${clientId}:`, err);
        return { data: [], error: 'An unexpected error occurred.' };
    }
};

export const createConversation = async (clientId) => {
    if (!clientId) {
        logger.error('(DB Service) createConversation: clientId is required.');
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('conversations')
            .insert([{
                client_id: clientId,
                status: 'open'
            }])
            .select('conversation_id')
            .single();

        if (error) {
            logger.error('(DB Service) Error creating conversation in Supabase:', error);
            return null;
        }

        if (!data || !data.conversation_id) {
            logger.error('(DB Service) Conversation created but no conversation_id returned from Supabase.');
            return null;
        }

        logger.info(`(DB Service) Conversation created successfully for client ${clientId} with ID: ${data.conversation_id}`);
        return data.conversation_id;

    } catch (err) {
        logger.error('(DB Service) Unexpected exception in createConversation:', err);
        return null;
    }
};

export const hybridSearch = async (clientId, queryText, conversationId, options = {}, returnPipelineDetails = false) => {
    // --- NUEVA VALIDACIÓN INICIAL ---
    if (!queryText || typeof queryText !== 'string' || queryText.trim() === '') {
        logger.warn(`(DB Service) hybridSearch fue llamado con una consulta vacía o inválida para el cliente ${clientId}`);
        // Devolver una estructura vacía pero válida para no causar un crash en el controlador
        return {
            results: [],
            propositionResults: [],
            searchParams: {},
            queriesEmbeddedForLog: [],
            predictedCategory: null
        };
    }
    // --- FIN DE LA NUEVA VALIDACIÓN ---

    const originalUserQueryAtStart = queryText;
    let currentQueryText = originalUserQueryAtStart;
    let predictedCategory = null;

    let queryCorrectionDetails = {
        attempted: false,
        originalQuery: originalUserQueryAtStart,
        correctedQuery: originalUserQueryAtStart,
        wasChanged: false
    };

    if (ENABLE_ADVANCED_QUERY_CORRECTION) {
        queryCorrectionDetails.attempted = true;
        try {
            const correctionMessages = [
                { role: "system", content: "Eres un asistente de IA experto en español. Tu tarea es corregir errores ortográficos y gramaticales en la consulta del usuario, y reformularla ligeramente para mayor claridad si es necesario, pero DEBES preservar estrictamente la intención original y el significado clave de la consulta. Devuelve únicamente la consulta corregida. Si la consulta ya es perfecta y no necesita cambios, devuélvela tal cual. No añadas comentarios ni explicaciones adicionales." },
                { role: "user", content: `Consulta Original: "${originalUserQueryAtStart}"\nConsulta Corregida:` }
            ];
            const llmCorrectedQuery = await getChatCompletion(
                correctionMessages,
                QUERY_CORRECTION_MODEL,
                QUERY_CORRECTION_TEMP,
                Math.floor(originalUserQueryAtStart.length * 1.5) + 30
            );

            if (llmCorrectedQuery && llmCorrectedQuery.trim().length > 0) {
                const trimmedLlmQuery = llmCorrectedQuery.trim();
                queryCorrectionDetails.correctedQuery = trimmedLlmQuery;
                queryCorrectionDetails.wasChanged = originalUserQueryAtStart !== trimmedLlmQuery;
                currentQueryText = trimmedLlmQuery;
                logger.info(`(DB Service) Query Correction: Original='${originalUserQueryAtStart}', Corrected='${currentQueryText}'`);
            } else {
                logger.warn("(DB Service) Query correction LLM call returned empty or invalid. Using original query.");
            }
        } catch (error) {
            logger.error("(DB Service) Error during query correction LLM call:", { message: error.message, originalQuery: originalUserQueryAtStart });
        }
    }

    const finalVectorWeight = options.vectorWeight ?? HYBRID_SEARCH_VECTOR_WEIGHT;
    const finalFtsWeight = options.ftsWeight ?? HYBRID_SEARCH_FTS_WEIGHT;

    let adjustedVectorWeight = finalVectorWeight;
    let adjustedFtsWeight = finalFtsWeight;

    const queryTokens = currentQueryText.toLowerCase().split(' ');
    const hasQuotedPhrase = new RegExp("\"[^\"]+\"").test(currentQueryText);
    const capitalLettersCount = (currentQueryText.match(/[A-Z]/g) || []).length;
    const hasManyCapitals = capitalLettersCount > 3;

    let adjustmentReason = "default";

    if (hasQuotedPhrase || hasManyCapitals) {
        adjustedFtsWeight = Math.min(1.0, finalFtsWeight + 0.15);
        adjustedVectorWeight = 1.0 - adjustedFtsWeight;
        adjustmentReason = hasQuotedPhrase ? "quoted_phrase" : (hasManyCapitals ? "many_capitals" : "fts_boost");
    } else if (queryTokens.length < 3 && queryTokens.length > 0) {
        adjustedFtsWeight = Math.min(1.0, finalFtsWeight + 0.1);
        adjustedVectorWeight = 1.0 - adjustedFtsWeight;
        adjustmentReason = "short_query";
    }

    logger.info(`(DB Service) Hybrid Search: Query: "${currentQueryText.substring(0,50)}...", Original Weights: V=${finalVectorWeight.toFixed(2)}, F=${finalFtsWeight.toFixed(2)}. Adjusted Weights (Reason: ${adjustmentReason}): V=${adjustedVectorWeight.toFixed(2)}, F=${adjustedFtsWeight.toFixed(2)}`);

    const finalVectorMatchThreshold = options.vectorMatchThreshold ?? VECTOR_MATCH_THRESHOLD;
    const finalLimit = HYBRID_SEARCH_LIMIT;
    const initialRetrieveLimit = finalLimit * INITIAL_RETRIEVAL_MULTIPLIER;

    let pipelineDetails = null;
    if (returnPipelineDetails) {
        pipelineDetails = {
            originalQuery: originalUserQueryAtStart,
            queryCorrection: queryCorrectionDetails,
            queryDecomposition: {},
            processedQueries: [],
            aggregatedResults: { uniqueVectorResultsPreview: [], uniqueFtsResultsPreview: [] },
            mergedAndPreRankedResultsPreview: [],
            crossEncoderProcessing: { inputs: [], outputs: [] },
            finalRankedResultsForPlayground: [],
            finalPropositionResults: [],
            queryClassification: { predictedCategory: null, categoriesAvailable: [] }
        };
    }
    
    // El resto de la función `hybridSearch` continúa aquí...
    // ...

    // Query Correction Logic (existing)
    if (ENABLE_ADVANCED_QUERY_CORRECTION && originalUserQueryAtStart && originalUserQueryAtStart.trim().length > 0) {
        queryCorrectionDetails.attempted = true;
        try {
            const correctionMessages = [
                { role: "system", content: "Eres un asistente de IA experto en español. Tu tarea es corregir errores ortográficos y gramaticales en la consulta del usuario, y reformularla ligeramente para mayor claridad si es necesario, pero DEBES preservar estrictamente la intención original y el significado clave de la consulta. Devuelve únicamente la consulta corregida. Si la consulta ya es perfecta y no necesita cambios, devuélvela tal cual. No añadas comentarios ni explicaciones adicionales." },
                { role: "user", content: `Consulta Original: "${originalUserQueryAtStart}"\nConsulta Corregida:` }
            ];
            const llmCorrectedQuery = await getChatCompletion(
                correctionMessages,
                QUERY_CORRECTION_MODEL,
                QUERY_CORRECTION_TEMP,
                Math.floor(originalUserQueryAtStart.length * 1.5) + 30
            );

            if (llmCorrectedQuery && llmCorrectedQuery.trim().length > 0) {
                const trimmedLlmQuery = llmCorrectedQuery.trim();
                queryCorrectionDetails.correctedQuery = trimmedLlmQuery;
                queryCorrectionDetails.wasChanged = originalUserQueryAtStart !== trimmedLlmQuery;
                currentQueryText = trimmedLlmQuery;
                logger.info(`(DB Service) Query Correction: Original='${originalUserQueryAtStart}', Corrected='${currentQueryText}'`);
            } else {
                logger.warn("(DB Service) Query correction LLM call returned empty or invalid. Using original query.");
            }
        } catch (error) {
            logger.error("(DB Service) Error during query correction LLM call:", { message: error.message, originalQuery: originalUserQueryAtStart });
        }
    }
    if (returnPipelineDetails) {
        pipelineDetails.queryCorrection = queryCorrectionDetails; // Ensure this is updated after correction attempt
    }

    // --- Query Classification Logic ---
    let clientCategoriesArray = [];
    try {
        const { data: categories, error: catError } = await getClientKnowledgeCategories(clientId);
        if (catError) {
            logger.warn(`(DB Service) Error fetching client knowledge categories for client ${clientId}: ${catError.message}. Proceeding without classification.`);
        } else if (categories && categories.length > 0) {
            clientCategoriesArray = categories;
            if (returnPipelineDetails) {
                pipelineDetails.queryClassification.categoriesAvailable = clientCategoriesArray;
            }

            const systemPrompt = `You are an expert query classifier. Your task is to classify the user's query into ONE of the following predefined categories. Respond with ONLY the category name from the list. If no category is a good fit or the query is too generic, respond with "None".

Available Categories:
${clientCategoriesArray.join('\n')}

User Query: "${currentQueryText}"

Classification:`;

            const llmClassification = await getChatCompletion(
                [{ role: 'system', content: systemPrompt }], // User prompt is part of system for this simple classification
                'gpt-3.5-turbo', 0.2, 15
            );

            if (llmClassification && llmClassification.trim().length > 0) {
                const trimmedClassification = llmClassification.trim();
                if (clientCategoriesArray.includes(trimmedClassification)) {
                    predictedCategory = trimmedClassification;
                    logger.info(`(DB Service) Query classified for client ${clientId}. Query: "${currentQueryText.substring(0,30)}...", Category: ${predictedCategory}`);
                } else if (trimmedClassification.toLowerCase() === 'none') {
                    predictedCategory = null; // Or a special "None_Predicted" value
                    logger.info(`(DB Service) Query classification for client ${clientId} resulted in "None". Query: "${currentQueryText.substring(0,30)}..."`);
                } else {
                    logger.warn(`(DB Service) LLM returned an unlisted category: "${trimmedClassification}" for client ${clientId}. Query: "${currentQueryText.substring(0,30)}...". Treating as unclassified.`);
                    predictedCategory = null;
                }
            } else {
                logger.warn(`(DB Service) Query classification LLM call returned empty or invalid for client ${clientId}. Query: "${currentQueryText.substring(0,30)}..."`);
            }
        } else {
            logger.info(`(DB Service) No categories defined for client ${clientId}. Skipping query classification.`);
        }
    } catch (classificationError) {
        logger.error(`(DB Service) Error during query classification process for client ${clientId}: ${classificationError.message}`);
    }
    if (returnPipelineDetails) {
        pipelineDetails.queryClassification.predictedCategory = predictedCategory;
    }
    // --- End Query Classification Logic ---

    const searchParamsForLog = {
        vectorWeight: adjustedVectorWeight, // Log adjusted weight
        ftsWeight: adjustedFtsWeight,     // Log adjusted weight
        threshold: finalVectorMatchThreshold,
        finalLimit: finalLimit,
        initialLimit: initialRetrieveLimit,
        predicted_category_applied: (predictedCategory && predictedCategory.toLowerCase() !== 'none') ? predictedCategory : null
    };
    logger.debug(`(DB Service) Hybrid Search Parameters: Effective Query='${currentQueryText.substring(0,50)}...', vectorWeight=${searchParamsForLog.vectorWeight}, ftsWeight=${searchParamsForLog.ftsWeight}, vectorMatchThreshold=${searchParamsForLog.threshold}, finalLimit=${searchParamsForLog.finalLimit}, initialRetrieveLimit=${searchParamsForLog.initialLimit}, clientId=${clientId}, categoryFilter='${searchParamsForLog.predicted_category_applied}'`);

    // Tokenize the *corrected* query text for subsequent Jaccard similarity etc.
    const correctedQueryTokens = tokenizeText(currentQueryText, true);

    try {
        let queriesToProcess = [currentQueryText];
        let wasDecomposedForLog = false;
        let subQueriesForLog = [];

        // Query Decomposition uses the *corrected* query text
        if (currentQueryText.split(/\s+/).length > 5) { // Simple heuristic to avoid decomposing very short queries
            try {
                const decompositionPrompt = `Analiza la siguiente pregunta de usuario EN ESPAÑOL: '${currentQueryText}'. Si contiene múltiples sub-preguntas distintas que deberían responderse por separado para una respuesta completa, divídela en esas sub-preguntas individuales. Devuelve ÚNICAMENTE la lista de sub-preguntas, CADA UNA EN UNA NUEVA LÍNEA y OBLIGATORIAMENTE EN ESPAÑOL. Si es una pregunta simple y única, devuelve solo la pregunta original EN ESPAÑOL. No traduzcas al inglés.`;
                const decompositionMessages = [ { role: "system", content: "You are an AI assistant that analyzes user questions..." }, { role: "user", content: decompositionPrompt } ];
                const decompositionResponse = await getChatCompletion(decompositionMessages, "gpt-3.5-turbo", 0.3);
                if (decompositionResponse) {
                    const subQueries = decompositionResponse.split('\n').map(q => q.trim()).filter(q => q.length > 0);
                    if (subQueries.length > 1 || (subQueries.length === 1 && subQueries[0].toLowerCase() !== currentQueryText.toLowerCase())) {
                        queriesToProcess = subQueries; wasDecomposedForLog = true; subQueriesForLog = [...subQueries];
                        logger.info(`(DB Service) Corrected Query decomposed into ${subQueries.length} sub-queries:`, subQueries);
                    } else { queriesToProcess = [currentQueryText]; }
                }
            } catch (decompositionError) { logger.error("(DB Service) Error during query decomposition:", { message: decompositionError.message, query: currentQueryText }); queriesToProcess = [currentQueryText]; }
        }

        if (returnPipelineDetails) {
            pipelineDetails.queryDecomposition = { wasDecomposed: wasDecomposedForLog, subQueries: subQueriesForLog, finalQueriesProcessed: queriesToProcess };
        }

        // --- Acronym Expansion ---
        // Iterates through each query in the current list (which might be from decomposition or just the corrected original query).
        // Expands known acronyms found in each query string.
        const queriesForAcronymExpansion = [...queriesToProcess]; // Create a copy to iterate over while modifying the main list indirectly
        const queriesPostAcronymExpansion = []; // Store results of this stage

        for (const queryToExpand of queriesForAcronymExpansion) {
            let currentQueryWithAcronyms = queryToExpand; // The query string being processed in this iteration
            let anAcronymWasExpanded = false; // Flag to log only if an expansion occurred for this query

            // Check each known acronym
            for (const acronym in ACRONYMS_ES) {
                if (ACRONYMS_ES.hasOwnProperty(acronym)) {
                    const regex = new RegExp(`\\b${acronym}\\b`, 'g'); // Match whole word acronym
                    if (currentQueryWithAcronyms.match(regex)) {
                        currentQueryWithAcronyms = currentQueryWithAcronyms.replace(regex, `${acronym} (${ACRONYMS_ES[acronym]})`);
                        anAcronymWasExpanded = true;
                    }
                }
            }

            if (anAcronymWasExpanded) {
                logger.info(`(DB Service) Query after acronym expansion: "${currentQueryWithAcronyms.substring(0,100)}..." (Original segment: "${queryToExpand.substring(0,100)}...")`);
            }
            queriesPostAcronymExpansion.push(currentQueryWithAcronyms);
        }
        queriesToProcess = queriesPostAcronymExpansion; // Update queriesToProcess with (potentially) acronym-expanded queries

        // --- Synonym Expansion (for Vector Search Query Variations) ---
        // Takes each query (now acronym-expanded) and generates a limited number of variations
        // by replacing keywords with their first listed synonym. These variations are intended
        // for generating separate embeddings to broaden vector search.
        const queriesReadyForSynonymExpansion = [...queriesToProcess];
        const queriesIncludingSynonymVariations = [];
        const MAX_SYNONYM_VARIATIONS_PER_BASE_QUERY = 2; // Max variations to generate per single base query. Balances broadening search with embedding cost.

        for (const baseQuery of queriesReadyForSynonymExpansion) {
            queriesIncludingSynonymVariations.push(baseQuery); // Always include the base query itself

            const keywordsInBase = tokenizeText(baseQuery, true); // Significant keywords from the base query
            let variationsAddedForThisBase = 0;

            for (const keyword of keywordsInBase) {
                if (variationsAddedForThisBase >= MAX_SYNONYM_VARIATIONS_PER_BASE_QUERY) {
                    break; // Reached max variations for this particular baseQuery
                }
                if (THESAURUS_ES[keyword] && THESAURUS_ES[keyword].length > 0) {
                    const firstSynonym = THESAURUS_ES[keyword][0]; // Using only the first synonym for simplicity and control

                    // Create a new variation by replacing only the current keyword in the baseQuery
                    // This helps maintain the context of other words in the query.
                    const regex = new RegExp(`\\b${keyword}\\b`); // Match whole word
                    const newQuerySynonymVariation = baseQuery.replace(regex, firstSynonym);

                    // Add the new variation if it's genuinely different and not already added
                    // (e.g. if baseQuery didn't actually contain the keyword, or synonym is identical)
                    if (newQuerySynonymVariation !== baseQuery && !queriesIncludingSynonymVariations.includes(newQuerySynonymVariation)) {
                        queriesIncludingSynonymVariations.push(newQuerySynonymVariation);
                        variationsAddedForThisBase++;
                        logger.info(`(DB Service) Synonym variation for vector search: "${newQuerySynonymVariation.substring(0,100)}...", Keyword: "${keyword}", Synonym: "${firstSynonym}"`);
                    }
                }
            }
        }
        queriesToProcess = queriesIncludingSynonymVariations; // Final list of queries (originals + variations) to process in the main search loop

        if (returnPipelineDetails) {
            pipelineDetails.queryDecomposition.finalQueriesProcessed = [...queriesToProcess];
        }

        let aggregatedVectorResults = [];
        let aggregatedFtsResults = [];
        let aggregatedQueriesEmbeddedForLog = [];
        let firstProcessedQueryEmbedding = null;

        for (let idx = 0; idx < queriesToProcess.length; idx++) {
            const loopCurrentQuery = queriesToProcess[idx]; // This is either a sub-query or the (potentially corrected) main query

            // Ensure loopCurrentQuery is a string before processing
            if (typeof loopCurrentQuery !== 'string') {
                logger.warn(`(DB Service) hybridSearch: loopCurrentQuery at index ${idx} is not a string, skipping. Value: ${loopCurrentQuery}`);
                continue; // Skip this iteration
            }

            const processedQueryText = preprocessTextForEmbedding(loopCurrentQuery);

            let currentQueryPipelineDetailsRef = null;
            if (returnPipelineDetails) {
                const detailEntry = {
                    queryIdentifier: loopCurrentQuery.substring(0,75) + (loopCurrentQuery.length > 75 ? "..." : ""), // Safe now
                    preprocessingOutput: processedQueryText,
                    enhancements: [], vectorSearchResults: [], ftsResults: []
                };
                pipelineDetails.processedQueries.push(detailEntry);
                currentQueryPipelineDetailsRef = detailEntry;
            }

            const currentLoopEmbeddings = [];
            const originalSubQueryEmbedding = await getEmbedding(processedQueryText);
            if (originalSubQueryEmbedding) {
                currentLoopEmbeddings.push({ query: processedQueryText, embedding: originalSubQueryEmbedding });
                if (returnPipelineDetails) currentQueryPipelineDetailsRef.enhancements.push({ forQuery: processedQueryText, type: "Original_Query_Embedding", generatedTextOrIdentifier: processedQueryText, embeddingVectorPreview: "Generated" });
                if (idx === 0 && !firstProcessedQueryEmbedding) firstProcessedQueryEmbedding = originalSubQueryEmbedding;
            }

            if (!wasDecomposedForLog || queriesToProcess.length === 1) {
                try { // HyDE
                    const hydePrompt = `User Question: '${processedQueryText}'. Please generate a concise, factual paragraph...`; // Full prompt as before
                    const hydeMessages = [ { role: "system", content: "..." }, { role: "user", content: hydePrompt }];
                    const hypotheticalDocument = await getChatCompletion(hydeMessages, "gpt-3.5-turbo", 0.5);
                    if (hypotheticalDocument) {
                        const hydeEmbedding = await getEmbedding(hypotheticalDocument);
                        if (hydeEmbedding) {
                            const hydeId = `hyde_document_for_query_'${processedQueryText.substring(0,50)}...'`;
                            currentLoopEmbeddings.push({ query: hydeId, embedding: hydeEmbedding });
                            if (returnPipelineDetails) currentQueryPipelineDetailsRef.enhancements.push({ forQuery: processedQueryText, type: "HyDE_Document", generatedText: hypotheticalDocument, embeddingVectorPreview: "Generated" });
                        }
                    }
                } catch (hydeError) { logger.error("(DB Service) Error during HyDE:", { message: hydeError.message, query: processedQueryText }); }

                try { // Reformulation
                    const reformulationPrompt = `Dada la siguiente pregunta de usuario en español: '${processedQueryText}'...`; // Full prompt
                    const llmMessages = [ { role: "system", content: "..." }, { role: "user", content: reformulationPrompt }];
                    const reformulationResponse = await getChatCompletion(llmMessages, "gpt-3.5-turbo", 0.7);
                    if (reformulationResponse) {
                        const reformulatedQueries = reformulationResponse.split('\n').map(q => q.trim()).filter(q => q.length > 0);
                        for (const [rqIdx, rq] of reformulatedQueries.entries()) {
                            const rqEmbedding = await getEmbedding(rq);
                            if (rqEmbedding) {
                                currentLoopEmbeddings.push({ query: rq, embedding: rqEmbedding });
                                if (returnPipelineDetails) currentQueryPipelineDetailsRef.enhancements.push({ forQuery: processedQueryText, type: `Reformulation_${rqIdx+1}`, generatedText: rq, embeddingVectorPreview: "Generated" });
                            }
                        }
                    }
                } catch (llmError) { logger.error("(DB Service) Error during reformulation:", { message: llmError.message, query: processedQueryText }); }
            }
            currentLoopEmbeddings.forEach(emb => aggregatedQueriesEmbeddedForLog.push(emb.query));

            if (currentLoopEmbeddings.length > 0) {
                for (const { query: eqQuery, embedding: eqEmbedding } of currentLoopEmbeddings) {
                    // ... dentro de la función hybridSearch ...

// Objeto de parámetros para la llamada a la RPC
const rpcParamsVector = {
    client_id_param: clientId,
    query_embedding: eqEmbedding,
    match_threshold: finalVectorMatchThreshold,
    match_count: initialRetrieveLimit,
    p_category_filter: (predictedCategory && predictedCategory.toLowerCase() !== 'none') ? [predictedCategory] : null
    // SIN la línea 'ivfflat_probes_param: 10'
};
const { data: vsData, error: vsError } = await supabase.rpc('vector_search', rpcParamsVector);

// ...
                    if (vsError) { logger.error(`(DB Service) Vector search error for "${eqQuery.substring(0,50)}...":`, vsError.message); }
                    else if (vsData) {
                        aggregatedVectorResults.push(...vsData);
                        if (returnPipelineDetails) currentQueryPipelineDetailsRef.vectorSearchResults.push({ retrievedForQueryIdentifier: eqQuery, results: vsData.map(r => ({ id: r.id, contentSnippet: r.content?.substring(0,100)+'...', metadata: r.metadata, score: r.similarity })) });
                    }
                }
            }

    // FTS Query Preparation with Thesaurus (for the current loopCurrentQuery) ---
    // Tokenize the current query (which might be an original, an acronym-expanded version, or a synonym variation for vector search)
    // to get its significant terms for FTS.
    const significantTokensForFTS = tokenizeText(loopCurrentQuery, true);
    const ftsQueryParts = []; // Array to hold parts of the FTS query string

    for (const token of significantTokensForFTS) {
        if (THESAURUS_ES[token] && THESAURUS_ES[token].length > 0) {
            // If the token has synonyms, create an OR-group for FTS.
            // This includes the original token plus all its synonyms.
            // E.g., if token is "precio" and synonyms are ["costo", "tarifa"], part is "(precio | costo | tarifa)"
            const ftsTokenWithSynonyms = [token, ...THESAURUS_ES[token]];
            // Ensure uniqueness in case a token is listed as its own synonym (though not current practice)
            const uniqueFtsTerms = [...new Set(ftsTokenWithSynonyms)];
            ftsQueryParts.push(`(${uniqueFtsTerms.join(' | ')})`);
        } else {
            // If no synonyms, the token is used as is.
            ftsQueryParts.push(token);
        }
    }
    // Combine all parts with the FTS OR operator '|'
    // E.g., "(termA_expanded) | termB | (termC_expanded)"
    const ftsQueryString = loopCurrentQuery; // Pasar la sub-consulta en español directamente
logger.info(`(DB Service) FTS query text for loop (passed to RPC): "${ftsQueryString.substring(0,100)}..."`);
            // logger.info(...) // This log is already in place and describes the constructed string.

            const rpcParamsFts = {
                client_id_param: clientId,
        query_text: ftsQueryString, // Use the new ftsQueryString
                match_count: initialRetrieveLimit,
                p_category_filter: (predictedCategory && predictedCategory.toLowerCase() !== 'none') ? [predictedCategory] : null
            };
            const { data: ftsSubData, error: ftsSubError } = await supabase.rpc('fts_search_with_rank', rpcParamsFts);
    if (ftsSubError) { logger.error(`(DB Service) FTS error for query "${ftsQueryString.substring(0,50)}..." (based on loopCurrentQuery: "${loopCurrentQuery.substring(0,50)}..."):`, ftsSubError.message); }
            else if (ftsSubData) {
                aggregatedFtsResults.push(...ftsSubData);
        if (returnPipelineDetails) currentQueryPipelineDetailsRef.ftsResults.push({ retrievedForQuery: ftsQueryString, results: ftsSubData.map(r => ({ id: r.id, contentSnippet: r.content?.substring(0,100)+'...', metadata: r.metadata, score: r.rank, highlighted_content: r.highlighted_content })) });
            }
        }

        const uniqueVectorResults = {}; /* ... as before ... */ aggregatedVectorResults.forEach(row => { if (!row.id || (row.similarity && row.similarity < finalVectorMatchThreshold)) return; const id = String(row.id); if (!uniqueVectorResults[id] || row.similarity > uniqueVectorResults[id].similarity) { uniqueVectorResults[id] = row; } });
        const vectorResults = Object.values(uniqueVectorResults);
        const ftsResults = aggregatedFtsResults; // ftsResults now contains highlighted_content from RPC
        if (returnPipelineDetails) {
            pipelineDetails.aggregatedResults = {
                uniqueVectorResultsPreview: vectorResults.slice(0,50).map(r => ({id: r.id, score: r.similarity, contentSnippet: r.content?.substring(0,100)+'...'})),
                uniqueFtsResultsPreview: ftsResults.slice(0,50).map(r => ({id: r.id, score: r.rank, contentSnippet: r.content?.substring(0,100)+'...', highlighted_content: r.highlighted_content}))
            };
        }

        const combinedResults = {};
        vectorResults.forEach(row => {
            if (!row.id || (row.similarity && row.similarity < finalVectorMatchThreshold)) return;
            combinedResults[String(row.id)] = { ...row, vector_similarity: row.similarity || 0, fts_score: 0, highlighted_content: null }; // Initialize highlighted_content
        });
        ftsResults.forEach(row => {
            if (!row.id) return;
            const id = String(row.id);
            const ftsScore = row.rank || 0;
            if (!combinedResults[id]) {
                // Item only in FTS results, add it with its highlighted_content
                combinedResults[id] = { ...row, vector_similarity: 0, fts_score: ftsScore, highlighted_content: row.highlighted_content };
            } else {
                // Item already exists (from vector search), update FTS score and add highlighted_content
                combinedResults[id].fts_score = Math.max(combinedResults[id].fts_score || 0, ftsScore);
                combinedResults[id].highlighted_content = row.highlighted_content; // Add/overwrite highlighted_content
                // Ensure other properties from FTS row are preferred if they were missing from vector row
                if (!combinedResults[id].content && row.content) combinedResults[id].content = row.content;
                if (!combinedResults[id].metadata && row.metadata) combinedResults[id].metadata = row.metadata;
            }
        });

    let rankedResults = Object.values(combinedResults).filter(item => item.id && item.content).filter(item => !((item.fts_score || 0) === 0 && (item.vector_similarity || 0) < finalVectorMatchThreshold)).map(item => ({ ...item, hybrid_score: ((item.vector_similarity || 0) * adjustedVectorWeight) + ((item.fts_score || 0) * adjustedFtsWeight) }));
        if (returnPipelineDetails) pipelineDetails.mergedAndPreRankedResultsPreview = rankedResults.slice(0,50).map(item => ({ id: item.id, contentSnippet: item.content?.substring(0,150)+'...', metadata: item.metadata, initialHybridScore: item.hybrid_score, vectorSimilarity: item.vector_similarity, ftsScore: item.fts_score, highlighted_content: item.highlighted_content }));

        if (rankedResults.length === 0) {
            const originalQueryForEmptyReturn = originalUserQueryAtStart || queryText || "";
            const queriesForEmptyReturn = aggregatedQueriesEmbeddedForLog && aggregatedQueriesEmbeddedForLog.length > 0 ? aggregatedQueriesEmbeddedForLog : (originalQueryForEmptyReturn ? [originalQueryForEmptyReturn] : []);

            const emptyReturn = {
                results: [], // CRITICAL
                propositionResults: [],
                searchParams: searchParamsForLog || {},
                queriesEmbeddedForLog: queriesForEmptyReturn,
                predictedCategory: predictedCategory || null,
                // No direct rawRankedResultsForLog here; chatController derives it
            };

            if (returnPipelineDetails) {
                // Ensure pipelineDetails itself is an object and contains the critical part for chatController
                const basePipelineDetails = (typeof pipelineDetails === 'object' && pipelineDetails !== null) ? pipelineDetails : {};
                emptyReturn.pipelineDetails = {
                    ...basePipelineDetails, // Spread any existing details
                    originalQuery: originalQueryForEmptyReturn,
                    // CRITICAL: Ensure finalRankedResultsForPlayground is an array for chatController's derivation of rawRankedResultsForLog
                    finalRankedResultsForPlayground: (basePipelineDetails.finalRankedResultsForPlayground && Array.isArray(basePipelineDetails.finalRankedResultsForPlayground)) ? basePipelineDetails.finalRankedResultsForPlayground : [],
                    // Add other essential pipeline details with defaults if they might be accessed
                    queryCorrection: basePipelineDetails.queryCorrection || { originalQuery: originalQueryForEmptyReturn, correctedQuery: originalQueryForEmptyReturn, wasChanged: false },
                    queryClassification: basePipelineDetails.queryClassification || { predictedCategory: (predictedCategory || null), categoriesAvailable: (typeof clientCategoriesArray !== 'undefined' ? clientCategoriesArray : []) }
                };
                // If the primary 'results' for the playground wasn't set, default it too within pipelineDetails
                // This check is somewhat redundant due to the above, but ensures it explicitly.
                if (!Array.isArray(emptyReturn.pipelineDetails.finalRankedResultsForPlayground)) {
                    emptyReturn.pipelineDetails.finalRankedResultsForPlayground = [];
                }
            }

            logger.info("(DB Service) No results after merging. Returning empty structure.");
            // Log the actual object being returned for deep debugging
            // Using JSON.stringify to avoid issues with circular refs if any, though unlikely for this structure
            try {
                logger.debug(`(DB Service) [No Results Path] Returning object: ${JSON.stringify(emptyReturn, null, 2)}`);
            } catch (e) {
                logger.error("(DB Service) [No Results Path] Error stringifying emptyReturn for debug log:", e);
                logger.debug("(DB Service) [No Results Path] Returning object (partial on stringify error):", {results: emptyReturn.results, pipelineDetailsExists: !!emptyReturn.pipelineDetails});
            }
            return emptyReturn;
        }

        let itemsForFinalSort = [...rankedResults];
        // --- API-BASED RE-RANKING BLOCK ---
        if (ENABLE_API_RERANKING && itemsForFinalSort.length > 0) {
            logger.info(`(DB Service) Calling Reranker microservice for top ${CROSS_ENCODER_TOP_K} results.`); // Using CROSS_ENCODER_TOP_K

            const itemsToRerank = itemsForFinalSort
                .sort((a, b) => (b.hybrid_score || 0) - (a.hybrid_score || 0))
                .slice(0, CROSS_ENCODER_TOP_K); // Use CROSS_ENCODER_TOP_K for slicing

            const payload = {
                query: currentQueryText, // Assuming currentQueryText is available from the earlier part of hybridSearch
                documents: itemsToRerank.map(doc => ({ id: doc.id, content: doc.content }))
            };

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), RERANKER_TIMEOUT_MS); // RERANKER_TIMEOUT_MS is defined at the top

                const response = await fetch(`${process.env.RERANKER_API_URL}/api/rerank`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Internal-Api-Secret': process.env.INTERNAL_API_SECRET
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorBody = await response.text();
                    logger.error(`(DB Service) Reranker service responded with status ${response.status}: ${errorBody}`);
                    // Do not throw here, instead log and allow graceful continuation without this reranking
                    // This matches the original instruction's error handling intent.
                } else {
                    const { rerankedDocuments } = await response.json();

                    const rerankedScoreMap = new Map();
                    rerankedDocuments.forEach(doc => {
                        rerankedScoreMap.set(String(doc.id), doc.rerank_score);
                    });

                    // Apply scores to the itemsForFinalSort array
                    itemsForFinalSort.forEach(item => {
                        const idStr = String(item.id);
                        if (rerankedScoreMap.has(idStr)) {
                            // The API reranker score is typically a logit, suitable for sigmoid
                            item.cross_encoder_score_raw = rerankedScoreMap.get(idStr); // Store raw logit
                            item.cross_encoder_score_normalized = sigmoid(rerankedScoreMap.get(idStr)); // Use existing sigmoid
                        }
                    });

                    if (returnPipelineDetails && pipelineDetails && pipelineDetails.crossEncoderProcessing) { // Check pipelineDetails and its property
                        pipelineDetails.crossEncoderProcessing.inputs = payload.documents.map(d => ({ query: payload.query, documentContentSnippet: d.content.substring(0,150)+'...' }));
                        pipelineDetails.crossEncoderProcessing.outputs = itemsForFinalSort
                            .filter(item => rerankedScoreMap.has(String(item.id)))
                            .map(item => ({ id: item.id, contentSnippet: item.content?.substring(0,150)+'...', rawScore: item.cross_encoder_score_raw, normalizedScore: item.cross_encoder_score_normalized }));
                    }
                    logger.info('(DB Service) Successfully received and applied reranking from microservice.');
                }
            } catch (e) {
                logger.error(`(DB Service) Error calling reranker microservice: ${e.message}. Continuing without API reranking.`);
                // Fall through to use original hybrid_score based sorting or other logic
            }
        } else if (itemsForFinalSort.length > 0) { // This 'else if' replaces the original 'else if (ENABLE_CROSS_ENCODER)'
             logger.info("(DB Service) API Reranking is disabled or not applicable. Proceeding without it.");
        }
        // --- END OF API-BASED RE-RANKING BLOCK ---

        const rerankedList = itemsForFinalSort.map(item => {
            // Use correctedQueryTokens for Jaccard similarity
            const keywordMatchScore = calculateJaccardSimilarity(correctedQueryTokens, tokenizeText(item.content, true));
            let detailedMetadataScore = 0;
            if (item.metadata?.hierarchy && Array.isArray(item.metadata.hierarchy)) { for (const hNode of item.metadata.hierarchy) { if (hNode.text) { const commonKeywords = tokenizeText(hNode.text, true).filter(ht => correctedQueryTokens.includes(ht)); let levelBonus = 0; if (hNode.level === 1) levelBonus = 0.3; else if (hNode.level === 2) levelBonus = 0.2; else if (hNode.level <= 4) levelBonus = 0.1; else levelBonus = 0.05; detailedMetadataScore += commonKeywords.length * levelBonus; } } }
            if (item.metadata?.source_name) { detailedMetadataScore += (tokenizeText(item.metadata.source_name, true).filter(st => correctedQueryTokens.includes(st)).length * 0.1); }
            if (item.metadata?.custom_metadata && Array.isArray(item.metadata.custom_metadata.tags)) { detailedMetadataScore += (item.metadata.custom_metadata.tags.flatMap(tag => tokenizeText(String(tag), true)).filter(tt => correctedQueryTokens.includes(tt)).length * 0.15); }
            item.metadataRelevanceScore = detailedMetadataScore;
            const itemCrossEncoderScoreNormalized = item.cross_encoder_score_normalized !== undefined ? item.cross_encoder_score_normalized : sigmoid(0);

            // Calculate Document Recency Score
            const MS_PER_DAY = 1000 * 60 * 60 * 24;
            let recencyScore = 0.5; // Default score if date is missing or invalid

            if (item.metadata && item.metadata.source_document_updated_at) {
                const docDate = new Date(item.metadata.source_document_updated_at);
                // Check if docDate is a valid date
                if (!isNaN(docDate.getTime())) {
                    const ageInDays = (new Date().getTime() - docDate.getTime()) / MS_PER_DAY;
                    // Linear decay over a year (365 days)
                    // Score is 1 if age is 0 days, 0 if age is >= 365 days.
                    // Score is higher for more recent documents.
                    recencyScore = Math.max(0, 1 - (ageInDays / 365));
                } else {
                    // Optional: Log invalid date format if needed
                    // console.warn(`(DB Service) Invalid source_document_updated_at format for item ID ${item.id}: ${item.metadata.source_document_updated_at}`);
                }
            }
            item.recencyScore = recencyScore; // Add to item for use in final score and potential logging

            // Access and default Source Authority Score
            let calculatedSourceAuthorityScore = 0.5; // Default
            if (item.metadata && item.metadata.source_authority_score !== undefined && item.metadata.source_authority_score !== null) {
                const numericScore = parseFloat(item.metadata.source_authority_score);
                if (!isNaN(numericScore)) {
                    calculatedSourceAuthorityScore = numericScore;
                } else {
                    // Optional: Log if it was present but not a number
                    // console.warn(`(DB Service) source_authority_score for item ID ${item.id} was not a valid number: ${item.metadata.source_authority_score}`);
                }
            }
            item.sourceAuthorityScore = calculatedSourceAuthorityScore;

            // Access and default Chunk Feedback Score
            // Assumes chunk_feedback_score could be positive or negative (e.g., -1 to 1).
            // A default of 0.0 implies neutral feedback if not specified or invalid.
            let calculatedChunkFeedbackScore = 0.0; // Default
            if (item.metadata && item.metadata.chunk_feedback_score !== undefined && item.metadata.chunk_feedback_score !== null) {
                const numericScore = parseFloat(item.metadata.chunk_feedback_score);
                if (!isNaN(numericScore)) {
                    calculatedChunkFeedbackScore = numericScore;
                } else {
                    // Optional: Log if it was present but not a number
                    // console.warn(`(DB Service) chunk_feedback_score for item ID ${item.id} was not a valid number: ${item.metadata.chunk_feedback_score}`);
                }
            }
            item.chunkFeedbackScore = calculatedChunkFeedbackScore;

            // Access and default Chunk Feedback Score
            // Assumes chunk_feedback_score could be positive or negative (e.g., -1 to 1).
            // A default of 0.0 implies neutral feedback if not specified or invalid.
            // let calculatedChunkFeedbackScore = 0.0; // Default  // THIS LINE AND BLOCK IS DUPLICATED AND REMOVED
            // if (item.metadata && item.metadata.chunk_feedback_score !== undefined && item.metadata.chunk_feedback_score !== null) {
            //     const numericScore = parseFloat(item.metadata.chunk_feedback_score);
            //     if (!isNaN(numericScore)) {
            //         calculatedChunkFeedbackScore = numericScore;
            //     } else {
            //         // Optional: Log if it was present but not a number
            //         // console.warn(`(DB Service) chunk_feedback_score for item ID ${item.id} was not a valid number: ${item.metadata.chunk_feedback_score}`);
            //     }
            // }
            // item.chunkFeedbackScore = calculatedChunkFeedbackScore; // THIS LINE IS PART OF THE DUPLICATE BLOCK

            // Calculate the final reranked_score using all weighted components
            item.reranked_score =
                (item.hybrid_score || 0) * W_ORIGINAL_HYBRID_SCORE_ADJ +
                (item.cross_encoder_score_normalized || 0) * W_CROSS_ENCODER_SCORE_ADJ +
                (item.keywordMatchScore || 0) * W_KEYWORD_MATCH_SCORE_ADJ +
                (item.metadataRelevanceScore || 0) * W_METADATA_RELEVANCE_SCORE_ADJ +
                (item.recencyScore) * W_RECENCY_SCORE +               // Defaulting handled during item.recencyScore assignment
                (item.sourceAuthorityScore) * W_SOURCE_AUTHORITY_SCORE + // Defaulting handled during item.sourceAuthorityScore assignment
                (item.chunkFeedbackScore) * W_CHUNK_FEEDBACK_SCORE;    // Defaulting handled during item.chunkFeedbackScore assignment

            // Ensure a final score is a number, default to 0 if somehow NaN
            if (isNaN(item.reranked_score)) {
                // console.warn(`(DB Service) Calculated reranked_score is NaN for item ID ${item.id}. Defaulting to 0.`);
                item.reranked_score = 0;
            }
            // item.keywordMatchScore = keywordMatchScore; // keywordMatchScore is already part of item.
            return { ...item, reranked_score: item.reranked_score }; // Return the item with all scores
        });

        rerankedList.sort((a, b) => b.reranked_score - a.reranked_score);
        if (DEBUG_RERANKING) {
            rerankedList.slice(0, finalLimit + 5).forEach(r => {
                logger.debug(`  ID: ${r.id}, Reranked: ${r.reranked_score?.toFixed(4)}, Hybrid: ${r.hybrid_score?.toFixed(4)}, CE_norm: ${r.cross_encoder_score_normalized?.toFixed(4)}, KW: ${r.keywordMatchScore?.toFixed(4)}, MetaDetailed: ${r.metadataRelevanceScore?.toFixed(4)}, Recency: ${r.recencyScore?.toFixed(4)}, Authority: ${r.sourceAuthorityScore?.toFixed(4)}, Feedback: ${r.chunkFeedbackScore?.toFixed(4)}`);
            });
        }

        const finalResults = rerankedList.slice(0, finalLimit);
        const finalResultsMapped = finalResults.map(r => ({
            id: r.id,
            content: r.content,
            metadata: r.metadata,
            reranked_score: r.reranked_score,
            hybrid_score: r.hybrid_score,
            keywordMatchScore: r.keywordMatchScore,
            metadataRelevanceScore: r.metadataRelevanceScore,
            cross_encoder_score_normalized: r.cross_encoder_score_normalized, // Kept for transparency
            recencyScore: r.recencyScore,
            sourceAuthorityScore: r.sourceAuthorityScore,
            chunkFeedbackScore: r.chunkFeedbackScore,
            highlighted_content: r.highlighted_content // Add this field
        }));

        if (returnPipelineDetails) pipelineDetails.finalRankedResultsForPlayground = finalResultsMapped.slice(0, 15).map(item => ({ ...item, contentSnippet: item.content?.substring(0,250)+'...' })); // highlighted_content is part of '...item'

        let propositionResults = [];
        if (firstProcessedQueryEmbedding) {
            const primaryQueryEmbedding = firstProcessedQueryEmbedding;
            try {
                const { data: propData, error: propSearchError } = await supabase.rpc('proposition_vector_search', { client_id_param: clientId, query_embedding: primaryQueryEmbedding, match_threshold: PROPOSITION_MATCH_THRESHOLD, match_count: PROPOSITION_SEARCH_LIMIT });
                if (propSearchError) { logger.error("(DB Service) Error en RPC proposition_vector_search:", propSearchError.message); }
                else { propositionResults = propData || []; }
            } catch (rpcError) { logger.error("(DB Service) Excepción durante RPC proposition_vector_search:", rpcError.message); }
        } else { logger.info("(DB Service) No hay embedding de la consulta principal disponible, saltando búsqueda de proposiciones."); }

        const propositionDataForReturn = propositionResults || [];
        if (returnPipelineDetails) pipelineDetails.finalPropositionResults = propositionDataForReturn.map(p => ({ propositionId: p.proposition_id, text: p.proposition_text, sourceChunkId: p.source_chunk_id, score: p.similarity }));

        const finalResultsToReturn = Array.isArray(finalResultsMapped) ? finalResultsMapped : [];
        const propositionDataToReturn = Array.isArray(propositionDataForReturn) ? propositionDataForReturn : [];
        const queriesEmbeddedForLogReturn = (Array.isArray(aggregatedQueriesEmbeddedForLog) && aggregatedQueriesEmbeddedForLog.length > 0) ? aggregatedQueriesEmbeddedForLog : (originalUserQueryAtStart ? [originalUserQueryAtStart] : []);
        const searchParamsForLogReturn = searchParamsForLog || {};
        const predictedCategoryReturn = predictedCategory !== undefined ? predictedCategory : null;

        let pipelineDetailsReturn;
        if (returnPipelineDetails) {
            pipelineDetailsReturn = pipelineDetails || { originalQuery: originalUserQueryAtStart || queryText, error: "Pipeline details object was not created prior to return." };
            // Ensure finalRankedResultsForPlayground is part of pipelineDetails and is an array
            // This is crucial for the chatController's derivation of rawRankedResultsForLog
            if (!pipelineDetailsReturn.finalRankedResultsForPlayground || !Array.isArray(pipelineDetailsReturn.finalRankedResultsForPlayground)) {
                 // If not properly populated earlier (e.g. in the playground detailing step), default to an empty array.
                 // Ideally, it should be populated with the same content as finalResultsToReturn if no specific playground processing was done.
                 pipelineDetailsReturn.finalRankedResultsForPlayground = finalResultsToReturn; // Or [] if it should be distinct and was missed
            }
        }

        const returnObject = {
            results: finalResultsToReturn,
            propositionResults: propositionDataToReturn,
            searchParams: searchParamsForLogReturn,
            queriesEmbeddedForLog: queriesEmbeddedForLogReturn,
            predictedCategory: predictedCategoryReturn
        };
        if (returnPipelineDetails) {
            returnObject.pipelineDetails = pipelineDetailsReturn;
        }
        return returnObject;

    } catch (error) {
        logger.error(`(DB Service) Error general durante la búsqueda híbrida para cliente ${clientId}:`, { message: error.message, stack: error.stack?.substring(0, 500) });

        const searchParamsForLogError = typeof searchParamsForLog !== 'undefined' ? searchParamsForLog : {};
        const originalUserQueryAtStartError = typeof originalUserQueryAtStart !== 'undefined' ? originalUserQueryAtStart : (typeof queryText !== 'undefined' ? queryText : "");
        const predictedCategoryError = typeof predictedCategory !== 'undefined' ? predictedCategory : null;
        const clientCategoriesArrayForErrorCatch = typeof clientCategoriesArray !== 'undefined' ? clientCategoriesArray : [];
        const aggregatedQueriesEmbeddedForLogError = (typeof aggregatedQueriesEmbeddedForLog !== 'undefined' && Array.isArray(aggregatedQueriesEmbeddedForLog) && aggregatedQueriesEmbeddedForLog.length > 0)
            ? aggregatedQueriesEmbeddedForLog
            : (originalUserQueryAtStartError ? [originalUserQueryAtStartError] : []);

        const errorReturn = {
            results: [], // CRITICAL
            propositionResults: [], // CRITICAL
            searchParams: searchParamsForLogError,
            queriesEmbeddedForLog: aggregatedQueriesEmbeddedForLogError,
            predictedCategory: predictedCategoryError,
            error: error.message
        };

        if (returnPipelineDetails) {
            const currentPipelineDetails = typeof pipelineDetails !== 'undefined' ? pipelineDetails : {};
            errorReturn.pipelineDetails = {
                ...(currentPipelineDetails || {}), // Spread existing details if any
                originalQuery: originalUserQueryAtStartError,
                finalRankedResultsForPlayground: [], // CRITICAL for chatController derivation
                error: error.message,
                queryClassification: { predictedCategory: predictedCategoryError, categoriesAvailable: clientCategoriesArrayForErrorCatch }
            };
             // Preserve original pipeline error if a new one is generic, or combine.
            if (currentPipelineDetails.error && currentPipelineDetails.error !== error.message) {
                 errorReturn.pipelineDetails.error = `Main error: ${error.message}. Previous pipeline error: ${currentPipelineDetails.error}`;
            } else {
                 errorReturn.pipelineDetails.error = error.message;
            }
        }
        return errorReturn;
    }
};

// (Rest of the file remains unchanged)
// ... (fetchKnowledgeSuggestions, updateClientKnowledgeSuggestionStatus, etc. as before) ...
export const fetchKnowledgeSuggestions = async (clientId, { status = 'new', type, limit = 20, offset = 0 }) => { /* ... */ };
export const updateClientKnowledgeSuggestionStatus = async (clientId, suggestionId, newStatus) => { /* ... */ };
function getDateRange(periodOptions) { /* ... */ }
export const fetchAnalyticsSummary = async (clientId, periodOptions) => { /* ... */ };
export const fetchUnansweredQueries = async (clientId, periodOptions, limit = 10) => { /* ... */ };
export const createConversationAnalyticEntry = async (conversationId, clientId, firstMessageAt) => { /* ... */ };
export const incrementAnalyticMessageCount = async (conversationId, senderType) => { /* ... */ };
export const updateAnalyticOnEscalation = async (conversationId, escalationTimestamp, lastUserQuery) => { /* ... */ };
export const updateAnalyticOnBotCannotAnswer = async (conversationId, lastUserQuery) => { /* ... */ };
export const finalizeConversationAnalyticRecord = async (conversationId, resolutionStatus, lastMessageAt) => { /* ... */ };

function tokenizeText(text, removeStopWords = false) {
    if (typeof text !== 'string' || text.trim() === '') {
        return [];
    }
    // Normalize: lowercase, remove punctuation (simple version)
    const normalizedText = text.toLowerCase().replace(/[.,!?;:()\[\]{}"']/g, '');
    let tokens = normalizedText.split(/\s+/).filter(token => token.length > 0);

    if (removeStopWords) {
        tokens = tokens.filter(token => !SPANISH_STOP_WORDS.has(token));
    }
    return tokens;
}

function calculateJaccardSimilarity(set1Tokens, set2Tokens) {
    if (!Array.isArray(set1Tokens) || !Array.isArray(set2Tokens)) return 0;
    const set1 = new Set(set1Tokens);
    const set2 = new Set(set2Tokens);
    const intersectionSize = new Set([...set1].filter(x => set2.has(x))).size;
    const unionSize = set1.size + set2.size - intersectionSize;
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

const SPANISH_ABBREVIATIONS = { /* ... */ };

// Ensure sigmoid function is defined if not already (it was removed with getCrossEncoderPipeline)
function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function preprocessTextForEmbedding(text) {
    if (typeof text !== 'string') {
        // console.warn("(DB Service) preprocessTextForEmbedding: input is not a string, returning empty string. Value:", text);
        return ""; // Return an empty string for non-string inputs
    }
    // Simple preprocessing: lowercase and trim. More sophisticated steps could be added.
    return text.toLowerCase().trim();
}

export const getConversationDetails = async (conversationId) => { /* ... */ };

export const logAiResolution = async (clientId, conversationId, billingCycleId, detailsJson) => {
    if (!clientId || !conversationId) {
        logger.error('(DB Service) logAiResolution: clientId and conversationId are required.');
        return { error: 'Client ID and Conversation ID are required.' };
    }
    if (detailsJson && typeof detailsJson !== 'object') {
        logger.error('(DB Service) logAiResolution: detailsJson must be an object if provided.');
        return { error: 'detailsJson must be an object.' };
    }

    try {
        // Step 1: Fetch current conversation status and verify client_id
        const { data: convData, error: fetchError } = await supabase
            .from('conversations')
            .select('client_id, resolution_status')
            .eq('conversation_id', conversationId)
            .single();

        if (fetchError) {
            logger.error(`(DB Service) logAiResolution: Error fetching conversation ${conversationId}: ${fetchError.message}`);
            return { error: `Conversation not found: ${fetchError.message}` }; // More specific error
        }
        if (!convData) { // Should be caught by fetchError with .single(), but as a safeguard
            logger.warn(`(DB Service) logAiResolution: Conversation ${conversationId} not found (no data).`);
            return { error: 'Conversation not found.' };
        }
        if (convData.client_id !== clientId) {
            logger.warn(`(DB Service) logAiResolution: Access denied. Client ${clientId} does not own conversation ${conversationId}.`);
            return { error: 'Access denied to this conversation.', message: 'Access denied' }; // Keep message for controller
        }

        // Step 2: Check if conversation is already in a terminal resolution state
        const terminalResolutionStates = ['resolved_by_ia', 'escalated']; // Add any other relevant terminal states
        if (convData.resolution_status && terminalResolutionStates.includes(convData.resolution_status)) {
            logger.info(`(DB Service) logAiResolution: Conversation ${conversationId} already has a final status: ${convData.resolution_status}. No new log entry needed, status not changed.`);
            // Return a specific message and the current status
            return { error: null, message: `Conversation already has a final status: ${convData.resolution_status}.`, status: convData.resolution_status };
        }

        // Step 3: Update conversation's resolution_status to 'resolved_by_ia'
        const { error: updateError } = await supabase
        .from('conversations')
        .update({ status: 'resolved_by_ia', last_message_at: new Date().toISOString() })
        .eq('conversation_id', conversationId); // Cambiar 'id' por 'conversation_id'

        if (updateError) {
            logger.error(`(DB Service) logAiResolution: Error updating conversation ${conversationId} to resolved_by_ia: ${updateError.message}`);
            return { error: `Error updating conversation status: ${updateError.message}` };
        }
        logger.info(`(DB Service) logAiResolution: Conversation ${conversationId} status updated to 'resolved_by_ia'.`);

        // Step 4: Determine billing cycle if not provided
        let currentBillingCycle = billingCycleId;
        if (!currentBillingCycle) {
            const now = new Date();
            currentBillingCycle = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }

        // Step 5: Insert into ia_resolutions_log
        const logEntry = {
            client_id: clientId,
            conversation_id: conversationId,
            billing_cycle_id: currentBillingCycle,
            resolution_details: detailsJson || { resolution_method: 'implicit_or_backend_triggered' }
        };

        const { error: logInsertError } = await supabase
            .from('ia_resolutions_log')
            .insert(logEntry);

        if (logInsertError) {
            logger.error(`(DB Service) logAiResolution: Error inserting into ia_resolutions_log for CV_ID ${conversationId}: ${logInsertError.message}`);
            // Consider if the status update should be rolled back or flagged for reconciliation.
            // For now, returning the error.
            return { error: `Error logging AI resolution event: ${logInsertError.message}` };
        }

        logger.info(`(DB Service) logAiResolution: AI resolution successfully logged for CV_ID ${conversationId}, ClientID ${clientId}, BillingCycle ${currentBillingCycle}.`);
        return { error: null, message: 'AI resolution logged successfully.' }; // Consistent success response

    } catch (err) {
        logger.error(`(DB Service) logAiResolution: Unexpected exception for CV_ID ${conversationId}, ClientID ${clientId}:`, err);
        return { error: 'An unexpected server error occurred during AI resolution logging.' };
    }
};

export const logRagInteraction = async (logData) => {
    // Ensure required fields for the initial log are present
    if (!logData || !logData.client_id || !logData.user_query) { // Assuming user_query is essential for logging interaction
        logger.warn('(DB Service) Invalid logData for RAG interaction: client_id and user_query are required.', logData);
        return { error: 'Invalid logData: client_id and user_query are required for RAG interaction log.' };
    }

    const logEntry = {
        client_id: logData.client_id,
        conversation_id: logData.conversation_id, // Optional
        user_query: logData.user_query,
        retrieved_context: logData.retrieved_context, // Optional
        final_prompt_to_llm: logData.final_prompt_to_llm, // Optional
        llm_response: logData.llm_response, // Optional
        // response_timestamp is defaulted by DB
        query_embeddings_used: logData.query_embeddings_used, // Optional (this is for RAG pipeline, not the user_query embedding itself)
        vector_search_params: logData.vector_search_params, // Optional
        was_escalated: logData.was_escalated || false, // Default to false
        predicted_query_category: logData.predicted_query_category, // Add this line
        // query_embedding will be added in a subsequent update step
    };

    Object.keys(logEntry).forEach(key => {
        if (logEntry[key] === undefined) {
            delete logEntry[key];
        }
    });

    try {
        const { data: insertedData, error: insertError } = await supabase
            .from('rag_interaction_logs')
            .insert([logEntry])
            .select()
            .single(); // Assuming we want the inserted row, including its log_id

        if (insertError) {
            logger.error('(DB Service) Error logging RAG interaction (initial insert):', insertError);
            return { error: insertError.message };
        }

        if (!insertedData || !insertedData.log_id) {
            logger.error('(DB Service) RAG interaction log insert did not return data or log_id.');
            return { error: 'Failed to retrieve log_id after insert.' };
        }

        const log_id = insertedData.log_id;

        // Now, generate and update the query_embedding (non-blocking for the return)
        if (logEntry.user_query) {
            // Fire-and-forget style for embedding update
            (async () => {
                try {
                    logger.debug(`(DB Service) Generating embedding for user_query (log_id: ${log_id}): "${logEntry.user_query.substring(0, 50)}..."`);
                    // getEmbedding is imported from './embeddingService.js'
                    const embedding = await getEmbedding(logEntry.user_query);
                    // embeddingService.getEmbedding returns the vector directly or throws an error.

                    if (embedding) {
                        const { error: updateError } = await supabase
                            .from('rag_interaction_logs')
                            .update({ query_embedding: embedding })
                            .eq('log_id', log_id);

                        if (updateError) {
                            logger.error(`(DB Service) Error updating rag_interaction_logs with query_embedding for log_id ${log_id}:`, updateError);
                        } else {
                            logger.info(`(DB Service) Successfully updated log_id ${log_id} with query_embedding.`);
                        }
                    } else {
                        // This case might not be reachable if getEmbedding throws on failure,
                        // but included for robustness if it could return null/undefined.
                        logger.error(`(DB Service) Failed to generate query embedding for log_id ${log_id} (embedding was null/undefined).`);
                    }
                } catch (embeddingError) {
                    logger.error(`(DB Service) Exception during query embedding or update for log_id ${log_id}:`, embeddingError);
                }
            })();
        }
        // Return the initially inserted data (without waiting for embedding update)
        return { data: insertedData, rag_interaction_log_id: log_id };

    } catch (err) {
        logger.error('(DB Service) General exception in logRagInteraction:', err);
        return { error: 'An unexpected error occurred while logging RAG interaction.' };
    }
};

export const logRagFeedback = async (feedbackData) => {
    // 1. Validate input
    if (!feedbackData || !feedbackData.client_id || !feedbackData.feedback_type || typeof feedbackData.feedback_type !== 'string' || typeof feedbackData.rating !== 'number') {
        logger.warn('(DB Service) Invalid feedbackData: client_id (string), feedback_type (string), and rating (number) are required.', feedbackData);
        return { error: 'Invalid input: client_id, feedback_type, and a numeric rating are required.' };
    }

    const {
        client_id,
        user_id,
        conversation_id,
        message_id,
        rag_interaction_log_id,
        knowledge_base_chunk_id,
        // knowledge_proposition_id, // This was commented out in the DB schema
        feedback_type,
        rating,
        comment,
        feedback_context
    } = feedbackData;

    const insertObject = {
        client_id,
        user_id,
        conversation_id,
        message_id,
        rag_interaction_log_id,
        knowledge_base_chunk_id,
        // knowledge_proposition_id, // Commented out in DB
        feedback_type,
        rating,
        comment,
        feedback_context
    };

    // Remove undefined properties to rely on database defaults or allow NULLs
    Object.keys(insertObject).forEach(key => {
        if (insertObject[key] === undefined) {
            delete insertObject[key];
        }
    });

    try {
        const { data, error } = await supabase
            .from('rag_feedback_log')
            .insert([insertObject])
            .select();

        if (error) {
            logger.error('(DB Service) Error logging RAG feedback:', error);
            return { error: error.message };
        }
        // .select() returns an array, so return the first element if successful
        return { data: data && data.length > 0 ? data[0] : null };
    } catch (err) {
        logger.error('(DB Service) Exception in logRagFeedback:', err);
        return { error: 'An unexpected error occurred while logging feedback.' };
    }
};

export const fetchFeedbackWithInteractionDetails = async (clientId, periodOptions) => {
    try {
        let query = supabase
            .from('rag_feedback_log')
            .select(`
                *,
                interaction:rag_interaction_logs(*)
            `) // Fetches all columns from both, renames joined table to 'interaction'
            .gte('created_at', periodOptions.startDate)
            .lte('created_at', periodOptions.endDate + 'T23:59:59.999Z');

        if (clientId) {
            query = query.eq('client_id', clientId);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            logger.error(`(DB Service) Error fetching feedback with interaction details (client: ${clientId || 'all'}):`, error);
            return { error: error.message };
        }

        return { data };

    } catch (err) {
        logger.error(`(DB Service) Exception in fetchFeedbackWithInteractionDetails (client: ${clientId || 'all'}):`, err);
        return { error: 'An unexpected error occurred while fetching feedback details.' };
    }
};

export const getUnprocessedRagLogsForClient = async (clientId, limit = 1000) => {
    if (!clientId) {
        logger.warn('(DB Service) clientId is required for getUnprocessedRagLogsForClient.');
        return { error: 'clientId is required.' };
    }

    try {
        const { data, error } = await supabase
            .from('rag_interaction_logs')
            .select('log_id, user_query, query_embedding, created_at, conversation_id') // Added conversation_id for context
            .eq('client_id', clientId)
            .is('topic_analysis_processed_at', null) // Fetch only logs not yet processed
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) {
            logger.error(`(DB Service) Error fetching unprocessed RAG logs for client ${clientId}:`, error);
            return { error: error.message };
        }
        return { data };
    } catch (err) {
        logger.error(`(DB Service) Exception in getUnprocessedRagLogsForClient for client ${clientId}:`, err);
        return { error: 'An unexpected error occurred while fetching unprocessed RAG logs.' };
    }
};

export const updateKnowledgeSourceMetadata = async (clientId, sourceId, metadataUpdates) => {
    if (!clientId || !sourceId) {
        logger.warn('(DB Service) clientId and sourceId are required for updateKnowledgeSourceMetadata.');
        return { error: 'Client ID and Source ID are required.', status: 400 };
    }
    if (!metadataUpdates || Object.keys(metadataUpdates).length === 0) {
        return { error: 'No metadata updates provided.', status: 400 };
    }

    const allowedFields = ['reingest_frequency', 'custom_title', 'category_tags']; // Added 'category_tags'
    const updateObject = {};
    for (const key in metadataUpdates) {
        if (allowedFields.includes(key) && metadataUpdates[key] !== undefined) {
            updateObject[key] = metadataUpdates[key];
        }
    }

    if (Object.keys(updateObject).length === 0) {
        return { error: 'No valid fields provided for update. Allowed fields are: ' + allowedFields.join(', '), status: 400 };
    }

    // Potentially add logic here if 'reingest_frequency' changes, e.g., to update 'next_reingest_at'
    // For example, if frequency is set to 'manual', next_reingest_at might be set to null.
    // If set to 'daily', calculate Date.now() + 1 day. This logic can be complex and might live
    // in a dedicated scheduling service or be triggered by a DB hook/function.
    // For now, this service just updates the fields passed after filtering.

    try {
        const { data, error } = await supabase
            .from('knowledge_sources')
            .update(updateObject)
            .eq('source_id', sourceId)
            .eq('client_id', clientId) // Ensure client owns this source
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116' || error.details?.includes('0 rows')) { // PostgREST code for "No rows found"
                logger.warn(`(DB Service) Knowledge source not found or client ${clientId} does not own source ${sourceId}.`);
                return { error: 'Knowledge source not found or access denied.', status: 404 };
            }
            logger.error(`(DB Service) Error updating knowledge source metadata for source ${sourceId}, client ${clientId}:`, error);
            return { error: error.message, status: 500 };
        }

        return { data, error: null }; // Return data on success

    } catch (err) {
        logger.error(`(DB Service) Exception in updateKnowledgeSourceMetadata for source ${sourceId}, client ${clientId}:`, err);
        return { error: 'An unexpected error occurred while updating knowledge source metadata.', status: 500 };
    }
};

export const getChunksForSource = async (clientId, sourceId, page = 1, pageSize = 50) => {
    if (!clientId || !sourceId) {
        return { error: 'Client ID and Source ID are required.', status: 400 };
    }
    if (isNaN(parseInt(page)) || parseInt(page) < 1) {
        page = 1;
    } else {
        page = parseInt(page);
    }
    if (isNaN(parseInt(pageSize)) || parseInt(pageSize) < 1) {
        pageSize = 50;
    } else {
        pageSize = parseInt(pageSize);
    }

    const offset = (page - 1) * pageSize;

    try {
        // Verify ownership and existence of the source
        const { data: sourceData, error: sourceError } = await supabase
            .from('knowledge_sources')
            .select('source_id') // Select the correct PK column name
            .eq('source_id', sourceId) // Query by the correct PK column name
            .eq('client_id', clientId)
            .single();

        if (sourceError || !sourceData) {
            logger.warn(`(DB Service) Source ${sourceId} not found for client ${clientId} or error:`, sourceError);
            return { error: 'Source not found or access denied.', status: 404 };
        }

        // Fetch chunks for the source
        const { data: chunks, error: chunksError } = await supabase
            .from('knowledge_base')
            .select('id, content, metadata, embedding, created_at', { count: 'exact' }) // Request total count here
            .eq('metadata->>original_source_id', sourceId)
            .eq('client_id', clientId)
            .order('metadata->>chunk_index', { ascending: true, nullsFirst: false }) // Ensure numeric sort if chunk_index is number-like string
            // For true numeric sort if metadata->>'chunk_index' is actually a number stored as text:
            // .order(supabase.sql`(metadata->>'chunk_index')::int`, { ascending: true, nullsFirst: false })
            // However, direct casting in .order() might not be universally supported or straightforward with Supabase JS client.
            // Simpler to rely on alphanumeric sort of stringified numbers if they are padded, or handle sorting client-side if complex.
            // For now, assuming chunk_index is stored in a way that string sort is acceptable or it's handled.
            // If chunk_index is guaranteed numeric and stored as a number in JSONB, Supabase might sort it numerically by default.
            .limit(pageSize)
            .range(offset, offset + pageSize - 1);

        if (chunksError) {
            logger.error(`(DB Service) Error fetching chunks for source ${sourceId}, client ${clientId}:`, chunksError);
            return { error: chunksError.message, status: 500 };
        }

        // Get total count - Supabase returns count as part of the query if { count: 'exact' } is passed
        // However, the above query returns the count of the current page. We need the total count for the source.
        const { count: totalCount, error: countError } = await supabase
            .from('knowledge_base')
            .select('id', { count: 'exact', head: true })
            .eq('metadata->>original_source_id', sourceId)
            .eq('client_id', clientId);

        if (countError) {
             logger.error(`(DB Service) Error fetching total chunk count for source ${sourceId}, client ${clientId}:`, countError);
            // Not fatal, but pagination info will be incomplete
        }

        return {
            data: {
                chunks: chunks || [],
                totalCount: totalCount || 0,
                page,
                pageSize
            },
            error: null
        };

    } catch (err) {
        logger.error(`(DB Service) Exception in getChunksForSource for source ${sourceId}, client ${clientId}:`, err);
        return { error: 'An unexpected error occurred while fetching chunks.', status: 500 };
    }
};


export const getClientConversations = async (clientId, statusFilters = [], page = 1, pageSize = 20) => {
    if (!clientId) {
        logger.error('(DB Service) getClientConversations: clientId is required.');
        return { data: null, error: 'Client ID is required.' };
    }

    const offset = (page - 1) * pageSize;

    try {
        let query = supabase
            .from('conversations')
            .select(`
                conversation_id,
                client_id,
                created_at,
                last_message_at,
                status,
                messages ( content, created_at )
            `, { count: 'exact' }) // Request total count
            .eq('client_id', clientId);

        if (statusFilters && statusFilters.length > 0) {
            query = query.in('status', statusFilters);
        }

        // BEGIN MODIFICATION
        // The original ordering clause is faulty.
        // Replace it with the following line to sort by the 'last_message_at' column on the 'conversations' table.
        query = query.order('last_message_at', { ascending: false, nulls: 'last' });
        // END MODIFICATION

        query = query.range(offset, offset + pageSize - 1);

        const { data: conversationsData, error, count } = await query;

        if (error) {
            logger.error('(DB Service) Error fetching client conversations from Supabase:', error);
            return { data: null, error: error.message };
        }

        // Process data to include a last_message_preview
        const processedConversations = conversationsData.map(conv => {
            let last_message_preview = null;
            if (conv.messages && conv.messages.length > 0) {
                // Sort messages to find the most recent one, just in case they aren't ordered
                conv.messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                last_message_preview = conv.messages[0].content;
            }
            // Remove the full messages array from the main conversation object if not needed for list view
            // Or select only the latest message directly in the query if possible and more performant
            delete conv.messages;
            return { ...conv, last_message_preview };
        });

        logger.info(`(DB Service) Fetched ${processedConversations.length} conversations for client ${clientId}, page ${page}, totalCount ${count}`);
        return {
            data: {
                conversations: processedConversations,
                totalCount: count,
                page: page,
                pageSize: pageSize
            },
            error: null
        };

    } catch (err) {
        logger.error('(DB Service) Unexpected exception in getClientConversations:', err);
        return { data: null, error: 'An unexpected server error occurred while fetching conversations.' };
    }
};

export const getMessagesForConversation = async (conversationId, clientId) => {
    if (!conversationId || !clientId) {
        logger.warn('(DB Service) Invalid params for getMessagesForConversation: conversationId and clientId are required.');
        return { data: null, error: 'conversationId and clientId are required.' };
    }
    try {
        const { data: conversation, error: convError } = await supabase
            .from('conversations')
            .select('client_id')
            .eq('conversation_id', conversationId)
            .eq('client_id', clientId) // Verify ownership
            .single();

        if (convError) {
            logger.error(`(DB Service) Error fetching conversation (DB error) for conv ${conversationId}, client ${clientId}:`, convError);
            const errorMessage = convError.code === 'PGRST116' ? 'Conversation not found or access denied.' : convError.message;
            return { data: null, error: errorMessage };
        }
        if (!conversation) {
             logger.warn(`(DB Service) Conversation not found or client ${clientId} does not own conv ${conversationId} (no data returned).`);
            return { data: null, error: 'Conversation not found or access denied.' };
        }

        const { data, error } = await supabase
            .from('messages')
            .select('message_id, conversation_id, sender, content, timestamp, sentiment, rag_interaction_ref')
            .eq('conversation_id', conversationId)
            .order('timestamp', { ascending: true });

        if (error) {
            logger.error(`(DB Service) Error fetching messages for conv ${conversationId}:`, error);
            return { data: null, error: error.message };
        }
        return { data, error: null };
    } catch (err) {
        logger.error(`(DB Service) Unexpected exception in getMessagesForConversation for conv ${conversationId}:`, err);
        return { data: null, error: 'An unexpected server error occurred while fetching messages.' };
    }
};

export const addAgentMessageToConversation = async (conversationId, clientId, agentUserId, content) => { /* ... */ };
export const updateConversationStatusByAgent = async (conversationId, clientId, agentUserId, newStatus) => { /* ... */ };

// Ensure all functions are properly closed and exported if necessary
// The placeholder comments like /* ... */ assume the code is correctly filled in from previous versions.
// Re-inserting the full existing code for those functions to be sure.

// (Re-inserting actual code for functions that were reduced to /* ... */ for brevity in prompt)
// getCache, setCache
// getClientConfig, getAllActiveClientIds (only one version)
// getChunkSampleForSource, getConversationHistory, saveMessage, createConversation
// fetchKnowledgeSuggestions, updateClientKnowledgeSuggestionStatus
// getDateRange, fetchAnalyticsSummary, fetchUnansweredQueries
// createConversationAnalyticEntry, incrementAnalyticMessageCount, updateAnalyticOnEscalation, updateAnalyticOnBotCannotAnswer, finalizeConversationAnalyticRecord
// tokenizeText, calculateJaccardSimilarity, SPANISH_ABBREVIATIONS, preprocessTextForEmbedding
// getConversationDetails, logAiResolution, logRagInteraction
// getClientConversations, addAgentMessageToConversation, updateConversationStatusByAgent

// (The actual overwrite will use the full existing file content with the hybridSearch modifications)

// --- Custom Resolution and Handover Functions ---

export const logResolution = async (conversationId, resolutionType) => {
    logger.debug(`(DB Service) logResolution: Attempting to log resolution for conversation ${conversationId} with type ${resolutionType}`);

    if (!conversationId || !resolutionType) {
        logger.error('(DB Service) logResolution: conversationId and resolutionType are required.');
        throw new Error('conversationId and resolutionType are required.');
    }

    try {
        // Retrieve the conversation to check its current status and client_id
        const { data: conversation, error: fetchError } = await supabase
            .from('conversations')
            .select('status, client_id')
            .eq('conversation_id', conversationId)
            .single();

        if (fetchError) {
            logger.error(`(DB Service) logResolution: Error fetching conversation ${conversationId}: ${fetchError.message}`);
            throw new Error(`Error fetching conversation: ${fetchError.message}`);
        }

        if (!conversation) {
            logger.warn(`(DB Service) logResolution: Conversation ${conversationId} not found.`);
            throw new Error('Conversation not found.');
        }

        if (conversation.status !== 'open') {
            logger.info(`(DB Service) logResolution: Conversation ${conversationId} was not open (status: ${conversation.status}). No update needed.`);
            return { success: true, message: 'Conversation was not open.' };
        }

        // Update conversation status to 'resolved'
        const updated_at = new Date().toISOString();
        const { error: updateConvError } = await supabase
            .from('conversations')
            .update({ status: 'resolved', last_message_at: new Date().toISOString() })
            .eq('conversation_id', conversationId);

        if (updateConvError) {
            logger.error(`(DB Service) logResolution: Error updating conversation ${conversationId} status: ${updateConvError.message}`);
            throw new Error(`Error updating conversation status: ${updateConvError.message}`);
        }

        // Insert into ia_resolutions_log
        const resolutionLogEntry = {
            conversation_id: conversationId,
            client_id: conversation.client_id,
            resolution_type: resolutionType,
            resolved_at: updated_at, // Use the same timestamp
        };

        const { error: insertLogError } = await supabase
            .from('ia_resolutions_log')
            .insert(resolutionLogEntry);

        if (insertLogError) {
            logger.error(`(DB Service) logResolution: Error inserting into ia_resolutions_log for conversation ${conversationId}: ${insertLogError.message}`);
            // Potentially consider rolling back conversation status update if critical
            throw new Error(`Error inserting into resolution log: ${insertLogError.message}`);
        }

        logger.info(`(DB Service) logResolution: Successfully logged resolution for conversation ${conversationId}. Status set to resolved.`);
        return { success: true };

    } catch (err) {
        logger.error(`(DB Service) logResolution: Unexpected error for conversation ${conversationId}: ${err.message}`, err);
        // Re-throw the error so the caller can handle it
        throw err;
    }
};

export const requestHumanHandover = async (conversationId) => {
    logger.debug(`(DB Service) requestHumanHandover: Attempting to set conversation ${conversationId} to pending for human handover.`);

    if (!conversationId) {
        logger.error('(DB Service) requestHumanHandover: conversationId is required.');
        throw new Error('conversationId is required.');
    }

    try {
        const updated_at = new Date().toISOString();
        const { error } = await supabase
        .from('conversations')
        .update({ status: 'escalated_to_human', last_message_at: new Date().toISOString() })
        .eq('conversation_id', conversationId); // Cambiar 'id' por 'conversation_id'

        if (error) {
            logger.error(`(DB Service) requestHumanHandover: Error updating conversation ${conversationId} status to pending: ${error.message}`);
            throw new Error(`Error updating conversation status to pending: ${error.message}`);
        }

        logger.info(`(DB Service) requestHumanHandover: Conversation ${conversationId} status successfully updated to 'pending'.`);
        return { success: true };

    } catch (err) {
        logger.error(`(DB Service) requestHumanHandover: Unexpected error for conversation ${conversationId}: ${err.message}`, err);
        // Re-throw the error so the caller can handle it
        throw err;
    }
};

// BEGIN IMPLEMENTATION
/**
 * Logs a successful AI resolution for usage tracking.
 * @param {object} resolutionData - The data to insert into ia_resolutions_log.
 * @returns {Promise<object>} The inserted data.
 */
export const logIaResolution = async (resolutionData) => {
  const { data, error } = await supabase
    .from('ia_resolutions_log')
    .insert([resolutionData])
    .select();

  if (error) {
    logger.error('(DB Service) Error logging IA resolution:', error);
    throw new Error('Could not log IA resolution.');
  }

  if (!data || data.length === 0) {
    logger.error('(DB Service) IA resolution logged but no data returned.');
    throw new Error('IA resolution logged but no data returned.');
  }

  return data[0];
};
// END IMPLEMENTATION


// --- New Analytics Service Functions ---

export const getSentimentDistribution = async (clientId, periodOptions) => {
    if (!clientId || !periodOptions || !periodOptions.startDate || !periodOptions.endDate) {
        logger.warn('(DB Service) Invalid params for getSentimentDistribution: clientId, startDate, and endDate are required.');
        return { error: 'clientId and periodOptions (with startDate, endDate) are required.' };
    }
    try {
        const { data, error } = await supabase.rpc('get_sentiment_distribution_for_client', {
            p_client_id: clientId,
            p_start_date: periodOptions.startDate,
            p_end_date: periodOptions.endDate
        });

        if (error) {
            logger.error('(DB Service) Error calling get_sentiment_distribution_for_client RPC:', error);
            return { error: error.message };
        }
        logger.info(`(DB Service) Sentiment distribution fetched for client ${clientId}`);
        return { data };
    } catch (err) {
        logger.error('(DB Service) Exception in getSentimentDistribution:', err);
        return { error: 'An unexpected error occurred while fetching sentiment distribution.' };
    }
};

export const getTopicAnalytics = async (clientId, periodOptions, topN = 10) => {
    if (!clientId || !periodOptions || !periodOptions.startDate || !periodOptions.endDate) {
        logger.warn('(DB Service) Invalid params for getTopicAnalytics: clientId and periodOptions (with startDate, endDate) are required.');
        return { error: 'clientId and periodOptions (with startDate, endDate) are required.' };
    }

    try {
        const { data: topTopics, error: topicsError } = await supabase
            .from('analyzed_conversation_topics')
            .select('topic_id, topic_name, query_count, representative_queries') // normalized_query_text no longer strictly needed here for filtering logs
            .eq('client_id', clientId)
            .order('query_count', { ascending: false })
            .limit(topN);

        if (topicsError) {
            logger.error(`(DB Service) Error fetching top topics for client ${clientId}:`, topicsError);
            return { error: topicsError.message };
        }

        if (!topTopics || topTopics.length === 0) {
            return { data: [], message: "No topic data available for the selected client or period." };
        }

        const analyticsResults = [];
        for (const topic of topTopics) {
            const { data: topicMembershipEntries, error: logsError } = await supabase
                .from('topic_membership')
                .select(`
                    rag_log:rag_interaction_logs (
                        log_id,
                        was_escalated,
                        conversation_id,
                        created_at
                    )
                `)
                .eq('topic_id', topic.topic_id)
                .eq('client_id', clientId)
                .gte('rag_log.created_at', periodOptions.startDate)
                .lte('rag_log.created_at', periodOptions.endDate + 'T23:59:59.999Z');

            if (logsError) {
                logger.error(`(DB Service) Error fetching RAG logs for topic ${topic.topic_id} via membership:`, logsError);
                analyticsResults.push({
                    topic_id: topic.topic_id,
                    topic_name: topic.topic_name,
                    total_queries_in_topic: topic.query_count,
                    representative_queries: topic.representative_queries,
                    queries_in_period: 0,
                    escalation_rate: 0,
                    average_sentiment: null,
                    error_detail: "Failed to fetch interaction logs for detailed metrics."
                });
                continue;
            }

            const topicSpecificLogs = topicMembershipEntries ? topicMembershipEntries.map(entry => entry.rag_log).filter(log => log !== null) : [];

            let escalatedCount = 0;
            const conversationIdsForSentiment = new Set();
            topicSpecificLogs.forEach(log => {
                if (log.was_escalated) escalatedCount++;
                if (log.conversation_id) conversationIdsForSentiment.add(log.conversation_id);
            });

            const queriesInPeriod = topicSpecificLogs.length;
            const escalationRate = queriesInPeriod > 0 ? (escalatedCount / queriesInPeriod) : 0;

            let averageSentiment = null;
            if (conversationIdsForSentiment.size > 0) {
                const { data: messagesForSentiment, error: messagesError } = await supabase
                    .from('messages')
                    .select('sentiment')
                    .in('conversation_id', Array.from(conversationIdsForSentiment))
                    // .eq('client_id', clientId) // Add if messages table has client_id and RLS doesn't cover via conversation_id join
                    .gte('timestamp', periodOptions.startDate)
                    .lte('timestamp', periodOptions.endDate + 'T23:59:59.999Z')
                    .not('sentiment', 'is', null);

                if (messagesError) {
                    logger.error(`(DB Service) Error fetching messages for sentiment (topic: ${topic.topic_name}, client: ${clientId}):`, messagesError);
                } else if (messagesForSentiment && messagesForSentiment.length > 0) {
                    let sentimentSum = 0;
                    let validSentimentCount = 0;
                    messagesForSentiment.forEach(msg => {
                        if (msg.sentiment === 'positive') { sentimentSum += 1; validSentimentCount++; }
                        else if (msg.sentiment === 'negative') { sentimentSum -= 1; validSentimentCount++; }
                        else if (msg.sentiment === 'neutral') { /* sentimentSum += 0; */ validSentimentCount++; }
                    });
                    if (validSentimentCount > 0) averageSentiment = sentimentSum / validSentimentCount;
                }
            }

            analyticsResults.push({
                topic_id: topic.topic_id,
                topic_name: topic.topic_name,
                total_queries_in_topic: topic.query_count, // Overall count from analyzed_conversation_topics table
                representative_queries: topic.representative_queries,
                queries_in_period: queriesInPeriod, // Count of logs for this topic within the selected period
                escalation_rate: escalationRate,
                average_sentiment: averageSentiment
            });
        }
        return { data: analyticsResults };
    } catch (err) {
        // Ensure clientId is accessible in this catch block or remove it from the log message.
        // It's defined in the function's scope, so it should be fine.
        logger.error(`(DB Service) Exception in getTopicAnalytics for client ${clientId}:`, err);
        return { error: 'An unexpected error occurred while fetching topic analytics.' };
    }
};

export const getKnowledgeSourcePerformance = async (clientId, periodOptions) => {
    if (!clientId || !periodOptions || !periodOptions.startDate || !periodOptions.endDate) {
        logger.warn('(DB Service) Invalid params for getKnowledgeSourcePerformance: clientId and periodOptions (with startDate, endDate) are required.');
        return { error: 'clientId and periodOptions (with startDate, endDate) are required.' };
    }

    try {
        const performanceResults = new Map(); // Key: source_id (from knowledge_sources)

        // 1. Initialize with all knowledge sources for the client
        const { data: allSources, error: sourcesError } = await supabase
            .from('knowledge_sources')
            .select('source_id, source_name, custom_title, metadata') // Include metadata for chunk_count if available
            .eq('client_id', clientId);

        if (sourcesError) {
            logger.error(`(DB Service) Error fetching knowledge sources for client ${clientId}:`, sourcesError);
            return { error: `Failed to fetch knowledge sources: ${sourcesError.message}` };
        }

        allSources.forEach(source => {
            performanceResults.set(source.source_id, {
                source_id: source.source_id,
                source_name: source.custom_title || source.source_name,
                total_chunks_in_source: source.metadata?.chunk_count || 0, // From source's own metadata
                direct_positive_chunk_feedback_count: 0,
                direct_negative_chunk_feedback_count: 0,
                direct_neutral_chunk_feedback_count: 0,
                total_direct_chunk_feedback_count: 0,
                retrieval_count_in_rag_interactions: 0, // How many RAG interactions used this source
                retrieval_in_ia_resolved_convos_count: 0,
                retrieval_in_escalated_convos_count: 0,
                // For avg_overall_response_rating_when_used
                overall_response_ratings_sum: 0,
                overall_response_ratings_count: 0,
                avg_overall_response_rating_when_used: null
            });
        });

        // 2. Fetch and process direct chunk feedback
        const { data: directFeedbackEntries, error: feedbackError } = await supabase
            .from('rag_feedback_log')
            .select('rating, knowledge_base_chunk_id, kb:knowledge_base (id, metadata)')
            .eq('client_id', clientId)
            .eq('feedback_type', 'chunk_relevance') // Only feedback directly on chunks
            .not('knowledge_base_chunk_id', 'is', null) // Ensure chunk ID is present
            .gte('created_at', periodOptions.startDate)
            .lte('created_at', periodOptions.endDate + 'T23:59:59.999Z');

        if (feedbackError) {
            logger.error(`(DB Service) Error fetching direct chunk feedback for client ${clientId}:`, feedbackError);
            // Continue, as other metrics might still be calculable
        } else if (directFeedbackEntries) {
            for (const feedback of directFeedbackEntries) {
                const sourceId = feedback.kb?.metadata?.original_source_id;
                if (sourceId && performanceResults.has(sourceId)) {
                    const stats = performanceResults.get(sourceId);
                    stats.total_direct_chunk_feedback_count++;
                    if (feedback.rating === 1) stats.direct_positive_chunk_feedback_count++;
                    else if (feedback.rating === -1) stats.direct_negative_chunk_feedback_count++;
                    else if (feedback.rating === 0) stats.direct_neutral_chunk_feedback_count++;
                }
            }
        }

        // 3. Fetch RAG interactions and link to conversation outcomes and overall feedback
        const { data: ragInteractions, error: ragLogsError } = await supabase
            .from('rag_interaction_logs')
            .select('log_id, retrieved_context, conversation_id, was_escalated')
            .eq('client_id', clientId)
            .gte('response_timestamp', periodOptions.startDate) // Assuming response_timestamp is more relevant for period
            .lte('response_timestamp', periodOptions.endDate + 'T23:59:59.999Z');

        if (ragLogsError) {
            logger.error(`(DB Service) Error fetching RAG interaction logs for client ${clientId}:`, ragLogsError);
        } else if (ragInteractions) {
            const conversationIds = [...new Set(ragInteractions.map(log => log.conversation_id).filter(id => id))];
            let conversationStats = {}; // Store status by conversation_id

            if (conversationIds.length > 0) {
                const { data: convData, error: convError } = await supabase
                    .from('conversations') // Assuming this table exists and has 'status'
                    .select('conversation_id, status')
                    .in('conversation_id', conversationIds);
                if (convError) logger.error("(DB Service) Error fetching conversation statuses:", convError);
                else convData.forEach(c => conversationStats[c.conversation_id] = c.status);
            }

            const ragLogIdsForFeedback = ragInteractions.map(log => log.log_id);
            let overallFeedbackRatings = {}; // rag_interaction_log_id -> { sum_ratings, count_ratings }
            if (ragLogIdsForFeedback.length > 0) {
                 const { data: overallFeedbacks, error: overallFeedbackError } = await supabase
                    .from('rag_feedback_log')
                    .select('rag_interaction_log_id, rating')
                    .in('rag_interaction_log_id', ragLogIdsForFeedback)
                    .eq('client_id', clientId) // ensure feedback is for this client
                    .eq('feedback_type', 'response_quality'); // Or other relevant overall types
                 if (overallFeedbackError) logger.error("(DB Service) Error fetching overall response feedback:", overallFeedbackError);
                 else {
                    overallFeedbacks.forEach(f => {
                        if (!overallFeedbackRatings[f.rag_interaction_log_id]) {
                            overallFeedbackRatings[f.rag_interaction_log_id] = { sum: 0, count: 0 };
                        }
                        if (typeof f.rating === 'number') { // Ensure rating is a number
                           overallFeedbackRatings[f.rag_interaction_log_id].sum += f.rating;
                           overallFeedbackRatings[f.rag_interaction_log_id].count += 1;
                        }
                    });
                 }
            }

            for (const log of ragInteractions) {
                const sourcesInThisLog = new Set();
                if (log.retrieved_context && Array.isArray(log.retrieved_context)) {
                    log.retrieved_context.forEach(chunk => {
                        const sourceId = chunk.metadata?.original_source_id;
                        if (sourceId && performanceResults.has(sourceId)) {
                            sourcesInThisLog.add(sourceId);
                        }
                    });
                }

                sourcesInThisLog.forEach(sourceId => {
                    const stats = performanceResults.get(sourceId);
                    stats.retrieval_count_in_rag_interactions++;

                    const convStatus = log.conversation_id ? conversationStats[log.conversation_id] : null;
                    if (convStatus === 'resolved_by_ia') {
                        stats.retrieval_in_ia_resolved_convos_count++;
                    }
                    if (log.was_escalated || convStatus === 'escalated_to_human' || convStatus === 'closed_by_agent') {
                        stats.retrieval_in_escalated_convos_count++;
                    }

                    if (overallFeedbackRatings[log.log_id] && overallFeedbackRatings[log.log_id].count > 0) {
                        stats.overall_response_ratings_sum += overallFeedbackRatings[log.log_id].sum;
                        stats.overall_response_ratings_count += overallFeedbackRatings[log.log_id].count;
                    }
                });
            }
        }

        performanceResults.forEach(stats => {
            if (stats.overall_response_ratings_count > 0) {
                stats.avg_overall_response_rating_when_used = stats.overall_response_ratings_sum / stats.overall_response_ratings_count;
            }
        });

        const finalResultsArray = Array.from(performanceResults.values());
        finalResultsArray.sort((a,b) => (b.retrieval_count_in_rag_interactions - a.retrieval_count_in_rag_interactions) || (b.direct_positive_chunk_feedback_count - a.direct_positive_chunk_feedback_count) );

        return { data: finalResultsArray };

    } catch (err) {
        logger.error(`(DB Service) Exception in getKnowledgeSourcePerformance for client ${clientId}:`, err);
        return { error: 'An unexpected error occurred while fetching knowledge source performance.' };
    }
};
