// src/services/ingestionService.js
import 'dotenv/config';
import axios from 'axios';
import { load } from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse'; // Added for PDF parsing

// --- Configuración ---
const MIN_CHUNK_LENGTH_CHARS = 50;    // Mínimo caracteres para considerar un chunk
const TARGET_CHUNK_WORDS = 200;      // Tamaño objetivo de chunk en palabras
const MAX_CHUNK_WORDS = 300;         // Máximo absoluto antes de forzar división
const MIN_KEYWORDS_FOR_VALIDATION = 4; // Mínimo palabras clave (largas) para validar chunk
const EMBEDDING_BATCH_SIZE = 20;     // Lotes para generar embeddings
const EMBEDDING_MODEL = "text-embedding-3-small";
const USER_AGENT = 'Mozilla/5.0 (compatible; SynChatBot/1.1; +https://www.synchatai.com/bot)';

// --- Inicialización de Clientes ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseKey || !openaiApiKey) {
    console.error("Critical Error: Missing environment variables (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY). The service cannot start.");
    // Consider a more robust error handling or recovery mechanism in a production app
}

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: openaiApiKey });

// --- Nuevas Funciones de Ayuda ---

/**
 * Updates the status of a knowledge source.
 */
async function updateKnowledgeSourceStatus(sourceId, status, characterCount = null, errorMessage = null) {
    console.log(`(Ingestion Service) Updating source ${sourceId} to status '${status}'...`);
    const updateData = {
        status: status,
        last_ingest_at: new Date().toISOString(),
        last_ingest_error: errorMessage ? String(errorMessage).substring(0, 1000) : null // Max 1000 chars for error
    };
    if (characterCount !== null && typeof characterCount === 'number') {
        updateData.character_count = characterCount;
    }

    try {
        const { error } = await supabase
            .from('knowledge_sources')
            .update(updateData)
            .eq('source_id', sourceId);
        if (error) {
            console.error(`(Ingestion Service) Failed to update knowledge source ${sourceId} status to '${status}':`, error.message);
        }
    } catch (dbUpdateError) {
        console.error(`(Ingestion Service) Exception while updating knowledge source ${sourceId} status to '${status}':`, dbUpdateError.message);
    }
}


// --- Funciones de Ayuda (Existentes y Modificadas) ---

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
 * Chunks plain text content (from PDF, TXT, or article).
 */
function chunkTextContent(text, baseMetadata) {
    console.log(`(Ingestion Service) Starting text chunking for source_id: ${baseMetadata.original_source_id}, name: ${baseMetadata.source_name}`);
    const chunks = [];
    const sentences = text.split(/(?<=[.!?])\s+/); // Split by sentence-ending punctuation
    let currentChunkLines = [];
    let currentWordCount = 0;
    let chunkIndex = 0;

    for (const sentence of sentences) {
        const sentenceWordCount = sentence.split(/\s+/).length;
        if (sentence.trim().length === 0) continue;

        if (currentWordCount > 0 && (currentWordCount + sentenceWordCount) > MAX_CHUNK_WORDS) {
            const chunkText = currentChunkLines.join(' ').trim();
            if (validateChunk(chunkText)) {
                chunks.push({
                    text: chunkText,
                    metadata: { ...baseMetadata, chunk_index: chunkIndex++ }
                });
            }
            currentChunkLines = [sentence];
            currentWordCount = sentenceWordCount;
        } else {
            currentChunkLines.push(sentence);
            currentWordCount += sentenceWordCount;
        }

        if (currentWordCount >= TARGET_CHUNK_WORDS) {
            const chunkText = currentChunkLines.join(' ').trim();
            if (validateChunk(chunkText)) {
                 chunks.push({
                    text: chunkText,
                    metadata: { ...baseMetadata, chunk_index: chunkIndex++ }
                });
            }
            currentChunkLines = [];
            currentWordCount = 0;
        }
    }

    if (currentChunkLines.length > 0) {
        const chunkText = currentChunkLines.join(' ').trim();
        if (validateChunk(chunkText)) {
            chunks.push({
                text: chunkText,
                metadata: { ...baseMetadata, chunk_index: chunkIndex++ }
            });
        }
    }
    console.log(`(Ingestion Service) Text chunking completed for ${baseMetadata.source_name}. Generated ${chunks.length} chunks.`);
    return chunks;
}


/**
 * Divide el contenido HTML en chunks jerárquicos.
 * MODIFIED: Accepts baseMetadata and incorporates it.
 */
function chunkContent(html, url, baseMetadata) { // baseMetadata is new
    console.log(`(Ingestion Service) Starting HTML chunking for URL: ${url}, source_id: ${baseMetadata.original_source_id}`);
    const $ = load(html);
    const chunks = [];
    let contextStack = [];
    let currentChunkLines = [];
    let currentWordCount = 0;
    let chunkIndex = 0; // For HTML chunks as well

    // Standard noise removal
    $('script, style, nav, footer, header, aside, form, noscript, iframe, svg, link[rel="stylesheet"], button, input, select, textarea, label, .sidebar, #sidebar, .comments, #comments, .related-posts, .share-buttons, .pagination, .breadcrumb, .modal, .popup, [aria-hidden="true"], [role="navigation"], [role="search"], .ad, .advertisement, #ad, #advertisement').remove();

    const relevantSelectors = 'h1, h2, h3, h4, h5, h6, p, li, td, th, pre, blockquote, article'; // Added article
    $(relevantSelectors).each((i, el) => {
        const $el = $(el);
        const tag = $el.prop('tagName').toLowerCase();
        let text = ($el.text() || '').replace(/\s\s+/g, ' ').trim();

        if (text.length < 15 && tag !== 'article') return; // Allow article tag to be empty container initially

        let currentHierarchy = [...contextStack];
        if (tag.match(/^h[1-6]$/)) {
            const level = parseInt(tag[1]);
            contextStack = contextStack.slice(0, level - 1); // Reset lower levels
            contextStack[level - 1] = text; // Set current level
            currentHierarchy = [...contextStack]; // Capture current hierarchy for potential chunk
            
            // If there was content before this header, chunk it
            if (currentChunkLines.length > 0) {
                 const chunkText = currentChunkLines.join('\n').trim();
                 if (validateChunk(chunkText)) {
                      chunks.push({
                          text: chunkText,
                          // Use hierarchy before this header
                          metadata: { ...baseMetadata, url, hierarchy: [...contextStack.slice(0, level-1)], chunk_index: chunkIndex++ } 
                      });
                 }
                 currentChunkLines = [];
                 currentWordCount = 0;
            }
        }

        const elementWordCount = text.split(/\s+/).length;

        // If current chunk + new element exceeds max words, finalize current chunk
        if (currentWordCount > 0 && (currentWordCount + elementWordCount) > MAX_CHUNK_WORDS) {
             const chunkText = currentChunkLines.join('\n').trim();
             if (validateChunk(chunkText)) {
                 chunks.push({
                     text: chunkText,
                     metadata: { ...baseMetadata, url, hierarchy: [...currentHierarchy], chunk_index: chunkIndex++ }
                 });
            }
            currentChunkLines = [text]; // Start new chunk with current element
            currentWordCount = elementWordCount;
        } else {
            currentChunkLines.push(text);
            currentWordCount += elementWordCount;
        }

        // If current chunk meets target word count, finalize it
        if (currentWordCount >= TARGET_CHUNK_WORDS) {
             const chunkText = currentChunkLines.join('\n').trim();
             if (validateChunk(chunkText)) {
                 chunks.push({
                     text: chunkText,
                     metadata: { ...baseMetadata, url, hierarchy: [...currentHierarchy], chunk_index: chunkIndex++ }
                 });
             }
            currentChunkLines = [];
            currentWordCount = 0;
        }
    });

    // Add any remaining content as the last chunk
    if (currentChunkLines.length > 0) {
        const chunkText = currentChunkLines.join('\n').trim();
        if (validateChunk(chunkText)) {
            chunks.push({
                text: chunkText,
                metadata: { ...baseMetadata, url, hierarchy: [...contextStack], chunk_index: chunkIndex++ }
            });
        }
    }
    console.log(`(Ingestion Service) HTML chunking completed for ${url}. Generated ${chunks.length} chunks.`);
    return chunks;
}


/**
 * Genera embeddings para los chunks en lotes.
 * MODIFIED: Passes through the enhanced metadata.
 */
async function generateEmbeddings(chunks) {
    if (!chunks || chunks.length === 0) {
        console.log("(Ingestion Service) No chunks provided to generateEmbeddings.");
        return { success: true, data: [], totalTokens: 0, errors: [] };
    }
    console.log(`(Ingestion Service) Generating embeddings for ${chunks.length} chunks (batch size ${EMBEDDING_BATCH_SIZE})...`);
    const embeddingsData = [];
    let totalTokens = 0;
    let errorsEncountered = [];

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        const inputs = batchChunks.map(c => c.text.replace(/\n/g, ' ')); // OpenAI recommends replacing newlines

        try {
            console.log(`(Ingestion Service) Processing embedding batch ${Math.floor(i/EMBEDDING_BATCH_SIZE) + 1}/${Math.ceil(chunks.length/EMBEDDING_BATCH_SIZE)}...`);
            const response = await openai.embeddings.create({
                model: EMBEDDING_MODEL,
                input: inputs
            });

            const batchEmbeddings = response.data;
            if (response.usage) totalTokens += response.usage.total_tokens;

            if (!batchEmbeddings || batchEmbeddings.length !== batchChunks.length) {
                 const errorMsg = `(Ingestion Service) Embedding response mismatch for batch starting at index ${i}. Expected ${batchChunks.length}, got ${batchEmbeddings?.length || 0}.`;
                 console.warn(errorMsg);
                 errorsEncountered.push(errorMsg + " Metadata: " + JSON.stringify(batchChunks.map(c => c.metadata)));
                 continue; // Skip this batch
            }

            batchChunks.forEach((chunk, idx) => {
                if (batchEmbeddings[idx]?.embedding) {
                    embeddingsData.push({
                        ...chunk, // Includes text and original metadata
                        embedding: batchEmbeddings[idx].embedding
                    });
                } else {
                     const errorMsg = `(Ingestion Service) Missing embedding for chunk index ${i+idx}. Text: "${chunk.text.substring(0,50)}..."`;
                     console.warn(errorMsg);
                     errorsEncountered.push(errorMsg + " Metadata: " + JSON.stringify(chunk.metadata));
                }
            });

            // Rate limiting: wait a bit between batches if not the last one
            if (i + EMBEDDING_BATCH_SIZE < chunks.length) {
                 await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second delay
             }

        } catch (error) {
            const errorMsg = `(Ingestion Service) Error generating embeddings for batch starting at index ${i}: ${error.message || error}`;
            console.error(errorMsg, error.stack ? error.stack.substring(0,300) : '');
            errorsEncountered.push(errorMsg + " Metadata of first chunk in batch: " + JSON.stringify(batchChunks[0]?.metadata));
            // Continue to next batch unless it's a fatal error (e.g. auth)
            if (error.status === 401 || error.status === 429) {
                 console.error("(Ingestion Service) Fatal error during embedding generation. Stopping.");
                 return { success: false, error: `Fatal error: ${error.message}`, totalTokens, errors: errorsEncountered };
            }
        }
    }

    if (errorsEncountered.length > 0 && embeddingsData.length === 0) {
        return { success: false, error: `Failed to generate any embeddings. Errors: ${errorsEncountered.join('; ')}`, totalTokens, errors: errorsEncountered };
    }
    
    console.log(`(Ingestion Service) Embeddings generated for ${embeddingsData.length} of ${chunks.length} chunks. Tokens: ${totalTokens}. Errors: ${errorsEncountered.length}`);
    return { success: true, data: embeddingsData, totalTokens, errors: errorsEncountered };
}

/**
 * Almacena los chunks con embeddings en Supabase.
 * MODIFIED: Uses new metadata structure for knowledge_base.metadata.
 */
async function storeChunks(clientId, chunksWithEmbeddings) {
    if (!chunksWithEmbeddings || chunksWithEmbeddings.length === 0) {
        console.log("(Ingestion Service) No chunks with embeddings to store.");
        return { success: true, message: "No chunks to store.", count: 0 };
    }

    console.log(`(Ingestion Service) Storing ${chunksWithEmbeddings.length} chunks in Supabase for client ${clientId}...`);
    const recordsToInsert = chunksWithEmbeddings.map(chunk => ({
        client_id: clientId,
        content: chunk.text,
        embedding: chunk.embedding,
        metadata: chunk.metadata, // This now contains { original_source_id, source_name, url?, hierarchy?, chunk_index }
        // Ensure `original_source_id` is present in `chunk.metadata`
    }));

    try {
        // Insert in batches if necessary, though Supabase client handles large inserts well.
        // For very large numbers (e.g., >1000), consider batching inserts.
        const { data, error, count } = await supabase
            .from('knowledge_base')
            .insert(recordsToInsert)
            .select('count'); // Request count for verification

        if (error) {
            console.error("(Ingestion Service) Error storing chunks in Supabase:", error.message);
            if (error.details) console.error("Details:", error.details);
            return { success: false, error: error.message, details: error.details, count: 0 };
        }
        
        const numStored = count ?? recordsToInsert.length; // Supabase v2 might return count directly
        console.log(`(Ingestion Service) Storage complete. ${numStored} chunks saved for client ${clientId}.`);
        return { success: true, data, count: numStored };

    } catch (dbError) {
        console.error("(Ingestion Service) Unexpected error during Supabase chunk storage:", dbError);
        return { success: false, error: dbError.message, count: 0 };
    }
}


// --- Nueva Función Principal del Servicio ---
// Exportada directamente en su definición
export async function ingestSourceById(sourceId, clientId) {
    if (!supabaseUrl || !supabaseKey || !openaiApiKey) {
        console.error("(Ingestion Service) Critical environment variables missing for ingestSourceById.");
        // Do not update source status here as we don't have sourceId or it's unreliable
        return { success: false, error: "Server configuration error: Missing API keys." };
    }
    if (!sourceId || !clientId) {
        return { success: false, error: "Invalid input: sourceId and clientId are required." };
    }

    console.log(`\n--- (Ingestion Service) Starting Ingestion for Source ID: ${sourceId}, Client ID: ${clientId} ---`);
    let source;
    try {
        // 1. Fetch Source details
        const { data: sourceData, error: fetchError } = await supabase
            .from('knowledge_sources')
            .select('*')
            .eq('source_id', sourceId)
            .eq('client_id', clientId) // Ensure client owns the source
            .single();

        if (fetchError || !sourceData) {
            const errorMsg = `Source ${sourceId} not found for client ${clientId} or query failed: ${fetchError?.message}`;
            console.error(`(Ingestion Service) ${errorMsg}`);
            // Cannot update status if source not found or sourceId is incorrect
            return { success: false, error: errorMsg };
        }
        source = sourceData;

        // 2. Update Status to 'ingesting'
        await updateKnowledgeSourceStatus(sourceId, 'ingesting', source.character_count); // Keep existing char count for now

        let textToProcess = "";
        let htmlContent = ""; // For URL type
        let charCount = source.character_count || 0; // Use existing if available, else 0
        const sourceName = source.source_name || 'Unknown Source';

        // 3. Content Extraction
        console.log(`(Ingestion Service) Extracting content for source type: ${source.source_type}`);
        if (source.source_type === 'pdf') {
            if (!source.storage_path) throw new Error("PDF source has no storage_path.");
            const { data: fileBuffer, error: downloadError } = await supabase.storage
                .from('knowledge_files')
                .download(source.storage_path);
            if (downloadError) throw new Error(`Failed to download PDF ${source.storage_path}: ${downloadError.message}`);
            const pdfData = await pdfParse(fileBuffer);
            textToProcess = pdfData.text;
            charCount = textToProcess.length;
        } else if (source.source_type === 'txt') {
            if (!source.storage_path) throw new Error("TXT source has no storage_path.");
            const { data: fileBuffer, error: downloadError } = await supabase.storage
                .from('knowledge_files')
                .download(source.storage_path);
            if (downloadError) throw new Error(`Failed to download TXT ${source.storage_path}: ${downloadError.message}`);
            textToProcess = fileBuffer.toString('utf-8');
            charCount = textToProcess.length;
        } else if (source.source_type === 'url') {
            const urlToIngest = source.source_name; // Assuming source_name is the URL for 'url' type
            if (!urlToIngest || !urlToIngest.startsWith('http')) throw new Error(`Invalid URL in source_name: ${urlToIngest}`);
            const response = await axios.get(urlToIngest, { headers: { 'User-Agent': USER_AGENT }, timeout: 20000 });
            htmlContent = response.data;
            charCount = htmlContent.length; // For URL, charCount is HTML length before stripping
        } else if (source.source_type === 'article') {
            if (!source.content_text) throw new Error("Article source has no content_text.");
            textToProcess = source.content_text;
            charCount = textToProcess.length;
        } else {
            throw new Error(`Unsupported source_type: ${source.source_type}`);
        }
        
        // Update character count now that it's known
        await updateKnowledgeSourceStatus(sourceId, 'ingesting', charCount);

        // 4. Chunking
        let chunks;
        const baseMetadata = { original_source_id: source.source_id, source_name: sourceName };

        if (source.source_type === 'url') {
            chunks = chunkContent(htmlContent, source.source_name, baseMetadata); // Pass URL and baseMetadata
        } else { // For 'pdf', 'txt', 'article'
            chunks = chunkTextContent(textToProcess, baseMetadata);
        }

        if (!chunks || chunks.length === 0) {
            console.warn(`(Ingestion Service) No valid chunks generated for source ${sourceId}. Marking as completed.`);
            await updateKnowledgeSourceStatus(sourceId, 'completed', charCount, "No content chunks generated after processing.");
            return { success: true, message: "No valid content chunks found to ingest.", data: { chunksStored: 0, source_id: sourceId } };
        }
        console.log(`(Ingestion Service) Generated ${chunks.length} chunks for source ${sourceId}.`);

        // 5. Clear Existing Chunks for this source
        console.log(`(Ingestion Service) Clearing existing chunks for source_id: ${sourceId}`);
        const { error: deleteError } = await supabase
            .from('knowledge_base')
            .delete()
            .eq('client_id', clientId) // Ensure we only delete for the correct client
            .eq('metadata->>original_source_id', sourceId); // Match the specific source

        if (deleteError) {
            // Log error but proceed. If new chunks are added, it's not ideal but not fatal.
            // Critical error might be to fail here. For now, log and continue.
            console.error(`(Ingestion Service) Error clearing old chunks for source ${sourceId}: ${deleteError.message}. Proceeding with ingestion.`);
            // Potentially, update status with a warning here.
        } else {
            console.log(`(Ingestion Service) Successfully cleared old chunks for source ${sourceId}.`);
        }

        // 6. Generate Embeddings
        const embeddingResult = await generateEmbeddings(chunks);
        if (!embeddingResult.success || !embeddingResult.data || embeddingResult.data.length === 0) {
            const errMsg = embeddingResult.error || "Failed to generate embeddings or no embeddings produced.";
            throw new Error(errMsg + (embeddingResult.errors?.length ? ` Details: ${embeddingResult.errors.join(', ')}` : ''));
        }
        const chunksWithEmbeddings = embeddingResult.data;

        // 7. Store Chunks
        const storeResult = await storeChunks(clientId, chunksWithEmbeddings);
        if (!storeResult.success) {
            const errMsg = `Failed to store chunks for source ${sourceId}: ${storeResult.error}`;
            throw new Error(errMsg + (storeResult.details ? ` Details: ${storeResult.details}` : ''));
        }
        
        // 8. Update Status to 'completed'
        await updateKnowledgeSourceStatus(sourceId, 'completed', charCount);
        console.log(`--- (Ingestion Service) Ingestion COMPLETED for Source ID: ${sourceId} ---`);
        return { 
            success: true, 
            message: "Ingestion complete.", 
            data: { 
                source_id: sourceId,
                chunksAttempted: chunks.length,
                chunksSuccessfullyEmbedded: chunksWithEmbeddings.length,
                chunksStored: storeResult.count, 
                tokensUsed: embeddingResult.totalTokens,
                characterCount: charCount,
                embeddingGenerationErrors: embeddingResult.errors 
            } 
        };

    } catch (error) {
        let errorMessage = `Unknown error during ingestion of source ${sourceId}.`;
        if (axios.isAxiosError(error)) { // Check if it's an Axios error specifically for URL fetching
            errorMessage = `Network/HTTP error for source ${sourceId} (URL: ${source?.source_name}): ${error.message}`;
             if (error.response) {
                 errorMessage += ` Status: ${error.response.status}`;
             }
        } else if (error instanceof Error) {
            errorMessage = `Error during ingestion of source ${sourceId} (Type: ${source?.source_type}, Name: ${source?.source_name}): ${error.message}`;
        }
        console.error(`(Ingestion Service) ${errorMessage}`, error.stack ? error.stack.substring(0,500) : '');
        if (sourceId) { // Only update status if sourceId was available
            await updateKnowledgeSourceStatus(sourceId, 'failed_ingest', source?.character_count, errorMessage);
        }
        return { success: false, error: errorMessage, source_id: sourceId };
    }
}

// --- MODIFIED ingestWebsite function ---
// Refactored to use ingestSourceById
// Exportada directamente en su definición
export async function ingestWebsite(clientId, urlToIngest) {
    if (!supabaseUrl || !supabaseKey || !openaiApiKey) {
        console.error("(Ingestion Service - ingestWebsite) Missing critical environment variables.");
        return { success: false, error: "Server configuration error: Missing API keys." };
    }
    if (!clientId || !urlToIngest || !urlToIngest.startsWith('http')) {
        return { success: false, error: "Invalid input: ClientId and a full URL are required for ingestWebsite."};
    }

    console.log(`(Ingestion Service - ingestWebsite) Received request for Client ${clientId}, URL ${urlToIngest}. Converting to knowledge_sources flow.`);

    try {
        // 1. Check if a URL source with this exact name already exists for this client
        let { data: existingSource, error: queryError } = await supabase
            .from('knowledge_sources')
            .select('source_id, status')
            .eq('client_id', clientId)
            .eq('source_type', 'url')
            .eq('source_name', urlToIngest) // source_name is the URL itself
            .maybeSingle(); // Use maybeSingle as it might not exist

        if (queryError) {
            console.error(`(Ingestion Service - ingestWebsite) Error querying existing URL source for ${urlToIngest}:`, queryError.message);
            return { success: false, error: `Database error checking for existing source: ${queryError.message}` };
        }

        let sourceIdToProcess;
        if (existingSource) {
            console.log(`(Ingestion Service - ingestWebsite) Existing URL source found (ID: ${existingSource.source_id}, Status: ${existingSource.status}). Will re-ingest.`);
            sourceIdToProcess = existingSource.source_id;
            // Optionally, update its status to 'pending_ingest' or directly call ingestSourceById
            // For simplicity, we'll just use its ID. ingestSourceById will handle status updates.
        } else {
            console.log(`(Ingestion Service - ingestWebsite) Creating new knowledge_source entry for URL: ${urlToIngest}`);
            const { data: newSource, error: createError } = await supabase
                .from('knowledge_sources')
                .insert({
                    client_id: clientId,
                    source_type: 'url',
                    source_name: urlToIngest, // The URL itself is the name
                    status: 'pending_ingest' // Initial status
                })
                .select('source_id')
                .single();

            if (createError || !newSource) {
                console.error(`(Ingestion Service - ingestWebsite) Failed to create knowledge_source for URL ${urlToIngest}:`, createError?.message);
                return { success: false, error: `Failed to create source entry: ${createError?.message}` };
            }
            sourceIdToProcess = newSource.source_id;
            console.log(`(Ingestion Service - ingestWebsite) New knowledge_source created (ID: ${sourceIdToProcess}) for URL: ${urlToIngest}`);
        }

        // 2. Call the main ingestion logic
        return await ingestSourceById(sourceIdToProcess, clientId);

    } catch (error) {
        const errorMessage = `(Ingestion Service - ingestWebsite) Unexpected error processing ${urlToIngest}: ${error.message}`;
        console.error(errorMessage, error.stack ? error.stack.substring(0,500) : '');
        // Note: status update for the specific source_id would be handled by ingestSourceById if it gets that far
        return { success: false, error: errorMessage };
    }
}


// --- Helper function (legacy, consider removing or adapting if synchat_clients status is still needed) ---
/*
async function updateClientIngestStatus(clientId, status, errorMessage = null) {
    // ... (Código legado, como estaba antes) ...
}
*/

// --- Exports ---
// ingestSourceById e ingestWebsite ya están exportadas en su definición.
// Las siguientes funciones se exportan para posible uso interno o pruebas,
// asegurándose de que no estén ya exportadas en su definición.
export {
    // updateKnowledgeSourceStatus, // Ya es interna o no exportada directamente antes
    // chunkTextContent,
    // chunkContent,
    // generateEmbeddings,
    // storeChunks,
    validateChunk // Ejemplo de exportar una función de utilidad
};
