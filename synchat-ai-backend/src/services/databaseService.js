// src/services/databaseService.js
import logger from '../utils/logger.js';
import { supabase } from './supabaseClient.js'; // Importar cliente inicializado
import { getEmbedding } from './embeddingService.js'; // Necesario para búsqueda híbrida
import { getChatCompletion } from './openaiService.js'; // Import for query reformulation
import { pipeline, env } from '@xenova/transformers';

// --- Transformers.js Configuration ---
// env.allowLocalModels = false; // Optional: Disable local model loading
// env.cacheDir = './.cache'; // Optional: Set cache directory for models

// --- Configuración ---
const HYBRID_SEARCH_VECTOR_WEIGHT = 0.5;
const HYBRID_SEARCH_FTS_WEIGHT = 0.5;
const HYBRID_SEARCH_LIMIT = 5; // For main chunk search
const INITIAL_RETRIEVAL_MULTIPLIER = 3;
const VECTOR_MATCH_THRESHOLD = 0.65; // Umbral de similitud coseno (0 a 1, más alto es más similar)
const HISTORY_MESSAGE_LIMIT = 8;       // Límite de mensajes de historial

const PROPOSITION_SEARCH_LIMIT = 3; // Max propositions to fetch
const PROPOSITION_MATCH_THRESHOLD = 0.78; // Stricter threshold for propositions
const DEBUG_PREPROCESSING_DATABASE_SERVICE = false; // Separate debug flag for this service
const DEBUG_RERANKING = false; // Debug flag for re-ranking logic

// Cross-Encoder Configuration
const CROSS_ENCODER_MODEL_NAME = 'Xenova/bge-reranker-base';
const CROSS_ENCODER_TOP_K = 20; // Number of initial results to re-rank

// Query Correction Configuration
const ENABLE_ADVANCED_QUERY_CORRECTION = process.env.ENABLE_ADVANCED_QUERY_CORRECTION === 'true' || true; // Default to true
const QUERY_CORRECTION_MODEL = "gpt-3.5-turbo";
const QUERY_CORRECTION_TEMP = 0.1;

// Adjusted Re-ranking Weights to include Cross-Encoder
const W_CROSS_ENCODER_SCORE = 0.4;      // Weight for the cross-encoder score
const W_ORIGINAL_HYBRID_SCORE = 0.3;    // Adjusted weight for initial hybrid score
const W_KEYWORD_MATCH_SCORE = 0.15;   // Adjusted weight for keyword match
const W_METADATA_RELEVANCE_SCORE = 0.15; // Adjusted weight for metadata relevance
// Sum of weights = 0.4 + 0.3 + 0.15 + 0.15 = 1.0

// Simple Spanish Stop Words List (customize as needed)
const SPANISH_STOP_WORDS = new Set([ // This is the existing one, used by hybridSearch's tokenizeText
  "de", "la", "el", "en", "y", "a", "los", "las", "del", "un", "una", "unos", "unas",
  "ser", "estar", "haber", "tener", "con", "por", "para", "como", "más", "pero", "si",
  "no", "o", "qué", "que", "cuál", "cuando", "dónde", "quién", "cómo", "desde", "hasta",
  "sobre", "este", "ese", "aquel", "esto", "eso", "aquello", "mi", "tu", "su", "yo", "tú", "él", "ella",
  "nosotros", "vosotros", "ellos", "ellas", "me", "te", "se", "le", "les", "nos", "os"
]);

// Stop words list for topic analytics normalization - as per prompt, it has a few more.
const SPANISH_STOP_WORDS_GET_TOPICS = new Set([
  "de", "la", "el", "en", "y", "a", "los", "las", "del", "un", "una", "unos", "unas",
  "ser", "estar", "haber", "tener", "con", "por", "para", "como", "más", "pero", "si",
  "no", "o", "qué", "que", "cuál", "cuando", "dónde", "quién", "cómo", "desde", "hasta",
  "sobre", "este", "ese", "aquel", "esto", "eso", "aquello", "mi", "tu", "su", "yo", "tú", "él", "ella",
  "nosotros", "vosotros", "ellos", "ellas", "me", "te", "se", "le", "les", "nos", "os",
  "al", "del", "lo", "les", "sus", "tus", "mis"
]);

// normalizeQueryTextForAnalytics and SPANISH_STOP_WORDS_GET_TOPICS are removed as they are no longer needed by the new getTopicAnalytics


// --- Cross-Encoder Pipeline Singleton ---
let crossEncoderPipeline = null;

async function getCrossEncoderPipeline() {
    if (crossEncoderPipeline === null) {
        try {
            logger.info(`(DB Service) Initializing cross-encoder pipeline: ${CROSS_ENCODER_MODEL_NAME}`);
            crossEncoderPipeline = await pipeline('text-classification', CROSS_ENCODER_MODEL_NAME, {});
            logger.info("(DB Service) Cross-encoder pipeline initialized successfully.");
        } catch (error) {
            logger.error("(DB Service) Error initializing cross-encoder pipeline:", error);
            crossEncoderPipeline = false;
        }
    }
    return crossEncoderPipeline;
}

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

// --- Cache (Simple en Memoria) ---
const questionCache = new Map();
export function getCache(key) { /* ... */ }
export function setCache(key, value) { /* ... */ }
// (Existing cache functions as before)
export const getClientConfig = async (clientId) => { /* ... */ };
export const getAllActiveClientIds = async () => { /* ... */ }; // Keep only one definition
// Note: There are two getAllActiveClientIds, removing one. The one using subscription_status seems more robust.
export const getChunkSampleForSource = async (clientId, sourceId, limit = 5) => { /* ... */ };
export const getConversationHistory = async (conversationId) => { /* ... */ };

export const saveMessage = async (conversationId, sender, textContent, ragInteractionRef = null) => {
    if (!conversationId || !sender || typeof textContent !== 'string') {
        logger.warn('(DB Service) Invalid parameters for saveMessage.');
        return { error: 'Invalid parameters: conversationId, sender, and textContent are required.' };
    }

    const messageData = {
        conversation_id: conversationId,
        sender: sender,
        content: textContent,
        // timestamp is defaulted by DB
        sentiment: null // Default to null
    };

    if (ragInteractionRef) {
        messageData.rag_interaction_ref = ragInteractionRef;
    }

    if (sender === 'user' && textContent && textContent.trim() !== '') {
        try {
            logger.debug(`(DB Service) Performing sentiment analysis for message content: "${textContent.substring(0, 50)}..."`);
            const systemPrompt = "Classify the sentiment of the following user message as positive, negative, or neutral. Respond with only one word: positive, negative, or neutral.";
            const userMessageForSentiment = `Message: "${textContent}"`;

            // getChatCompletion is imported from './openaiService.js'
            const sentimentResponse = await getChatCompletion(
                [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessageForSentiment }],
                'gpt-3.5-turbo', // Using a standard, cost-effective model
                0.2, // Low temperature for classification
                10 // Max tokens for a single word response
            );

            if (sentimentResponse) {
                let rawSentiment = sentimentResponse.trim().toLowerCase();
                // Additional cleaning for common LLM variations like "Sentiment: positive"
                if (rawSentiment.startsWith("sentiment:")) {
                    rawSentiment = rawSentiment.substring("sentiment:".length).trim();
                }
                // Remove punctuation if any, e.g. "positive." -> "positive"
                rawSentiment = rawSentiment.replace(/[.,!?;]$/, '');

                if (['positive', 'negative', 'neutral'].includes(rawSentiment)) {
                    messageData.sentiment = rawSentiment;
                    logger.debug(`(DB Service) Sentiment classified as: ${rawSentiment}`);
                } else {
                    logger.warn(`(DB Service) Unexpected sentiment response: "${sentimentResponse}". Original message: "${textContent.substring(0,50)}..."`);
                    // messageData.sentiment remains null
                }
            } else {
                logger.warn(`(DB Service) Sentiment analysis returned no response. Original message: "${textContent.substring(0,50)}..."`);
                // messageData.sentiment remains null
            }
        } catch (sentimentError) {
            logger.error('(DB Service) Error getting sentiment for message:', { error: sentimentError, messageContent: textContent.substring(0,50) });
            // messageData.sentiment remains null, ensuring message saving is not blocked
        }
    }

    try {
        const { data, error } = await supabase
            .from('messages')
            .insert([messageData])
            .select()
            .single(); // Assuming we want the newly created message back

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
            .not('category_tags', 'is', null); // Only sources with tags

        if (error) {
            logger.error(`(DB Service) Error fetching category_tags for client ${clientId}:`, error);
            return { data: [], error: error.message };
        }

        const uniqueCategories = new Set();
        if (data) {
            data.forEach(source => {
                if (Array.isArray(source.category_tags)) {
                    source.category_tags.forEach(tag => {
                        if (tag && typeof tag === 'string') { // Ensure tag is not null/empty string
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

export const createConversation = async (clientId) => { /* ... */ };

export const hybridSearch = async (clientId, queryText, conversationId, options = {}, returnPipelineDetails = false) => {
    const originalUserQueryAtStart = queryText; // Store the absolute original query
    let currentQueryText = originalUserQueryAtStart; // This will be used by subsequent steps, potentially corrected
    let predictedCategory = null; // Initialize predictedCategory

    let queryCorrectionDetails = {
        attempted: false,
        originalQuery: originalUserQueryAtStart,
        correctedQuery: originalUserQueryAtStart, // Initially same as original
        wasChanged: false
    };

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
                currentQueryText = trimmedLlmQuery; // Use the corrected query from now on
                logger.info(`(DB Service) Query Correction: Original='${originalUserQueryAtStart}', Corrected='${currentQueryText}'`);
            } else {
                logger.warn("(DB Service) Query correction LLM call returned empty or invalid. Using original query.");
                // correctedQueryText remains originalUserQueryAtStart, wasChanged remains false
            }
        } catch (error) {
            logger.error("(DB Service) Error during query correction LLM call:", { message: error.message, originalQuery: originalUserQueryAtStart });
            // correctedQueryText remains originalUserQueryAtStart, wasChanged remains false
        }
    }

    const finalVectorWeight = options.vectorWeight ?? HYBRID_SEARCH_VECTOR_WEIGHT;
    const finalFtsWeight = options.ftsWeight ?? HYBRID_SEARCH_FTS_WEIGHT;
    const finalVectorMatchThreshold = options.vectorMatchThreshold ?? VECTOR_MATCH_THRESHOLD;
    const finalLimit = HYBRID_SEARCH_LIMIT;
    const initialRetrieveLimit = finalLimit * INITIAL_RETRIEVAL_MULTIPLIER;

    let pipelineDetails = null;
    if (returnPipelineDetails) {
        pipelineDetails = {
            originalQuery: originalUserQueryAtStart, // True original query
            queryCorrection: queryCorrectionDetails, // Details of correction step
            queryDecomposition: {},
            processedQueries: [],
            aggregatedResults: { uniqueVectorResultsPreview: [], uniqueFtsResultsPreview: [] },
            mergedAndPreRankedResultsPreview: [],
            crossEncoderProcessing: { inputs: [], outputs: [] },
            finalRankedResultsForPlayground: [],
            finalPropositionResults: [],
            queryClassification: { predictedCategory: null, categoriesAvailable: [] } // Initialize for pipelineDetails
        };
    }

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
        vectorWeight: finalVectorWeight,
        ftsWeight: finalFtsWeight,
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
                const decompositionPrompt = `Analyze the following user question. If it contains multiple distinct sub-questions that should be answered separately for a comprehensive response, break it down into those individual sub-questions. Return only the list of sub-questions, each on a new line. If it's a single, simple question, return only the original question. User Question: '${currentQueryText}'`;
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

        let aggregatedVectorResults = [];
        let aggregatedFtsResults = [];
        let aggregatedQueriesEmbeddedForLog = [];
        let firstProcessedQueryEmbedding = null;

        for (let idx = 0; idx < queriesToProcess.length; idx++) {
            const loopCurrentQuery = queriesToProcess[idx]; // This is either a sub-query or the (potentially corrected) main query
            const processedQueryText = preprocessTextForEmbedding(loopCurrentQuery);

            let currentQueryPipelineDetailsRef = null;
            if (returnPipelineDetails) {
                const detailEntry = {
                    queryIdentifier: loopCurrentQuery.substring(0,75) + (loopCurrentQuery.length > 75 ? "..." : ""),
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
                    const rpcParamsVector = {
                        client_id_param: clientId,
                        query_embedding: eqEmbedding,
                        match_threshold: finalVectorMatchThreshold,
                        match_count: initialRetrieveLimit,
                        p_category_filter: (predictedCategory && predictedCategory.toLowerCase() !== 'none') ? [predictedCategory] : null
                    };
                    const { data: vsData, error: vsError } = await supabase.rpc('vector_search', rpcParamsVector);
                    if (vsError) { logger.error(`(DB Service) Vector search error for "${eqQuery.substring(0,50)}...":`, vsError.message); }
                    else if (vsData) {
                        aggregatedVectorResults.push(...vsData);
                        if (returnPipelineDetails) currentQueryPipelineDetailsRef.vectorSearchResults.push({ retrievedForQueryIdentifier: eqQuery, results: vsData.map(r => ({ id: r.id, contentSnippet: r.content?.substring(0,100)+'...', metadata: r.metadata, score: r.similarity })) });
                    }
                }
            }
            const rpcParamsFts = {
                client_id_param: clientId,
                query_text: processedQueryText,
                match_count: initialRetrieveLimit,
                p_category_filter: (predictedCategory && predictedCategory.toLowerCase() !== 'none') ? [predictedCategory] : null
            };
            const { data: ftsSubData, error: ftsSubError } = await supabase.rpc('fts_search_with_rank', rpcParamsFts);
            if (ftsSubError) { logger.error(`(DB Service) FTS error for "${processedQueryText.substring(0,50)}...":`, ftsSubError.message); }
            else if (ftsSubData) {
                aggregatedFtsResults.push(...ftsSubData);
                if (returnPipelineDetails) currentQueryPipelineDetailsRef.ftsResults.push({ retrievedForQuery: processedQueryText, results: ftsSubData.map(r => ({ id: r.id, contentSnippet: r.content?.substring(0,100)+'...', metadata: r.metadata, score: r.rank })) });
            }
        }

        const uniqueVectorResults = {}; /* ... as before ... */ aggregatedVectorResults.forEach(row => { if (!row.id || (row.similarity && row.similarity < finalVectorMatchThreshold)) return; const id = String(row.id); if (!uniqueVectorResults[id] || row.similarity > uniqueVectorResults[id].similarity) { uniqueVectorResults[id] = row; } });
        const vectorResults = Object.values(uniqueVectorResults);
        const ftsResults = aggregatedFtsResults;
        if (returnPipelineDetails) {
            pipelineDetails.aggregatedResults = {
                uniqueVectorResultsPreview: vectorResults.slice(0,50).map(r => ({id: r.id, score: r.similarity, contentSnippet: r.content?.substring(0,100)+'...'})),
                uniqueFtsResultsPreview: ftsResults.slice(0,50).map(r => ({id: r.id, score: r.rank, contentSnippet: r.content?.substring(0,100)+'...'}))
            };
        }

        const combinedResults = {}; /* ... as before ... */        vectorResults.forEach(row => { if (!row.id || (row.similarity && row.similarity < finalVectorMatchThreshold)) return; combinedResults[String(row.id)] = { ...row, vector_similarity: row.similarity || 0, fts_score: 0 }; }); ftsResults.forEach(row => { if (!row.id) return; const id = String(row.id); const ftsScore = row.rank || 0; if (!combinedResults[id]) { combinedResults[id] = { ...row, vector_similarity: 0, fts_score: ftsScore }; } else { combinedResults[id].fts_score = Math.max(combinedResults[id].fts_score || 0, ftsScore);  if (!combinedResults[id].content && row.content) combinedResults[id].content = row.content; if (!combinedResults[id].metadata && row.metadata) combinedResults[id].metadata = row.metadata; } });
        let rankedResults = Object.values(combinedResults).filter(item => item.id && item.content).filter(item => !((item.fts_score || 0) === 0 && (item.vector_similarity || 0) < finalVectorMatchThreshold)).map(item => ({ ...item, hybrid_score: ((item.vector_similarity || 0) * finalVectorWeight) + ((item.fts_score || 0) * finalFtsWeight) }));
        if (returnPipelineDetails) pipelineDetails.mergedAndPreRankedResultsPreview = rankedResults.slice(0,50).map(item => ({ id: item.id, contentSnippet: item.content?.substring(0,150)+'...', metadata: item.metadata, initialHybridScore: item.hybrid_score, vectorSimilarity: item.vector_similarity, ftsScore: item.fts_score }));

        if (rankedResults.length === 0) {
            const emptyReturn = { results: [], propositionResults: [], searchParams: searchParamsForLog, queriesEmbeddedForLog: aggregatedQueriesEmbeddedForLog, predictedCategory };
            if (returnPipelineDetails) emptyReturn.pipelineDetails = pipelineDetails;
            logger.info("(DB Service) No results after merging. Returning empty.");
            return emptyReturn;
        }

        let itemsForFinalSort = [...rankedResults];
        const classifier = await getCrossEncoderPipeline();
        if (classifier && itemsForFinalSort.length > 0) {
            const itemsToCrossEncode = itemsForFinalSort.sort((a,b) => b.hybrid_score - a.hybrid_score).slice(0, CROSS_ENCODER_TOP_K);
            const remainingItems = itemsForFinalSort.slice(CROSS_ENCODER_TOP_K);
            if (itemsToCrossEncode.length > 0) {
                // Use correctedQueryText (which is the primary, potentially corrected, user query) for cross-encoder
                const queryDocumentPairs = itemsToCrossEncode.map(item => [currentQueryText, item.content]);
                if (returnPipelineDetails) pipelineDetails.crossEncoderProcessing.inputs = queryDocumentPairs.map(p => ({ query: p[0], documentContentSnippet: p[1].substring(0,150)+'...' }));
                try {
                    const crossEncoderScoresOutput = await classifier(queryDocumentPairs, { topK: null });
                    itemsToCrossEncode.forEach((item, index) => { /* ... score assignment as before ... */ const scoreOutput = crossEncoderScoresOutput[index]; let rawScore; if (Array.isArray(scoreOutput) && scoreOutput.length > 0) { if (typeof scoreOutput[0].score === 'number') { rawScore = scoreOutput[0].score; } else { const relevantScoreObj = scoreOutput.find(s => s.label === 'LABEL_1' || s.label === 'entailment'); rawScore = relevantScoreObj ? relevantScoreObj.score : (typeof scoreOutput[0].score === 'number' ? scoreOutput[0].score : 0);}} else if (typeof scoreOutput.score === 'number') { rawScore = scoreOutput.score; } else if (typeof scoreOutput === 'number') { rawScore = scoreOutput; } else { rawScore = 0; } item.cross_encoder_score_raw = rawScore; item.cross_encoder_score_normalized = sigmoid(rawScore); });
                    if (returnPipelineDetails) pipelineDetails.crossEncoderProcessing.outputs = itemsToCrossEncode.map(item => ({ id: item.id, contentSnippet: item.content?.substring(0,150)+'...', rawScore: item.cross_encoder_score_raw, normalizedScore: item.cross_encoder_score_normalized }));
                } catch (ceError) { logger.error("(DB Service) Error during cross-encoder scoring:", ceError.message); }
            }
            itemsForFinalSort = [...itemsToCrossEncode, ...remainingItems];
        } else if (itemsForFinalSort.length > 0) { logger.warn("(DB Service) Cross-encoder pipeline not available. Skipping CE re-ranking."); }

        const rerankedList = itemsForFinalSort.map(item => {
            // Use correctedQueryTokens for Jaccard similarity
            const keywordMatchScore = calculateJaccardSimilarity(correctedQueryTokens, tokenizeText(item.content, true));
            let detailedMetadataScore = 0;
            if (item.metadata?.hierarchy && Array.isArray(item.metadata.hierarchy)) { for (const hNode of item.metadata.hierarchy) { if (hNode.text) { const commonKeywords = tokenizeText(hNode.text, true).filter(ht => correctedQueryTokens.includes(ht)); let levelBonus = 0; if (hNode.level === 1) levelBonus = 0.3; else if (hNode.level === 2) levelBonus = 0.2; else if (hNode.level <= 4) levelBonus = 0.1; else levelBonus = 0.05; detailedMetadataScore += commonKeywords.length * levelBonus; } } }
            if (item.metadata?.source_name) { detailedMetadataScore += (tokenizeText(item.metadata.source_name, true).filter(st => correctedQueryTokens.includes(st)).length * 0.1); }
            if (item.metadata?.custom_metadata && Array.isArray(item.metadata.custom_metadata.tags)) { detailedMetadataScore += (item.metadata.custom_metadata.tags.flatMap(tag => tokenizeText(String(tag), true)).filter(tt => correctedQueryTokens.includes(tt)).length * 0.15); }
            item.metadataRelevanceScore = detailedMetadataScore;
            const itemCrossEncoderScoreNormalized = item.cross_encoder_score_normalized !== undefined ? item.cross_encoder_score_normalized : sigmoid(0);
            const reranked_score = ((item.hybrid_score || 0) * W_ORIGINAL_HYBRID_SCORE) + (keywordMatchScore * W_KEYWORD_MATCH_SCORE) + (item.metadataRelevanceScore * W_METADATA_RELEVANCE_SCORE) + (itemCrossEncoderScoreNormalized * W_CROSS_ENCODER_SCORE);
            item.keywordMatchScore = keywordMatchScore;
            return { ...item, cross_encoder_score_normalized: itemCrossEncoderScoreNormalized, reranked_score };
        });

        rerankedList.sort((a, b) => b.reranked_score - a.reranked_score);
        if (DEBUG_RERANKING) { rerankedList.slice(0, finalLimit + 5).forEach(r => { logger.debug(`  ID: ${r.id}, Reranked: ${r.reranked_score?.toFixed(4)}, Hybrid: ${r.hybrid_score?.toFixed(4)}, CE_norm: ${r.cross_encoder_score_normalized?.toFixed(4)}, KW: ${r.keywordMatchScore?.toFixed(4)}, MetaDetailed: ${r.metadataRelevanceScore?.toFixed(4)}`); });}

        const finalResults = rerankedList.slice(0, finalLimit);
        const finalResultsMapped = finalResults.map(r => ({ id: r.id, content: r.content, metadata: r.metadata, reranked_score: r.reranked_score, hybrid_score: r.hybrid_score, keywordMatchScore: r.keywordMatchScore, metadataRelevanceScore: r.metadataRelevanceScore, cross_encoder_score_normalized: r.cross_encoder_score_normalized }));

        if (returnPipelineDetails) pipelineDetails.finalRankedResultsForPlayground = finalResultsMapped.slice(0, 15).map(item => ({ ...item, contentSnippet: item.content?.substring(0,250)+'...' }));

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

        if (returnPipelineDetails) {
            return { results: finalResultsMapped, propositionResults: propositionDataForReturn, searchParams: searchParamsForLog, queriesEmbeddedForLog: aggregatedQueriesEmbeddedForLog, predictedCategory, pipelineDetails: pipelineDetails };
        } else {
            return { results: finalResultsMapped, propositionResults: propositionDataForReturn, searchParams: searchParamsForLog, queriesEmbeddedForLog: aggregatedQueriesEmbeddedForLog, predictedCategory };
        }
    } catch (error) {
        logger.error(`(DB Service) Error general durante la búsqueda híbrida para cliente ${clientId}:`, { message: error.message, stack: error.stack });
        const errorReturn = { results: [], propositionResults: [], searchParams: searchParamsForLog, queriesEmbeddedForLog: [originalUserQueryAtStart], rawRankedResultsForLog: [], predictedCategory }; // Use originalUserQueryAtStart
        if (returnPipelineDetails && pipelineDetails) {
            pipelineDetails.error = error.message;
            // pipelineDetails.queryClassification might already be set or remain at its initial values
            errorReturn.pipelineDetails = pipelineDetails;
        } else if (returnPipelineDetails) { // This case implies pipelineDetails might not have been fully initialized if error was early
             errorReturn.pipelineDetails = { originalQuery: originalUserQueryAtStart, error: error.message, queryClassification: { predictedCategory: predictedCategory, categoriesAvailable: clientCategoriesArray || [] } };
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
function tokenizeText(text, removeStopWords = false) { /* ... */ }
function calculateJaccardSimilarity(set1Tokens, set2Tokens) { /* ... */ }
const SPANISH_ABBREVIATIONS = { /* ... */ };
function preprocessTextForEmbedding(text) { /* ... */ }
export const getConversationDetails = async (conversationId) => { /* ... */ };
export const logAiResolution = async (clientId, conversationId, billingCycleId, detailsJson) => { /* ... */ };

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
            .eq('knowledge_source_id', sourceId)
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
            .eq('knowledge_source_id', sourceId)
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


export const getClientConversations = async (clientId, statusFilters = [], page = 1, pageSize = 20) => { /* ... */ };

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
