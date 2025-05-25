// src/services/ingestionService.js
import 'dotenv/config';
import axios from 'axios';
import { load } from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// --- Configuración ---
const MIN_CHUNK_LENGTH_CHARS = 50;    // Mínimo caracteres para considerar un chunk
const TARGET_CHUNK_WORDS = 200;      // Tamaño objetivo de chunk en palabras
const MAX_CHUNK_WORDS = 300;         // Máximo absoluto antes de forzar división
const MIN_KEYWORDS_FOR_VALIDATION = 4; // Mínimo palabras clave (largas) para validar chunk
const EMBEDDING_BATCH_SIZE = 20;     // Lotes para generar embeddings
const EMBEDDING_MODEL = "text-embedding-3-small";
const USER_AGENT = 'Mozilla/5.0 (compatible; SynChatBot/1.1; +https://www.synchatai.com/bot)'; // User agent mejorado

// --- Inicialización de Clientes ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseKey || !openaiApiKey) {
    // This check is problematic for a service that might be imported before env is fully loaded.
    // Consider a runtime check within ingestWebsite or a dedicated init function.
    console.error("Critical Error: Missing environment variables (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY). The service cannot start.");
    // In a real service, this might throw an error that prevents the app from starting
    // or use a flag to indicate an unhealthy state.
}

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: openaiApiKey });

// Helper function to update client ingestion status
async function updateClientIngestStatus(clientId, status, errorMessage = null) {
    const updateData = {
        last_ingest_status: status,
        last_ingest_at: new Date().toISOString(),
        last_ingest_error: errorMessage ? errorMessage.substring(0, 500) : null
    };
    try {
        const { error } = await supabase
            .from('synchat_clients')
            .update(updateData)
            .eq('client_id', clientId);
        if (error) {
            console.error(`(Ingestion Service) Failed to update client ${clientId} status to '${status}':`, error.message);
        }
    } catch (dbUpdateError) {
        console.error(`(Ingestion Service) Exception while updating client ${clientId} status to '${status}':`, dbUpdateError.message);
    }
}

// --- Funciones de Ayuda ---

/**
 * Valida la calidad de un chunk de texto.
 */
function validateChunk(text) {
    if (!text || text.trim().length < MIN_CHUNK_LENGTH_CHARS) {
        return false;
    }
    const significantWords = text.match(/\b[a-zA-ZáéíóúñÁÉÍÓÚÑ]{4,}\b/g) || [];
    return significantWords.length >= MIN_KEYWORDS_FOR_VALIDATION;
}

/**
 * Divide el contenido HTML en chunks jerárquicos.
 */
function chunkContent(html, url) {
    console.log("Iniciando chunking jerárquico...");
    const $ = load(html);
    const chunks = [];
    let contextStack = [];
    let currentChunkLines = [];
    let currentWordCount = 0;

    $('script, style, nav, footer, header, aside, form, noscript, iframe, svg, link[rel="stylesheet"], button, input, select, textarea, label, .sidebar, #sidebar, .comments, #comments, .related-posts, .share-buttons, .pagination, .breadcrumb, .modal, .popup, [aria-hidden="true"], [role="navigation"], [role="search"], .ad, .advertisement, #ad, #advertisement').remove();
    console.log("Ruido HTML eliminado.");

    const relevantSelectors = 'h1, h2, h3, h4, h5, h6, p, li, td, th, pre, blockquote';
    $(relevantSelectors).each((i, el) => {
        const $el = $(el);
        const tag = $el.prop('tagName').toLowerCase();
        let text = ($el.text() || '').replace(/\s\s+/g, ' ').trim();

        if (text.length < 15) return;

        let currentHierarchy = [...contextStack];
        if (tag.match(/^h[1-6]$/)) {
            const level = parseInt(tag[1]);
            contextStack = contextStack.slice(0, level - 1);
            contextStack[level - 1] = text;
            currentHierarchy = [...contextStack];
            if (currentWordCount > 0) {
                 const chunkText = currentChunkLines.join('\n');
                 if (validateChunk(chunkText)) {
                      chunks.push({
                          text: chunkText,
                          metadata: { url, hierarchy: [...contextStack.slice(0, level-1)] }
                      });
                 }
                 currentChunkLines = [];
                 currentWordCount = 0;
            }
        }

        const elementWordCount = text.split(/\s+/).length;

        if (currentWordCount > 0 && (currentWordCount + elementWordCount) > MAX_CHUNK_WORDS) {
             const chunkText = currentChunkLines.join('\n');
             if (validateChunk(chunkText)) {
                 chunks.push({
                     text: chunkText,
                     metadata: { url, hierarchy: [...currentHierarchy] }
                 });
            }
            currentChunkLines = [text];
            currentWordCount = elementWordCount;
        } else {
            currentChunkLines.push(text);
            currentWordCount += elementWordCount;
        }

        if (currentWordCount >= TARGET_CHUNK_WORDS) {
             const chunkText = currentChunkLines.join('\n');
             if (validateChunk(chunkText)) {
                 chunks.push({
                     text: chunkText,
                     metadata: { url, hierarchy: [...currentHierarchy] }
                 });
             }
            currentChunkLines = [];
            currentWordCount = 0;
        }
    });

    if (currentWordCount > 0) {
        const chunkText = currentChunkLines.join('\n');
        if (validateChunk(chunkText)) {
            chunks.push({
                text: chunkText,
                metadata: { url, hierarchy: [...contextStack] }
            });
        }
    }
    console.log(`Chunking completado. Generados ${chunks.length} chunks válidos.`);
    return chunks;
}


/**
 * Genera embeddings para los chunks en lotes.
 * Returns { success: boolean, data?: Array, error?: string, totalTokens?: number }
 */
async function generateEmbeddings(chunks) {
    console.log(`Generando embeddings para ${chunks.length} chunks (lotes de ${EMBEDDING_BATCH_SIZE})...`);
    const embeddingsData = [];
    let totalTokens = 0;
    let errorsEncountered = [];

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        const inputs = batchChunks.map(c => c.text.replace(/\n/g, ' '));

        try {
            console.log(`Procesando lote ${Math.floor(i/EMBEDDING_BATCH_SIZE) + 1}/${Math.ceil(chunks.length/EMBEDDING_BATCH_SIZE)}...`);
            const { data: embeddingResponseData, usage } = await openai.embeddings.create({
                model: EMBEDDING_MODEL,
                input: inputs
            });

            if (usage) totalTokens += usage.total_tokens;

            if (!embeddingResponseData || embeddingResponseData.length !== batchChunks.length) {
                 const errorMsg = `Respuesta de embedding inesperada para el lote ${i}. Se recibieron ${embeddingResponseData?.length || 0} embeddings.`;
                 console.warn(errorMsg);
                 errorsEncountered.push(errorMsg);
                 // Mark batch as failed by not adding its embeddings
                 continue;
            }

            batchChunks.forEach((chunk, idx) => {
                if (embeddingResponseData[idx]?.embedding) {
                    embeddingsData.push({
                        ...chunk,
                        embedding: embeddingResponseData[idx].embedding
                    });
                } else {
                     const errorMsg = `No se pudo generar embedding para el chunk ${i+idx}. Texto: "${chunk.text.substring(0,50)}..."`;
                     console.warn(errorMsg);
                     errorsEncountered.push(errorMsg);
                }
            });

             if (i + EMBEDDING_BATCH_SIZE < chunks.length) {
                 await new Promise(resolve => setTimeout(resolve, 500));
             }

        } catch (error) {
            const errorMsg = `Error generando embeddings para el lote ${i}: ${error.message}`;
            console.error(errorMsg);
            errorsEncountered.push(errorMsg);
            // Depending on severity, we might choose to stop all embeddings
            // For now, we'll try to continue with other batches
        }
    }

    if (errorsEncountered.length > 0 && embeddingsData.length === 0) {
        // All batches failed or no embeddings were successfully generated
        return { success: false, error: `No se pudieron generar embeddings. Errores: ${errorsEncountered.join('; ')}`, totalTokens };
    }
    
    console.log(`Embeddings generados para ${embeddingsData.length} chunks. Tokens totales usados: ${totalTokens}. Errores: ${errorsEncountered.length}`);
    return { success: true, data: embeddingsData, totalTokens, errors: errorsEncountered };
}

/**
 * Almacena los chunks con embeddings en Supabase.
 * Returns { success: boolean, data?: any, error?: any, count?: number }
 */
async function storeChunks(clientId, chunksWithEmbeddings) {
    if (!chunksWithEmbeddings || chunksWithEmbeddings.length === 0) {
        console.log("No hay chunks válidos con embeddings para almacenar.");
        return { success: true, message: "No chunks to store.", count: 0 };
    }

    console.log(`Almacenando ${chunksWithEmbeddings.length} chunks en Supabase para cliente ${clientId}...`);
    const recordsToInsert = chunksWithEmbeddings.map(c => ({
        client_id: clientId,
        content: c.text,
        embedding: c.embedding,
        metadata: c.metadata,
    }));

    try {
        const { data, error, count } = await supabase
            .from('knowledge_base')
            .insert(recordsToInsert);

        if (error) {
            console.error("Error al almacenar chunks en Supabase:", error.message);
            if (error.details) console.error("Detalles:", error.details);
            if (error.hint) console.error("Sugerencia:", error.hint);
            return { success: false, error: error.message, details: error.details, count: count || 0 };
        }

        const numStored = count ?? recordsToInsert.length;
        console.log(`Almacenamiento completado. ${numStored} chunks guardados/actualizados.`);
        return { success: true, data, count: numStored };

    } catch (error) {
        console.error("Error inesperado durante el almacenamiento en Supabase:", error);
        return { success: false, error: error.message, count: 0 };
    }
}

// --- Función Principal del Servicio ---
export async function ingestWebsite(clientId, urlToIngest) {
    if (!supabaseUrl || !supabaseKey || !openaiApiKey) {
        console.error("Ingestion Service: Missing critical environment variables.");
        return { success: false, error: "Server configuration error: Missing API keys." };
    }
     if (!clientId || !urlToIngest || !urlToIngest.startsWith('http')) {
        return { success: false, error: "Invalid input: ClientId and a full URL are required."};
    }

    console.log(`\n--- Iniciando Ingesta para Cliente ${clientId} desde ${urlToIngest} ---`);

    try {
        // 1. Descargar HTML
        console.log("Descargando HTML...");
        const response = await axios.get(urlToIngest, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000
        });
        const html = response.data;
        console.log(`HTML descargado (${(html.length / 1024).toFixed(1)} KB).`);

        // 2. Extraer y Dividir Contenido
        const chunks = chunkContent(html, urlToIngest);
        if (chunks.length === 0) {
            console.warn("No se generaron chunks válidos. Finalizando ingesta.");
            return { success: true, message: "No valid content chunks found to ingest.", data: { chunksStored: 0 } };
        }

        // 3. Generar Embeddings
        const embeddingResult = await generateEmbeddings(chunks);
        if (!embeddingResult.success || !embeddingResult.data || embeddingResult.data.length === 0) {
            const errMsg = embeddingResult.error || "Failed to generate embeddings or no embeddings produced.";
            console.warn(`(Ingestion Service) ${errMsg} Finalizando ingesta para client ${clientId}.`);
            await updateClientIngestStatus(clientId, 'failed', errMsg);
            return { success: false, error: errMsg, data: { chunksStored: 0, tokensUsed: embeddingResult.totalTokens } };
        }
        
        const chunksWithEmbeddings = embeddingResult.data;
        if (embeddingResult.errors && embeddingResult.errors.length > 0) {
            console.warn(`Se encontraron ${embeddingResult.errors.length} errores durante la generación de embeddings. Continuando con los exitosos.`);
            // Potentially log these errors to a more persistent store
        }


        // 4. Almacenar en Supabase
        const storeResult = await storeChunks(clientId, chunksWithEmbeddings);

        if (!storeResult.success) {
            const errMsg = `Failed to store chunks: ${storeResult.error}`;
            console.warn(`(Ingestion Service) ${errMsg} for client ${clientId}.`);
            await updateClientIngestStatus(clientId, 'failed', errMsg);
            return { success: false, error: errMsg, data: { chunksStored: storeResult.count || 0, tokensUsed: embeddingResult.totalTokens } };
        }
        
        console.log(`--- Ingesta Finalizada para ${urlToIngest} ---`);
        await updateClientIngestStatus(clientId, 'completed'); // Update status to 'completed'
        return { 
            success: true, 
            message: "Ingestion complete.", 
            data: { 
                chunksAttempted: chunks.length,
                chunksSuccessfullyEmbedded: chunksWithEmbeddings.length,
                chunksStored: storeResult.count, 
                tokensUsed: embeddingResult.totalTokens,
                embeddingGenerationErrors: embeddingResult.errors 
            } 
        };

    } catch (error) {
        let errorMessage = "Unknown error during ingestion.";
        if (axios.isAxiosError(error)) {
            errorMessage = `Network/HTTP error while downloading ${urlToIngest}: ${error.message}`;
             if (error.response) {
                 errorMessage += ` Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data).substring(0, 200)}...`;
             }
        } else if (error instanceof Error) {
            errorMessage = `General error during ingestion of ${urlToIngest}: ${error.message}`;
        }
        console.error(errorMessage, error.stack ? error.stack.substring(0,500) : '');
        // Update client status to 'failed' in the main catch block
        await updateClientIngestStatus(clientId, 'failed', errorMessage);
        return { success: false, error: errorMessage };
    }
}

// Optional: export other functions if they need to be unit tested or used elsewhere
export { validateChunk, chunkContent, generateEmbeddings, storeChunks };
