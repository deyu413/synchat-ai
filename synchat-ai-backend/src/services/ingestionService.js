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
const DEBUG_PREPROCESSING = false; // Controla el logging de preprocesamiento

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

// --- Funciones de Preprocesamiento de Texto ---

const SPANISH_ABBREVIATIONS = {
    "p. ej.": "por ejemplo",
    "p.e.": "por ejemplo",
    "ej.": "ejemplo",
    "etc.": "etcétera",
    "sr.": "señor", // Lowercase already, but good to have for consistency
    "sra.": "señora",
    "dr.": "doctor",
    "dra.": "doctora",
    "ud.": "usted",
    "uds.": "ustedes",
    "fig.": "figura",
    "cap.": "capítulo",
    "aprox.": "aproximadamente",
    // Add more as needed
};

/**
 * Preprocesa el texto para mejorar la calidad de los embeddings.
 * @param {string} text - El texto original.
 * @returns {string} - El texto preprocesado.
 */
function preprocessTextForEmbedding(text) {
    if (!text) return "";

    let originalTextForDebug = DEBUG_PREPROCESSING ? text.substring(0, 150) : ""; // Sample for logging

    // 1. Unicode Normalization (NFC)
    let processedText = text.normalize('NFC');

    // 2. Convert to lowercase
    processedText = processedText.toLowerCase();

    // 3. Expand common Spanish abbreviations
    // Iterate over a sorted list of keys (by length, descending) to handle nested abbreviations correctly.
    // For example, "p. ej." should be matched before "ej." if "ej." is also a key.
    // However, with current regex using word boundaries, direct iteration might be fine.
    // Using word boundaries (\b) to ensure "p. ej." isn't part of another word.
    for (const [abbr, expansion] of Object.entries(SPANISH_ABBREVIATIONS)) {
        // Escape special characters in abbreviation for regex and ensure it's a whole word/sequence
        const escapedAbbr = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedAbbr}\\b`, 'gi'); // Case insensitive due to prior toLowerCase
        processedText = processedText.replace(regex, expansion);
    }

    // 4. Regex-based cleaning
    // Collapse excessive or repeated punctuation (e.g., !!! to !, ??? to ?, multiple commas/periods to a single one)
    processedText = processedText.replace(/([!?.,;:])\1+/g, '$1'); //  Example: !!! -> !,  .. -> .

    // Normalize non-standard whitespace patterns
    processedText = processedText.replace(/\s\s+/g, ' '); // Collapse multiple spaces/tabs to a single space
    processedText = processedText.trim(); // Trim leading/trailing whitespace

    if (DEBUG_PREPROCESSING && originalTextForDebug !== processedText.substring(0, 150)) {
        console.log(`(Ingestion Service DEBUG) Text Preprocessing:
Original: "${originalTextForDebug}..."
Processed: "${processedText.substring(0, 150)}..."`);
    }
    return processedText;
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
function chunkTextContent(text, baseMetadata, sentenceOverlapCount = 1) {
    console.log(`(Ingestion Service) Starting text chunking for source_id: ${baseMetadata.original_source_id}, name: ${baseMetadata.source_name}, sentenceOverlap: ${sentenceOverlapCount}`);
    const chunks = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let currentChunkLines = [];
    let currentWordCount = 0;
    let chunkIndex = 0;

    // Initialize currentChunkLines with potential overlap from a hypothetical "previous" chunk (empty at the start)
    let sentencesToPrependForOverlap = [];

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const sentenceWordCount = sentence.split(/\s+/).length;

        if (sentence.trim().length === 0) {
            continue;
        }

        // Prepend overlap sentences if currentChunkLines is empty
        // This happens at the beginning of processing or after a chunk is finalized.
        if (currentChunkLines.length === 0 && sentencesToPrependForOverlap.length > 0) {
            currentChunkLines.push(...sentencesToPrependForOverlap);
            currentWordCount = currentChunkLines.reduce((acc, s) => acc + s.split(/\s+/).length, 0);
            sentencesToPrependForOverlap = []; // Clear after use
        }

        // Scenario 1: Adding current sentence EXCEEDS MAX_CHUNK_WORDS
        // Action: Finalize current chunk *without* current sentence. Current sentence starts the next chunk.
        if (currentWordCount > 0 && (currentWordCount + sentenceWordCount) > MAX_CHUNK_WORDS) {
            let chunkText = currentChunkLines.join(' ').trim();
            if (validateChunk(chunkText)) {
                const processedChunkText = preprocessTextForEmbedding(chunkText);
                const metadata = {
                    ...baseMetadata,
                    chunk_index: chunkIndex++,
                    chunk_char_length: processedChunkText.length,
                    content_type_hint: "text"
                };
                if (baseMetadata.source_document_updated_at) {
                    metadata.source_document_updated_at = baseMetadata.source_document_updated_at;
                }
                chunks.push({ text: processedChunkText, metadata: metadata});
            }

            if (sentenceOverlapCount > 0 && currentChunkLines.length > 0) {
                sentencesToPrependForOverlap = currentChunkLines.slice(-sentenceOverlapCount);
            } else {
                sentencesToPrependForOverlap = [];
            }

            currentChunkLines = [...sentencesToPrependForOverlap, sentence]; // New chunk starts with overlap + current sentence
            currentWordCount = currentChunkLines.reduce((acc, s) => acc + s.split(/\s+/).length, 0);
            sentencesToPrependForOverlap = []; // Overlap for *this* new chunk is now incorporated
        }
        // Scenario 2: Adding current sentence MEETS OR EXCEEDS TARGET_CHUNK_WORDS (but not MAX)
        // Action: Finalize current chunk *with* current sentence.
        else if ((currentWordCount + sentenceWordCount) >= TARGET_CHUNK_WORDS) {
            currentChunkLines.push(sentence);
            currentWordCount += sentenceWordCount;

            let chunkText = currentChunkLines.join(' ').trim();
            if (validateChunk(chunkText)) {
                const processedChunkText = preprocessTextForEmbedding(chunkText);
                chunks.push({ text: processedChunkText, metadata: { ...baseMetadata, chunk_index: chunkIndex++ }});
            }

            if (sentenceOverlapCount > 0 && currentChunkLines.length > 0) {
                sentencesToPrependForOverlap = currentChunkLines.slice(-sentenceOverlapCount);
            } else {
                sentencesToPrependForOverlap = [];
            }
            currentChunkLines = []; // Reset for next chunk (will be populated with overlap at loop start)
            currentWordCount = 0;
        }
        // Scenario 3: Adding current sentence DOES NOT YET meet TARGET_CHUNK_WORDS
        // Action: Add sentence to current chunk and continue.
        else {
            currentChunkLines.push(sentence);
            currentWordCount += sentenceWordCount;
        }
    }

    // After the loop, if there's anything left in currentChunkLines, it forms the last chunk.
    // This part might also need to correctly use any pending `sentencesToPrependForOverlap`
    // if the loop finished and `currentChunkLines` became empty but overlap was due.
    if (currentChunkLines.length === 0 && sentencesToPrependForOverlap.length > 0) {
        currentChunkLines.push(...sentencesToPrependForOverlap);
        currentWordCount = currentChunkLines.reduce((acc, s) => acc + s.split(/\s+/).length, 0);
        // No need to clear sentencesToPrependForOverlap here as it's the end.
    }

    if (currentChunkLines.length > 0) {
        let chunkText = currentChunkLines.join(' ').trim();
        if (validateChunk(chunkText)) {
            // Prevent adding a duplicate chunk if the last chunk consists *only* of the overlap
            // from a previously added identical chunk.
            // Note: isPureOverlapOfPrevious check should ideally use preprocessed text if that's what's stored,
            // or be done before preprocessing for this final chunk.
            // For simplicity here, we'll preprocess then check, this might mean a non-preprocessed check for overlap.
            const processedChunkText = preprocessTextForEmbedding(chunkText);
            let isPureOverlapOfPrevious = false;
            if (chunks.length > 0 && sentenceOverlapCount > 0) {
                // This check ideally should compare against the *processed* text of the previous chunk's overlap sentences.
                // However, that would require storing processed versions or reprocessing overlap here.
                // Current check is against raw text, which might be fine if preprocessing is mostly idempotent for overlaps.
                const lastChunkSentences = chunks[chunks.length-1].text.split(/(?<=[.!?])\s+/); // This is processed text
                const overlapFromLast = lastChunkSentences.slice(-sentenceOverlapCount);
                // To compare apples to apples, we'd need to join and then preprocess what `chunkText` would be if it were only overlap.
                // Or, ensure the comparison text `processedChunkText` is compared against an equally processed version of potential overlap.
                // This simplified check might lead to slight discrepancies if preprocessing alters overlap significantly.
                if (overlapFromLast.join(' ') === processedChunkText && currentChunkLines.length === sentenceOverlapCount) {
                     isPureOverlapOfPrevious = true;
                }
            }

            if (!isPureOverlapOfPrevious) {
                const metadata = {
                    ...baseMetadata,
                    chunk_index: chunkIndex++,
                    chunk_char_length: processedChunkText.length,
                    content_type_hint: "text"
                };
                if (baseMetadata.source_document_updated_at) {
                    metadata.source_document_updated_at = baseMetadata.source_document_updated_at;
                }
                chunks.push({ text: processedChunkText, metadata: metadata});
            }
        }
    }
    console.log(`(Ingestion Service) Text chunking completed for ${baseMetadata.source_name}. Generated ${chunks.length} chunks.`);
    return chunks;
}


/**
 * Divide el contenido HTML en chunks jerárquicos.
 * MODIFIED: Accepts baseMetadata and incorporates it.
 */
function chunkContent(html, url, baseMetadata, elementOverlapCount = 1) { // baseMetadata is new, elementOverlapCount added
    console.log(`(Ingestion Service) Starting HTML chunking for URL: ${url}, source_id: ${baseMetadata.original_source_id}, elementOverlap: ${elementOverlapCount}`);
    const $ = load(html);
    const chunks = [];
    let contextStack = []; // Will store {level, text} objects
    let currentChunkLines = [];
    let currentChunkRawElements = []; // Store raw text of elements for overlap
    let currentWordCount = 0;
    let chunkIndex = 0;
    let elementsToPrependForOverlap = [];

    // Standard noise removal
    $('script, style, nav, footer, header, aside, form, noscript, iframe, svg, link[rel="stylesheet"], button, input, select, textarea, label, .sidebar, #sidebar, .comments, #comments, .related-posts, .share-buttons, .pagination, .breadcrumb, .modal, .popup, [aria-hidden="true"], [role="navigation"], [role="search"], .ad, .advertisement, #ad, #advertisement').remove();

    const relevantSelectors = 'h1, h2, h3, h4, h5, h6, p, li, td, th, pre, blockquote, article';
    const elements = $(relevantSelectors).toArray(); // Get all elements once

    for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        const $el = $(el);
        const tag = $el.prop('tagName').toLowerCase();
        let text = ($el.text() || '').replace(/\s\s+/g, ' ').trim();

        if (text.length < 15 && tag !== 'article' && !tag.match(/^h[1-6]$/)) { // Keep headers even if short
             // If article is empty but contains relevant children, those children will be processed.
            if (tag === 'article' && $el.children(relevantSelectors).length > 0) {
                // Continue to process children, do not return
            } else if (text.length === 0 && tag === 'article' && $el.children().length === 0){
                continue; // Skip empty article tags with no children
            } else if (text.length < 15 && tag !== 'article') {
                continue; // Skip short non-article, non-header elements
            }
        }

        // Overlap prepending logic
        if (currentChunkLines.length === 0 && elementsToPrependForOverlap.length > 0) {
            currentChunkLines.push(...elementsToPrependForOverlap.map(e => e.text)); // Add text lines
            currentChunkRawElements.push(...elementsToPrependForOverlap);
            currentWordCount = currentChunkLines.join('\n').split(/\s+/).length; // Recalculate word count
            elementsToPrependForOverlap = [];
        }

        let hierarchyForCurrentElement = [...contextStack]; // Default hierarchy for non-header elements

        if (tag.match(/^h[1-6]$/)) {
            const level = parseInt(tag[1]);
            const headerObj = { level: level, text: text };

            // Finalize previous chunk if this header triggers a new section
            if (currentChunkLines.length > 0) {
                let chunkText = currentChunkLines.join('\n').trim();
                if (validateChunk(chunkText)) {
                    const processedChunkText = preprocessTextForEmbedding(chunkText);
                    const currentHierarchy = [...contextStack];
                    const metadata = {
                        ...baseMetadata,
                        url,
                        hierarchy: currentHierarchy,
                        chunk_index: chunkIndex++,
                        chunk_char_length: processedChunkText.length,
                        content_type_hint: currentHierarchy && currentHierarchy.length > 0 ? "structured_html" : "html_content"
                    };
                    if (baseMetadata.source_document_updated_at) {
                        metadata.source_document_updated_at = baseMetadata.source_document_updated_at;
                    }
                    chunks.push({
                        text: processedChunkText,
                        metadata: metadata
                    });
                }

                if (elementOverlapCount > 0 && currentChunkRawElements.length > 0) {
                    elementsToPrependForOverlap = currentChunkRawElements.slice(-elementOverlapCount);
                } else {
                    elementsToPrependForOverlap = [];
                }
                currentChunkLines = [];
                currentChunkRawElements = [];
                currentWordCount = 0;

                // Prepend overlap immediately if captured
                if (elementsToPrependForOverlap.length > 0) {
                    currentChunkLines.push(...elementsToPrependForOverlap.map(e => e.text));
                    currentChunkRawElements.push(...elementsToPrependForOverlap);
                    currentWordCount = currentChunkLines.join('\n').split(/\s+/).length;
                    elementsToPrependForOverlap = [];
                }
            }

            contextStack = contextStack.filter(h => h.level < level); // Remove deeper or same-level headers
            contextStack.push(headerObj);
            hierarchyForCurrentElement = [...contextStack]; // Header's own hierarchy includes itself
        }

        const elementWordCount = text.split(/\s+/).length;
        const currentElementData = { text, tag, wordCount: elementWordCount, hierarchy: hierarchyForCurrentElement };

        // Scenario 1: Adding current element EXCEEDS MAX_CHUNK_WORDS
        if (currentWordCount > 0 && (currentWordCount + elementWordCount) > MAX_CHUNK_WORDS && text.length > 0) {
            let chunkText = currentChunkLines.join('\n').trim();
            if (validateChunk(chunkText)) {
                const processedChunkText = preprocessTextForEmbedding(chunkText);
                const lastElementInChunkHierarchy = currentChunkRawElements.length > 0 ? currentChunkRawElements[currentChunkRawElements.length-1].hierarchy : [...contextStack];
                const metadata = {
                    ...baseMetadata,
                    url,
                    hierarchy: lastElementInChunkHierarchy,
                    chunk_index: chunkIndex++,
                    chunk_char_length: processedChunkText.length,
                    content_type_hint: lastElementInChunkHierarchy && lastElementInChunkHierarchy.length > 0 ? "structured_html" : "html_content"
                };
                if (baseMetadata.source_document_updated_at) {
                    metadata.source_document_updated_at = baseMetadata.source_document_updated_at;
                }
                chunks.push({ text: processedChunkText, metadata: metadata});
            }

            if (elementOverlapCount > 0 && currentChunkRawElements.length > 0) {
                elementsToPrependForOverlap = currentChunkRawElements.slice(-elementOverlapCount);
            } else {
                elementsToPrependForOverlap = [];
            }

            currentChunkLines = elementsToPrependForOverlap.map(e => e.text);
            currentChunkRawElements = [...elementsToPrependForOverlap];
            currentWordCount = currentChunkLines.join('\n').split(/\s+/).length;
            elementsToPrependForOverlap = []; // Consumed for this new chunk start

            if (text.length > 0) { // Add current element text if it's not empty (headers might be)
                currentChunkLines.push(text);
                currentChunkRawElements.push(currentElementData);
                currentWordCount += elementWordCount;
            }
        }
        // Scenario 2: Adding current element MEETS/EXCEEDS TARGET_CHUNK_WORDS (but not MAX)
        else if (text.length > 0 && (currentWordCount + elementWordCount) >= TARGET_CHUNK_WORDS) {
            currentChunkLines.push(text);
            currentChunkRawElements.push(currentElementData);
            currentWordCount += elementWordCount;

            let chunkText = currentChunkLines.join('\n').trim();
            if (validateChunk(chunkText)) {
                const processedChunkText = preprocessTextForEmbedding(chunkText);
                const lastElementInChunkHierarchy = currentChunkRawElements.length > 0 ? currentChunkRawElements[currentChunkRawElements.length-1].hierarchy : [...contextStack];
                const metadata = {
                    ...baseMetadata,
                    url,
                    hierarchy: lastElementInChunkHierarchy,
                    chunk_index: chunkIndex++,
                    chunk_char_length: processedChunkText.length,
                    content_type_hint: lastElementInChunkHierarchy && lastElementInChunkHierarchy.length > 0 ? "structured_html" : "html_content"
                };
                if (baseMetadata.source_document_updated_at) {
                    metadata.source_document_updated_at = baseMetadata.source_document_updated_at;
                }
                chunks.push({ text: processedChunkText, metadata: metadata});
            }

            if (elementOverlapCount > 0 && currentChunkRawElements.length > 0) {
                elementsToPrependForOverlap = currentChunkRawElements.slice(-elementOverlapCount);
            } else {
                elementsToPrependForOverlap = [];
            }
            currentChunkLines = [];
            currentChunkRawElements = [];
            currentWordCount = 0;
        }
        // Scenario 3: Adding current element DOES NOT YET meet TARGET_CHUNK_WORDS
        else if (text.length > 0) { // Only add if there's text
            currentChunkLines.push(text);
            currentChunkRawElements.push(currentElementData);
            currentWordCount += elementWordCount;
        }
         // If it was an 'article' tag and it was empty, it doesn't contribute to words/lines here
         // but its context (hierarchy) is set for its children.
    }

    // After the loop, handle any remaining content
    if (currentChunkLines.length === 0 && elementsToPrependForOverlap.length > 0) {
        currentChunkLines.push(...elementsToPrependForOverlap.map(e => e.text));
        currentChunkRawElements.push(...elementsToPrependForOverlap);
        // currentWordCount = currentChunkLines.join('\n').split(/\s+/).length; // Not strictly needed as it's the end
    }

    if (currentChunkLines.length > 0) {
        let chunkText = currentChunkLines.join('\n').trim();
        if (validateChunk(chunkText)) {
            const processedChunkText = preprocessTextForEmbedding(chunkText);
            let isPureOverlapOfPrevious = false;
            if (chunks.length > 0 && elementOverlapCount > 0 && currentChunkRawElements.length === elementOverlapCount) {
                const lastChunkText = chunks[chunks.length-1].text; // This is processed text
                // Similar to chunkTextContent, this comparison ideally needs care if preprocessing changes overlap text.
                // currentChunkRawElements contains original text.
                const originalOverlapText = currentChunkRawElements.map(e => e.text).join('\n');
                const processedOriginalOverlapText = preprocessTextForEmbedding(originalOverlapText);

                if (processedOriginalOverlapText === processedChunkText &&
                    originalOverlapText.split('\n').length === elementOverlapCount && // Ensure it's only the overlap
                    lastChunkText.endsWith(processedOriginalOverlapText) // Check if previous chunk ended with this processed overlap
                ) {
                   // More robust check: does the *processed* version of the raw overlap match the current processed chunk?
                   // And does the previous chunk (which is already processed) end with this?
                   // This is still heuristic. A perfect check is complex.
                   if (processedChunkText === preprocessTextForEmbedding(currentChunkRawElements.map(e=>e.text).join('\n'))) {
                        isPureOverlapOfPrevious = true;
                   }
                }
            }

            if (!isPureOverlapOfPrevious) {
                const lastElementInChunkHierarchy = currentChunkRawElements.length > 0 ? currentChunkRawElements[currentChunkRawElements.length-1].hierarchy : [...contextStack];
                const metadata = {
                    ...baseMetadata,
                    url,
                    hierarchy: lastElementInChunkHierarchy,
                    chunk_index: chunkIndex++,
                    chunk_char_length: processedChunkText.length,
                    content_type_hint: lastElementInChunkHierarchy && lastElementInChunkHierarchy.length > 0 ? "structured_html" : "html_content"
                };
                if (baseMetadata.source_document_updated_at) {
                    metadata.source_document_updated_at = baseMetadata.source_document_updated_at;
                }
                chunks.push({
                    text: processedChunkText,
                    metadata: metadata
                });
            }
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
    console.log(`(Ingestion Service) Using chunking parameters: TARGET_CHUNK_WORDS=${TARGET_CHUNK_WORDS}, MAX_CHUNK_WORDS=${MAX_CHUNK_WORDS}`);
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
        // Initial baseMetadata with core, non-overwritable fields
        let baseMetadata = {
            original_source_id: source.source_id,
            source_name: sourceName,
        };

        // Add source_document_updated_at if it exists on the source
        if (source.updated_at) {
            baseMetadata.source_document_updated_at = source.updated_at;
        }

        // Merge custom_metadata from the source, allowing its properties to be added,
        // but core properties defined above will take precedence if there are conflicts.
        if (source.custom_metadata && typeof source.custom_metadata === 'object') {
            baseMetadata = {
                ...source.custom_metadata, // Custom properties first
                ...baseMetadata            // Core properties overwrite if keys conflict
            };
        }

        if (source.source_type === 'url') {
            // Assuming default elementOverlapCount of 1, can be configured later
            chunks = chunkContent(htmlContent, source.source_name, baseMetadata, 1);
        } else { // For 'pdf', 'txt', 'article'
            // The new parameter will be passed here. Let's assume a default or configured value for now.
            // For this modification, we'll use the default of 1.
            // In a real scenario, this might come from source.settings or a global config.
            chunks = chunkTextContent(textToProcess, baseMetadata, 1); // Using default overlap of 1
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
