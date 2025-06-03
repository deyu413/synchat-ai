// src/services/ingestionService.js
import 'dotenv/config';
import axios from 'axios';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { load } from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse'; // Added for PDF parsing
import pdfTableExtractor from 'pdf-table-extractor';
import { PDFImage } from 'pdf-image';
import Tesseract from 'tesseract.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// --- Configuración ---
const MIN_CHUNK_LENGTH_CHARS = 50;    // Mínimo caracteres para considerar un chunk
const TARGET_CHUNK_WORDS = 200;      // Tamaño objetivo de chunk en palabras
const MAX_CHUNK_WORDS = 300;         // Máximo absoluto antes de forzar división
const MIN_KEYWORDS_FOR_VALIDATION = 4; // Mínimo palabras clave (largas) para validar chunk
const EMBEDDING_BATCH_SIZE = 20;     // Lotes para generar embeddings // General batch size for OpenAI API
const EMBEDDING_MODEL = "text-embedding-3-small";
const SEMANTIC_SIMILARITY_THRESHOLD = 0.85; // Threshold for keeping sentences together
const SENTENCE_EMBEDDING_BATCH_SIZE = 50; // Batch size specific for sentence embeddings
const USER_AGENT = 'Mozilla/5.0 (compatible; SynChatBot/1.1; +https://www.synchatai.com/bot)';
const DEBUG_PREPROCESSING = false; // Controla el logging de preprocesamiento

const MIN_CHUNK_WORDS_BEFORE_SPLIT = 50;
const SHORT_SENTENCE_WORD_THRESHOLD = 5;
const ORPHAN_SIMILARITY_THRESHOLD = 0.90;

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

// --- Nuevas Funciones de Ayuda (Incluyendo para Chunking Semántico) ---

/**
 * Calculates the cosine similarity between two vectors.
 * @param {number[]} vecA - The first vector.
 * @param {number[]} vecB - The second vector.
 * @returns {number} The cosine similarity.
 */
function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
        return 0; // Or throw error, depending on desired handling
    }

    let dotProduct = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        magA += vecA[i] * vecA[i];
        magB += vecB[i] * vecB[i];
    }

    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);

    if (magA === 0 || magB === 0) {
        return 0; // Avoid division by zero
    }

    return dotProduct / (magA * magB);
}

/**
 * Gets embeddings for an array of sentences.
 * @param {string[]} sentences - Array of sentence strings.
 * @param {number} batchSize - How many sentences to process per API call.
 * @returns {Promise<Array<number[]|null>>} - Array of embedding vectors or null for failed ones.
 */
async function getSentenceEmbeddings(sentences, batchSize = SENTENCE_EMBEDDING_BATCH_SIZE) {
    if (!sentences || sentences.length === 0) {
        return [];
    }
    console.log(`(Ingestion Service) Generating sentence embeddings for ${sentences.length} sentences (batch size ${batchSize})...`);

    const allEmbeddings = new Array(sentences.length).fill(null);
    let errorsEncountered = 0;

    for (let i = 0; i < sentences.length; i += batchSize) {
        const batchSentences = sentences.slice(i, i + batchSize);
        const inputs = batchSentences.map(s => s.replace(/\n/g, ' ')); // OpenAI recommends replacing newlines

        try {
            // console.log(`(Ingestion Service) Processing sentence embedding batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(sentences.length/batchSize)}...`);
            const response = await openai.embeddings.create({
                model: EMBEDDING_MODEL, // Using the same model as chunk embeddings
                input: inputs
            });

            const batchEmbeddingsResponse = response.data;

            if (!batchEmbeddingsResponse || batchEmbeddingsResponse.length !== batchSentences.length) {
                 console.warn(`(Ingestion Service) Sentence embedding response mismatch for batch starting at index ${i}. Expected ${batchSentences.length}, got ${batchEmbeddingsResponse?.length || 0}.`);
                 errorsEncountered += batchSentences.length; // Assume all in batch failed
                 continue;
            }

            batchEmbeddingsResponse.forEach((embeddingObj, idx) => {
                if (embeddingObj?.embedding) {
                    allEmbeddings[i + idx] = embeddingObj.embedding;
                } else {
                     console.warn(`(Ingestion Service) Missing embedding for sentence index ${i+idx}. Text: "${batchSentences[idx].substring(0,50)}..."`);
                     errorsEncountered++;
                }
            });
             // Rate limiting: wait a bit between batches if not the last one
             if (i + batchSize < sentences.length) {
                await new Promise(resolve => setTimeout(resolve, 200)); // Shorter delay for sentence embeddings
            }

        } catch (error) {
            console.error(`(Ingestion Service) Error generating sentence embeddings for batch starting at index ${i}: ${error.message || error}`, error.stack ? error.stack.substring(0,300) : '');
            errorsEncountered += batchSentences.length; // Assume all in batch failed
            // Continue to next batch unless it's a fatal error (e.g. auth)
            if (error.status === 401 || error.status === 429) {
                 console.error("(Ingestion Service) Fatal error during sentence embedding generation. Stopping this process.");
                 // Mark all remaining as null or throw to stop entirely
                 for (let j = i; j < sentences.length; j++) allEmbeddings[j] = null;
                 return allEmbeddings; // Return what we have, with failures marked
            }
        }
    }
    if (errorsEncountered > 0) {
        console.warn(`(Ingestion Service) Sentence embeddings generated with ${errorsEncountered} errors out of ${sentences.length} sentences.`);
    } else {
        console.log(`(Ingestion Service) Sentence embeddings generated successfully for all ${sentences.length} sentences.`);
    }
    return allEmbeddings;
}


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

    // --- NEW NORMALIZATION RULES START ---

    // Ligature Expansion
    const ligatureMap = {
        'ﬀ': 'ff', // ff
        'ﬁ': 'fi', // fi
        'ﬂ': 'fl', // fl
        'ﬃ': 'ffi', // ffi
        'ﬄ': 'ffl', // ffl
    };
    processedText = processedText.replace(/[ﬀ-ﬄ]/g, (match) => ligatureMap[match] || match);

    // Quote Normalization
    processedText = processedText.replace(/[‘’‚‛‹›]/g, "'");
    processedText = processedText.replace(/[“”„‟«»]/g, '"');

    // Dash Normalization
    processedText = processedText.replace(/[‐‑‒–—―]/g, '-');

    // Zero-Width Space Removal
    // The regex [​-‍﻿] includes:
    // U+200B (ZERO WIDTH SPACE)
    // U+200C (ZERO WIDTH NON-JOINER)
    // U+200D (ZERO WIDTH JOINER)
    // U+FEFF (ZERO WIDTH NO-BREAK SPACE or BOM)
    processedText = processedText.replace(/\u200B|\u200C|\u200D|\uFEFF/g, '');


    // --- NEW NORMALIZATION RULES END ---

    // 4. Regex-based cleaning (renumbered from original)
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
 * Chunks plain text content (from PDF, TXT, or article) using semantic similarity.
 */
async function chunkTextContent(text, baseMetadata, sentenceOverlapCount = 1) {
    if (sentenceOverlapCount < 0) {
        sentenceOverlapCount = 0;
    }
    console.log(`(Ingestion Service) Starting SEMANTIC text chunking for source_id: ${baseMetadata.original_source_id}, name: ${baseMetadata.source_name}, sentenceOverlap: ${sentenceOverlapCount}`);
    const chunks = [];
    let originalSentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

    if (originalSentences.length === 0) {
        console.log("(Ingestion Service) No sentences found in text.");
        return [];
    }

    // Preprocess sentences before embedding them - important for quality
    const sentences = originalSentences.map(s => preprocessTextForEmbedding(s)).filter(s => s.length > MIN_CHUNK_LENGTH_CHARS / 2); // Filter out very short sentences after preprocessing

    if (sentences.length === 0) {
        console.log("(Ingestion Service) No sentences after preprocessing and filtering.");
        return [];
    }

    const sentenceEmbeddings = await getSentenceEmbeddings(sentences);

    let previousChunkFinalSentences = [];
    // REMOVED previousChunkFinalSentences initialization from here
    let currentChunkSentences = [];
    let currentChunkWordCount = 0;
    let chunkIndex = 0;

    for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const embedding = sentenceEmbeddings[i];

        if (!embedding) { // Skip sentence if embedding failed
            console.warn(`(Ingestion Service) Skipping sentence "${sentence.substring(0,30)}..." due to missing embedding.`);
            continue;
        }

        const sentenceWordCount = sentence.split(/\s+/).length;

        currentChunkSentences.push(sentence);
        currentChunkWordCount += sentenceWordCount;

        // New split point logic starts here
        let splitPoint = false;

        if (i < sentences.length - 1) {
            const nextSentence = sentences[i+1]; // Ensure this uses the existing variable or definition
            const nextEmbedding = sentenceEmbeddings[i+1]; // Ensure this uses the existing variable
            const nextSentenceWordCount = nextSentence.split(/\s+/).length; // Ensure this uses the existing variable

            if (!nextEmbedding) {
                splitPoint = true; // Split if next sentence has no embedding
            } else {
                const similarity = cosineSimilarity(embedding, nextEmbedding); // 'embedding' is for sentences[i]
                let reasonForSplit = "";

                if (similarity < SEMANTIC_SIMILARITY_THRESHOLD) {
                    splitPoint = true;
                    reasonForSplit = "low_similarity";
                } else if (currentChunkWordCount + nextSentenceWordCount > MAX_CHUNK_WORDS) {
                    splitPoint = true;
                    reasonForSplit = "max_words_exceeded";
                } else if (currentChunkWordCount >= TARGET_CHUNK_WORDS && similarity < (SEMANTIC_SIMILARITY_THRESHOLD + 0.05)) {
                    splitPoint = true;
                    reasonForSplit = "target_words_met_low_ish_similarity";
                }

                // Refinement 1: Minimum Chunk Size Consideration
                if (splitPoint && reasonForSplit === "low_similarity") {
                    if (currentChunkWordCount < MIN_CHUNK_WORDS_BEFORE_SPLIT &&
                        (currentChunkWordCount + nextSentenceWordCount <= MAX_CHUNK_WORDS)) {
                        splitPoint = false; // Defer split
                    }
                }

                // Refinement 2: Avoid Orphaned Short Sentences
                if (splitPoint && (currentChunkWordCount + nextSentenceWordCount <= MAX_CHUNK_WORDS)) {
                    if (nextSentenceWordCount < SHORT_SENTENCE_WORD_THRESHOLD && nextSentenceWordCount > 0) {
                        if (embedding && nextEmbedding) {
                            const orphanSimilarity = cosineSimilarity(embedding, nextEmbedding);
                            if (orphanSimilarity > ORPHAN_SIMILARITY_THRESHOLD) {
                                splitPoint = false; // Defer split
                            }
                        }
                    }
                }
            }
        } else {
            splitPoint = true; // Last sentence, always split
        }
        // New split point logic ends here.
        // The existing 'if (splitPoint) { ... }' block for finalizing chunks follows this.

        if (splitPoint) {
            let chunkText = currentChunkSentences.join(' ').trim();
            // Note: Sentences were already preprocessed. Re-joining and trimming is fine.
            // No need to call preprocessTextForEmbedding(chunkText) again unless joining adds new artifacts.
            // For now, assume joining spaces is fine. If issues, consider a light final cleanup.

            if (validateChunk(chunkText)) { // validateChunk uses MIN_CHUNK_LENGTH_CHARS and MIN_KEYWORDS_FOR_VALIDATION
                const metadata = {
                    ...baseMetadata,
                    chunk_index: chunkIndex++,
                    chunk_char_length: chunkText.length, // Using final chunkText length
                    content_type_hint: "text_semantic" // New hint for semantically chunked text
                };
                if (baseMetadata.source_document_updated_at) {
                    metadata.source_document_updated_at = baseMetadata.source_document_updated_at;
                }
                chunks.push({ text: chunkText, metadata: metadata });
                previousChunkFinalSentences = Array.from(currentChunkSentences);
                // REMOVED previousChunkFinalSentences update from here
            } else {
                // console.log(`(Ingestion Service) Discarding chunk (failed validation): "${chunkText.substring(0, 100)}..."`);
                // If a chunk is discarded, we should not use its sentences for overlap in the next one.
                // However, previousChunkFinalSentences would still hold sentences from the *last valid* chunk.
            }
            currentChunkSentences = [];
            currentChunkWordCount = 0;

            if (previousChunkFinalSentences.length > 0 && sentenceOverlapCount > 0) {
                const overlapSentences = previousChunkFinalSentences.slice(-sentenceOverlapCount);
                currentChunkSentences.push(...overlapSentences);
                currentChunkWordCount += overlapSentences.join(' ').split(/\s+/).length;
            }
            // REMOVED overlap logic from here
        }
    }
    console.log(`(Ingestion Service) SEMANTIC text chunking completed for ${baseMetadata.source_name}. Generated ${chunks.length} chunks.`);
    return chunks;
}


/**
 * Divide el contenido HTML en chunks jerárquicos.
 * MODIFIED: Accepts baseMetadata and incorporates it.
 */
// TODO: Enhance HTML text extraction for complex, JavaScript-heavy sites.
// The current Cheerio-based approach is suitable for static or server-rendered HTML but may struggle with client-side rendered content.
// For more robust extraction from dynamic sites, consider using a headless browser library like Puppeteer or Playwright (via jsdom or similar if full browser automation is too heavy).
// This would allow for:
// 1. JavaScript execution to get the final DOM state.
// 2. More accurate text extraction that mirrors what a user sees.
// 3. Better handling of interactive elements or content loaded dynamically.
// Such an enhancement would be particularly beneficial before applying semantic chunking to HTML content,
// as the quality of extracted text directly impacts chunking and subsequent embedding quality.
// Also, consider advanced content extraction libraries (e.g., Readability.js port) to isolate main article text.
function chunkContent(html, url, baseMetadata, elementOverlapCount = 1) { // baseMetadata is new, elementOverlapCount added
    // TODO: Explore sentence-level semantic splitting for long text content within HTML elements.
    console.log(`(Ingestion Service) Starting HTML chunking for URL: ${url}, source_id: ${baseMetadata.original_source_id}, elementOverlap: ${elementOverlapCount}`);

    let htmlToProcess = html; // Default to original HTML from Puppeteer
    try {
        const doc = new JSDOM(html, { url: url });
        const reader = new Readability(doc.window.document);
        const article = reader.parse();

        if (article && article.content) {
            htmlToProcess = article.content;
            console.log(`(Ingestion Service) Readability successfully extracted main content for URL: ${url}. Using article content for chunking.`);
            // Optional: Log title and author if needed: console.log(`Title: ${article.title}, Author: ${article.byline}`);
        } else {
            console.warn(`(Ingestion Service) Readability could not extract main content for URL: ${url}. Falling back to processing raw HTML.`);
        }
    } catch (readabilityError) {
        console.warn(`(Ingestion Service) Error during Readability processing for URL: ${url}. Error: ${readabilityError.message}. Falling back to raw HTML.`);
        // htmlToProcess remains the original html
    }

    const $ = load(htmlToProcess); // Use htmlToProcess which is either original or from Readability
    const chunks = [];
    let contextStack = []; // Will store {level, text} objects
    let currentChunkLines = [];
    let currentChunkRawElements = []; // Store raw text of elements for overlap
    let currentWordCount = 0;
    let chunkIndex = 0;
    let elementsToPrependForOverlap = [];

    // Standard noise removal
    $('.cookie-banner, #cookie-notice, .header-banner, [role="banner"], [role="contentinfo"], script, style, nav, footer, header, aside, form, noscript, iframe, svg, link[rel="stylesheet"], button, input, select, textarea, label, .sidebar, #sidebar, .comments, #comments, .related-posts, .share-buttons, .pagination, .breadcrumb, .modal, .popup, [aria-hidden="true"], [role="navigation"], [role="search"], .ad, .advertisement, #ad, #advertisement').remove();

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
                        content_type_hint: currentHierarchy && currentHierarchy.length > 0 ? "structured_html" : "html_content",
                        contributing_tags: Array.from(new Set(currentChunkRawElements.map(e => e.tag).filter(tag => tag)))
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
                    content_type_hint: lastElementInChunkHierarchy && lastElementInChunkHierarchy.length > 0 ? "structured_html" : "html_content",
                    contributing_tags: Array.from(new Set(currentChunkRawElements.map(e => e.tag).filter(tag => tag)))
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
                    content_type_hint: lastElementInChunkHierarchy && lastElementInChunkHierarchy.length > 0 ? "structured_html" : "html_content",
                    contributing_tags: Array.from(new Set(currentChunkRawElements.map(e => e.tag).filter(tag => tag)))
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
                    content_type_hint: lastElementInChunkHierarchy && lastElementInChunkHierarchy.length > 0 ? "structured_html" : "html_content",
                    contributing_tags: Array.from(new Set(currentChunkRawElements.map(e => e.tag).filter(tag => tag)))
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
            .select(); // MODIFIED: Select all columns to get IDs back

        if (error) {
            console.error("(Ingestion Service) Error storing chunks in Supabase:", error.message);
            if (error.details) console.error("Details:", error.details);
            // Return the actual data array as empty if error, to match success structure better for caller
            return { success: false, error: error.message, details: error.details, data: [], count: 0 };
        }
        
        // data here is an array of inserted records
        const numStored = data ? data.length : 0;
        console.log(`(Ingestion Service) Storage complete. ${numStored} chunks saved for client ${clientId}.`);
        return { success: true, data: data, count: numStored }; // data contains inserted records with IDs

    } catch (dbError) {
        console.error("(Ingestion Service) Unexpected error during Supabase chunk storage:", dbError);
        return { success: false, error: dbError.message, count: 0 };
    }
}

// --- Funciones para Proposiciones ---

/**
 * Extracts propositions from a text segment, generates their embeddings, and stores them.
 * @param {string} textSegment - The text to extract propositions from.
 * @param {string} clientId - The client ID.
 * @param {string} originalSourceId - The ID of the original knowledge source.
 * @param {string} sourceChunkId - The ID of the parent chunk in knowledge_base.
 * @param {string} sourceChunkContent - The content of the source chunk (used for context if needed, currently unused directly here but good for future).
 */
async function extractAndStorePropositions(textSegment, clientId, originalSourceId, sourceChunkId, sourceChunkContent) {
    console.log(`(Ingestion Service) Extracting propositions for source_chunk_id: ${sourceChunkId}`);
    if (!textSegment || textSegment.split(/\s+/).length < 30) { // Min words for proposition extraction
        console.log(`(Ingestion Service) Text segment too short for proposition extraction (source_chunk_id: ${sourceChunkId}). Skipping.`);
        return { success: true, count: 0, message: "Text segment too short." };
    }

    const propositionsToStore = [];
    try {
        const prompt = `Extrae todas las afirmaciones factuales individuales (proposiciones) del siguiente texto. Cada proposición debe ser una declaración concisa y autocontenida. Enumera cada proposición en una nueva línea. Asegúrate de que las proposiciones estén en español. Texto:\n\n'${textSegment}'`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo', // Cheaper and faster model for this task
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2, // Lower temperature for more factual and less creative output
            max_tokens: 1000, // Adjust as needed based on typical textSegment length
        });

        const rawResult = completion.choices[0]?.message?.content;
        if (!rawResult) {
            console.warn(`(Ingestion Service) Proposition extraction returned no content for chunk ${sourceChunkId}.`);
            return { success: false, count: 0, error: "No content from LLM." };
        }

        const extractedLines = rawResult.split('\n').map(p => p.trim()).filter(p => p.length > 0);

        console.log(`(Ingestion Service) Extracted ${extractedLines.length} potential propositions for chunk ${sourceChunkId}.`);
        let processedCount = 0;

        for (const propText of extractedLines) {
            if (propText.split(/\s+/).length < 5 || propText.split(/\s+/).length > 70) {
                // console.log(`(Ingestion Service) Proposition "${propText.substring(0,30)}..." skipped due to length.`);
                continue;
            }

            try {
                // Generate embedding for the proposition
                const embeddingResponse = await openai.embeddings.create({
                    model: EMBEDDING_MODEL,
                    input: propText.replace(/\n/g, ' '), // OpenAI recommends replacing newlines
                });

                const propositionEmbedding = embeddingResponse.data[0]?.embedding;

                if (propositionEmbedding) {
                    propositionsToStore.push({
                        client_id: clientId,
                        original_source_id: originalSourceId,
                        source_chunk_id: sourceChunkId, // FK to knowledge_base.id
                        proposition_text: propText,
                        embedding: propositionEmbedding,
                        // metadata can be added here if needed in future
                    });
                    processedCount++;
                } else {
                    console.warn(`(Ingestion Service) Failed to generate embedding for proposition: "${propText.substring(0,50)}..."`);
                }
            } catch (embedError) {
                console.error(`(Ingestion Service) Error generating embedding for proposition "${propText.substring(0,50)}...": ${embedError.message}`);
                // Optional: Decide if one error should stop all, or just skip this proposition
            }
        }

        if (propositionsToStore.length > 0) {
            console.log(`(Ingestion Service) Storing ${propositionsToStore.length} propositions for chunk ${sourceChunkId}.`);
            const { error: insertError } = await supabase
                .from('knowledge_propositions')
                .insert(propositionsToStore);

            if (insertError) {
                console.error(`(Ingestion Service) Error storing propositions for chunk ${sourceChunkId}: ${insertError.message}`);
                return { success: false, count: 0, error: `Supabase insert error: ${insertError.message}` };
            }
            console.log(`(Ingestion Service) Successfully stored ${propositionsToStore.length} propositions for chunk ${sourceChunkId}.`);
        } else {
            console.log(`(Ingestion Service) No valid propositions to store for chunk ${sourceChunkId} after processing.`);
        }
        return { success: true, count: propositionsToStore.length, processedPotentials: extractedLines.length };

    } catch (error) {
        console.error(`(Ingestion Service) Error during proposition extraction for chunk ${sourceChunkId}: ${error.message}`, error.stack ? error.stack.substring(0,300) : '');
        return { success: false, count: 0, error: error.message };
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
    let source; // To store source details
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
        const sourceName = source.source_name || 'Unknown Source'; // Ensure sourceName is defined

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
            charCount = textToProcess.length; // Original text length

            // --- PDF Table Extraction Logic ---
            let tableMarkdown = "";
            try {
                console.log(`(Ingestion Service) Starting table extraction for PDF source: ${source.source_id}`);
                const tablesResult = await new Promise((resolve, reject) => {
                    const nodeBuffer = Buffer.from(fileBuffer); // Convert ArrayBuffer to Node.js Buffer
                    pdfTableExtractor(nodeBuffer, (result) => resolve(result), (err) => reject(err));
                });

                if (tablesResult && tablesResult.pageTables && tablesResult.pageTables.length > 0) {
                    console.log(`(Ingestion Service) Found ${tablesResult.numPages} pages, ${tablesResult.numTablesFound} tables in PDF: ${source.source_id}`);
                    tablesResult.pageTables.forEach(pageTable => {
                        if (pageTable.tables && pageTable.tables.length > 0) { // Ensure pageTable.tables is defined
                            tableMarkdown += `\n\n--- Table (Page ${pageTable.page}) ---\n\n`;
                            pageTable.tables.forEach((table, tableIndex) => {
                                // Convert table (array of arrays) to Markdown
                                if (table.length > 0) {
                                    const headerRow = table[0];
                                    tableMarkdown += `| ${headerRow.join(' | ')} |\n`;
                                    tableMarkdown += `| ${headerRow.map(() => '---').join(' | ')} |\n`;
                                    table.slice(1).forEach(row => {
                                        tableMarkdown += `| ${row.join(' | ')} |\n`;
                                    });
                                    tableMarkdown += `\n`; // Add a newline after each table
                                }
                            });
                        }
                    });
                    if (tableMarkdown) {
                         console.log(`(Ingestion Service) Successfully extracted and formatted tables into Markdown for PDF: ${source.source_id}`);
                    }
                } else {
                    console.log(`(Ingestion Service) No tables found or pdf-table-extractor returned empty result for PDF: ${source.source_id}`);
                }
            } catch (tableError) {
                console.warn(`(Ingestion Service) Error during PDF table extraction for source ${source.source_id}: ${tableError.message || tableError}. Tables will not be included.`);
                // tableMarkdown remains ""
            }
            // Append to textToProcess
            if (tableMarkdown) {
                textToProcess += tableMarkdown;
                // Note: charCount is NOT updated here to reflect original text length only.
            }
            // --- End PDF Table Extraction Logic ---

            // --- PDF Image Extraction and OCR Logic ---
            let ocrTextAccumulator = "";
            // Ensure fileBuffer is defined from the pdfParse step
            const nodeBufferForImages = Buffer.from(fileBuffer);
            const tempImageDir = path.join(os.tmpdir(), `synchat_ocr_${source.source_id}_${Date.now()}`);
            let tempPdfPath = null;

            try {
                console.log(`(Ingestion Service) Starting image extraction and OCR for PDF: ${source.source_id}`);
                await fs.mkdir(tempImageDir, { recursive: true });
                tempPdfPath = path.join(tempImageDir, 'temp_source_for_ocr.pdf');
                await fs.writeFile(tempPdfPath, nodeBufferForImages);

                const pdfImage = new PDFImage(tempPdfPath, {
                    outputDirectory: tempImageDir,
                    convertOptions: {
                        "-density": "300",
                        "-quality": "90",
                        "-background": "white",
                        "-alpha": "remove"
                    }
                });
                const imageFilePaths = await pdfImage.convertFile();

                if (imageFilePaths && imageFilePaths.length > 0) {
                    ocrTextAccumulator += "\n\n--- OCR Extracted Text from Images ---\n\n";
                    const worker = await Tesseract.createWorker('eng');
                    // Note: For Tesseract.js v4+, loadLanguage and initialize are part of createWorker or not needed explicitly for the first language.
                    // If using older versions or more complex setups, loadLanguage/initialize might be needed.

                    for (const imagePath of imageFilePaths) {
                        try {
                            const { data: { text } } = await worker.recognize(imagePath);
                            if (text && text.trim().length > 0) {
                                ocrTextAccumulator += text.trim() + "\n---\n"; // Separator
                                console.log(`(Ingestion Service) OCR successful for ${path.basename(imagePath)}, text length: ${text.trim().length}`);
                            } else {
                                console.log(`(Ingestion Service) OCR for ${path.basename(imagePath)} produced no text.`);
                            }
                            await fs.unlink(imagePath);
                        } catch (singleOcrError) {
                            console.warn(`(Ingestion Service) Error during OCR for image ${imagePath}: ${singleOcrError.message}`);
                            try { await fs.unlink(imagePath); } catch (e) { /* ignore cleanup error */ }
                        }
                    }
                    await worker.terminate();
                    console.log(`(Ingestion Service) OCR processing completed for PDF: ${source.source_id}`);
                } else {
                    console.log(`(Ingestion Service) No images extracted from PDF: ${source.source_id}`);
                }

            } catch (ocrError) {
                console.warn(`(Ingestion Service) Error during PDF image extraction/OCR for source ${source.source_id}: ${ocrError.message}. OCR text will not be included.`);
            } finally {
                if (tempPdfPath) {
                    try { await fs.unlink(tempPdfPath); } catch (e) { console.warn(`(Ingestion Service) Could not delete temp PDF for OCR: ${tempPdfPath}`, e.message); }
                }
                // Try to remove the directory and its contents if any images failed to delete individually
                try {
                    const remainingFiles = await fs.readdir(tempImageDir).catch(() => []);
                     for (const file of remainingFiles) {
                        try { await fs.unlink(path.join(tempImageDir, file)); } catch (e) { /* ignore */ }
                    }
                    await fs.rmdir(tempImageDir);
                } catch (e) {
                    // Log if directory removal fails but don't let it crash the main process
                    // It might fail if some files are still locked or due to other reasons
                    console.warn(`(Ingestion Service) Could not fully delete temp image directory: ${tempImageDir}. Manual cleanup might be needed. Error: ${e.message}`);
                }
            }

            if (ocrTextAccumulator.length > "\n\n--- OCR Extracted Text from Images ---\n\n".length + 5) { // Check if more than just header was added
                textToProcess += ocrTextAccumulator;
                 // Note: charCount is NOT updated here.
            }
            // --- End PDF Image Extraction and OCR Logic ---

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

            // --- Puppeteer logic start ---
            console.log(`(Ingestion Service) Fetching URL with Puppeteer: ${urlToIngest}`);
            const browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true, // Maintain if it was part of original context or review if needed. The provided file has it.
        }); // Added args for typical CI environments
            const page = await browser.newPage();
            await page.setUserAgent(USER_AGENT);
            await page.goto(urlToIngest, { waitUntil: 'networkidle2', timeout: 30000 });
            htmlContent = await page.content();
            await browser.close();
            console.log(`(Ingestion Service) Successfully fetched URL with Puppeteer. HTML length: ${htmlContent.length}`);
            // --- Puppeteer logic end ---

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
        let chunksForEmbedding; // Renamed to avoid confusion with chunksWithEmbeddingsAndIds
        // Initial baseMetadata with core, non-overwritable fields
        let baseMetadata = {
            original_source_id: source.source_id,
            source_name: sourceName,
        };

        // Add source_document_updated_at if it exists on the source
        if (source.updated_at) {
            baseMetadata.source_document_updated_at = source.updated_at;
        }

        // Add category_tags if they exist on the source
        if (source.category_tags && Array.isArray(source.category_tags) && source.category_tags.length > 0) {
            baseMetadata.category_tags = source.category_tags;
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
            chunksForEmbedding = chunkContent(htmlContent, source.source_name, baseMetadata, 1); // Stays non-async
        } else { // For 'pdf', 'txt', 'article' - now uses async semantic chunking
            chunksForEmbedding = await chunkTextContent(textToProcess, baseMetadata, 1); // MODIFIED HERE
        }

        // Ensure chunksForEmbedding is an array even if chunking failed or returned nothing
        if (!Array.isArray(chunksForEmbedding)) {
            console.warn(`(Ingestion Service) Chunking returned non-array for source ${sourceId}. Defaulting to empty array.`);
            chunksForEmbedding = [];
        }

        if (chunksForEmbedding.length === 0) {
            console.warn(`(Ingestion Service) No valid chunks generated for source ${sourceId}. Marking as completed.`);
            await updateKnowledgeSourceStatus(sourceId, 'completed', charCount, "No content chunks generated after processing.");
            return { success: true, message: "No valid content chunks found to ingest.", data: { chunksStored: 0, source_id: sourceId } };
        }
        console.log(`(Ingestion Service) Generated ${chunksForEmbedding.length} chunks for source ${sourceId}.`);

        // 5. Clear Existing Chunks for this source from knowledge_base
        console.log(`(Ingestion Service) Clearing existing chunks from knowledge_base for source_id: ${sourceId}`);
        const { error: deleteChunksError } = await supabase
            .from('knowledge_base')
            .delete()
            .eq('client_id', clientId) // Ensure we only delete for the correct client
            .eq('metadata->>original_source_id', sourceId); // Match the specific source

        if (deleteChunksError) {
            console.error(`(Ingestion Service) Error clearing old chunks from knowledge_base for source ${sourceId}: ${deleteChunksError.message}. Proceeding with ingestion.`);
        } else {
            console.log(`(Ingestion Service) Successfully cleared old chunks from knowledge_base for source ${sourceId}.`);
        }

        // 5b. Clear Existing Propositions for this source from knowledge_propositions
        console.log(`(Ingestion Service) Clearing existing propositions from knowledge_propositions for source_id: ${sourceId}`);
        const { error: deletePropsError } = await supabase
            .from('knowledge_propositions')
            .delete()
            .eq('client_id', clientId)
            .eq('original_source_id', sourceId);

        if (deletePropsError) {
            console.error(`(Ingestion Service) Error clearing old propositions for source ${sourceId}: ${deletePropsError.message}. Proceeding with ingestion.`);
        } else {
            console.log(`(Ingestion Service) Successfully cleared old propositions for source ${sourceId}.`);
        }

        // NEW LOGIC STARTS HERE:
        if (Array.isArray(chunksForEmbedding) && chunksForEmbedding.length > 0) {
            const totalChunksInDoc = chunksForEmbedding.length;
            console.log(`(Ingestion Service) Adding total_document_chunks metadata. Total chunks for source ${sourceId}: ${totalChunksInDoc}`);
            chunksForEmbedding.forEach(chunk => {
                if (chunk.metadata) {
                    chunk.metadata.total_document_chunks = totalChunksInDoc;
                    // chunk.metadata.chunk_index should already be set by the chunking functions.
                } else {
                    // This case should ideally not happen if chunks are formed correctly
                    console.warn(`(Ingestion Service) Chunk found without metadata while trying to add total_document_chunks. Source ID: ${sourceId}, Chunk text (first 50 chars): "${chunk.text ? chunk.text.substring(0,50) : 'N/A'}"`);
                }
            });
        }
        // NEW LOGIC ENDS HERE.

        // 6. Generate Embeddings for Chunks
        const embeddingResult = await generateEmbeddings(chunksForEmbedding); // Pass chunksForEmbedding
        if (!embeddingResult.success || !embeddingResult.data || embeddingResult.data.length === 0) {
            const errMsg = embeddingResult.error || "Failed to generate embeddings or no embeddings produced.";
            throw new Error(errMsg + (embeddingResult.errors?.length ? ` Details: ${embeddingResult.errors.join(', ')}` : ''));
        }
        const chunksWithEmbeddings = embeddingResult.data;

        // 7. Store Chunks in knowledge_base
        // storeChunks now returns { success, data (array of stored chunks with id), count }
        const storeChunksResult = await storeChunks(clientId, chunksWithEmbeddings);
        if (!storeChunksResult.success || !storeChunksResult.data || storeChunksResult.data.length === 0) {
            const errMsg = `Failed to store chunks for source ${sourceId}: ${storeChunksResult.error || 'No data returned from storeChunks'}`;
            throw new Error(errMsg + (storeChunksResult.details ? ` Details: ${storeChunksResult.details}` : ''));
        }
        
        const storedChunksWithIds = storeChunksResult.data; // These are the chunks from DB, with their IDs
        console.log(`(Ingestion Service) Successfully stored ${storedChunksWithIds.length} chunks in knowledge_base.`);

        // 8. Extract and Store Propositions for each stored chunk
        let totalPropositionsStored = 0;
        let propositionErrors = [];
        console.log(`(Ingestion Service) Starting proposition extraction for ${storedChunksWithIds.length} stored chunks.`);
        for (const storedChunk of storedChunksWithIds) {
            if (!storedChunk.id || !storedChunk.content || !storedChunk.metadata?.original_source_id) {
                console.warn(`(Ingestion Service) Skipping proposition extraction for a chunk due to missing id, content, or original_source_id. Chunk metadata:`, storedChunk.metadata);
                continue;
            }
            const propResult = await extractAndStorePropositions(
                storedChunk.content, // textSegment
                clientId,
                storedChunk.metadata.original_source_id,
                storedChunk.id,      // sourceChunkId (the ID of the chunk in knowledge_base)
                storedChunk.content  // sourceChunkContent
            );
            if (propResult.success) {
                totalPropositionsStored += propResult.count;
            } else {
                console.error(`(Ingestion Service) Proposition extraction failed for chunk ${storedChunk.id}: ${propResult.error}`);
                propositionErrors.push(`Chunk ${storedChunk.id}: ${propResult.error}`);
            }
        }
        console.log(`(Ingestion Service) Proposition extraction phase completed. Stored ${totalPropositionsStored} propositions in total.`);
        if(propositionErrors.length > 0) {
            console.warn(`(Ingestion Service) Some errors occurred during proposition extraction: ${propositionErrors.join('; ')}`);
            // Decide if these errors should mark the ingestion as partial_success or failed_ingest
            // For now, we'll let it proceed to 'completed' but log the errors.
            // Consider adding a field to knowledge_sources for 'last_ingest_warnings'
        }

        // 9. Update Status based on proposition errors
        let finalStatus = 'completed';
        let finalErrorMessage = null;

        if (propositionErrors.length > 0) {
            finalStatus = 'completed_with_warnings';
            finalErrorMessage = `Proposition extraction encountered ${propositionErrors.length} error(s). Details: ${propositionErrors.join('; ').substring(0, 500)}`; // Limit error message length
            console.warn(`(Ingestion Service) Ingestion for Source ID: ${sourceId} completed with proposition warnings.`);
        }

        await updateKnowledgeSourceStatus(sourceId, finalStatus, charCount, finalErrorMessage);
        console.log(`--- (Ingestion Service) Ingestion ${finalStatus.toUpperCase()} for Source ID: ${sourceId} ---`);
        return { 
            success: true, 
            message: `Ingestion ${finalStatus}.` + (propositionErrors.length > 0 ? ` Proposition errors: ${propositionErrors.length}` : ""),
            data: { 
                source_id: sourceId,
                chunksAttempted: chunksForEmbedding.length,
                chunksSuccessfullyEmbeddedAndStored: storedChunksWithIds.length,
                propositionsStored: totalPropositionsStored,
                tokensUsedForChunkEmbeddings: embeddingResult.totalTokens, // Note: this doesn't include proposition extraction/embedding tokens
                characterCount: charCount,
                embeddingGenerationErrors: embeddingResult.errors,
                propositionIngestionErrors: propositionErrors
            } 
        };

    } catch (error) {
        let errorMessage = `Unknown error during ingestion of source ${sourceId}.`;
        // Note: The specific axios.isAxiosError check might be less relevant if Puppeteer is the primary fetcher for URLs.
        // However, keeping a general error instanceof Error check is good.
        // Puppeteer errors (e.g., TimeoutError) will be caught by `error instanceof Error`.
        if (error.name === 'TimeoutError') { // Example of catching a specific Puppeteer error
            errorMessage = `Puppeteer navigation timeout for source ${sourceId} (URL: ${source?.source_name}): ${error.message}`;
        } else if (axios.isAxiosError(error)) { // Keep for other potential axios uses or if Puppeteer fails and falls back (not current design)
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


// Ensure no trailing newlines or content after this removal if it's the absolute end of the file.

// --- Exports ---
// ingestSourceById e ingestWebsite ya están exportadas en su definición.
// Las siguientes funciones se exportan para posible uso interno o pruebas,
// asegurándose de que no estén ya exportadas en su definición.
export {
    // updateKnowledgeSourceStatus, // Interna
    // cosineSimilarity, // Interna
    // getSentenceEmbeddings, // Interna
    // chunkTextContent, // Interna (ahora async)
    // chunkContent, // Interna
    // generateEmbeddings, // Interna
    // storeChunks, // Interna
    // extractAndStorePropositions, // Interna
    validateChunk // Exportada utilidad
};
