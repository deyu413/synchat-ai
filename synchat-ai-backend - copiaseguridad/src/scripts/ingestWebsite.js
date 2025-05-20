// src/scripts/ingestWebsite.js
import 'dotenv/config';
import axios from 'axios';
import { load } from 'cheerio'; // Importa solo la función 'load' nombrada
import { createClient } from '@supabase/supabase-js'; // Importar directamente aquí
import OpenAI from 'openai'; // Importar directamente aquí

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
    console.error("Error: Faltan variables de entorno (SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY).");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: openaiApiKey });

console.log("Clientes Supabase y OpenAI inicializados para ingesta.");

// --- Funciones de Ayuda ---

/**
 * Valida la calidad de un chunk de texto.
 */
function validateChunk(text) {
    if (!text || text.trim().length < MIN_CHUNK_LENGTH_CHARS) {
        return false;
    }
    // Contar palabras significativas (más de 3 letras)
    const significantWords = text.match(/\b[a-zA-ZáéíóúñÁÉÍÓÚÑ]{4,}\b/g) || [];
    return significantWords.length >= MIN_KEYWORDS_FOR_VALIDATION;
}

/**
 * Divide el contenido HTML en chunks jerárquicos.
 */
function chunkContent(html, url) {
    console.log("Iniciando chunking jerárquico...");
    const $ = load(html); // Llama directamente a la función 'load'
    const chunks = [];
    let contextStack = []; // ["H1 Text", "H2 Text", ...]
    let currentChunkLines = [];
    let currentWordCount = 0;

    // 1. Limpieza Preliminar (más agresiva)
    $('script, style, nav, footer, header, aside, form, noscript, iframe, svg, link[rel="stylesheet"], button, input, select, textarea, label, .sidebar, #sidebar, .comments, #comments, .related-posts, .share-buttons, .pagination, .breadcrumb, .modal, .popup, [aria-hidden="true"], [role="navigation"], [role="search"], .ad, .advertisement, #ad, #advertisement').remove();
    console.log("Ruido HTML eliminado.");

    // 2. Selección de Elementos Relevantes
    const relevantSelectors = 'h1, h2, h3, h4, h5, h6, p, li, td, th, pre, blockquote';
    // Podríamos añadir 'div' si sospechamos que hay contenido importante fuera de las etiquetas estándar,
    // pero aumentaría el riesgo de ruido.

    $(relevantSelectors).each((i, el) => {
        const $el = $(el);
        const tag = $el.prop('tagName').toLowerCase();
        // Limpiar texto: eliminar espacios múltiples, conservar saltos de línea intencionados (ej, <pre>)
        let text = ($el.text() || '').replace(/\s\s+/g, ' ').trim();

        if (text.length < 15) return; // Ignorar elementos muy cortos

        // 3. Gestión de Contexto Jerárquico
        let currentHierarchy = [...contextStack]; // Copia para este elemento
        if (tag.match(/^h[1-6]$/)) {
            const level = parseInt(tag[1]);
            // Eliminar niveles inferiores o iguales al actual
            contextStack = contextStack.slice(0, level - 1);
            contextStack[level - 1] = text; // Establecer el encabezado actual
            currentHierarchy = [...contextStack]; // Usar la jerarquía actualizada
            // Los encabezados inician un nuevo chunk si hay algo acumulado
            if (currentWordCount > 0) {
                 const chunkText = currentChunkLines.join('\n');
                 if (validateChunk(chunkText)) {
                      chunks.push({
                          text: chunkText,
                          metadata: { url, hierarchy: [...contextStack.slice(0, level-1)] } // Jerarquía ANTERIOR al H
                      });
                 }
                 currentChunkLines = [];
                 currentWordCount = 0;
            }
        }

        // 4. Construcción de Chunks
        const elementWordCount = text.split(/\s+/).length;

        // Si añadir este elemento excede el MÁXIMO, guardar el chunk actual (si es válido)
        if (currentWordCount > 0 && (currentWordCount + elementWordCount) > MAX_CHUNK_WORDS) {
             const chunkText = currentChunkLines.join('\n');
             if (validateChunk(chunkText)) {
                 chunks.push({
                     text: chunkText,
                     metadata: { url, hierarchy: [...currentHierarchy] } // Jerarquía del último elemento añadido
                 });
            }
            // Empezar nuevo chunk con el elemento actual
            currentChunkLines = [text];
            currentWordCount = elementWordCount;
        } else {
            // Añadir al chunk actual
            currentChunkLines.push(text);
            currentWordCount += elementWordCount;
        }

        // Si hemos alcanzado el tamaño OBJETIVO, guardar el chunk actual (si es válido)
        if (currentWordCount >= TARGET_CHUNK_WORDS) {
             const chunkText = currentChunkLines.join('\n');
             if (validateChunk(chunkText)) {
                 chunks.push({
                     text: chunkText,
                     metadata: { url, hierarchy: [...currentHierarchy] } // Jerarquía del último elemento
                 });
             }
            currentChunkLines = [];
            currentWordCount = 0;
        }
    });

    // Guardar el último chunk restante si es válido
    if (currentWordCount > 0) {
        const chunkText = currentChunkLines.join('\n');
        if (validateChunk(chunkText)) {
            chunks.push({
                text: chunkText,
                metadata: { url, hierarchy: [...contextStack] } // Última jerarquía conocida
            });
        }
    }

    console.log(`Chunking completado. Generados ${chunks.length} chunks válidos.`);
    // console.log("Primer chunk:", chunks[0]); // Para depuración
    return chunks;
}


/**
 * Genera embeddings para los chunks en lotes.
 */
async function generateEmbeddings(chunks) {
    console.log(`Generando embeddings para ${chunks.length} chunks (lotes de ${EMBEDDING_BATCH_SIZE})...`);
    const embeddingsData = []; // [{ chunk: {}, embedding: [] }, ...]
    let totalTokens = 0;

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        const inputs = batchChunks.map(c => c.text.replace(/\n/g, ' ')); // Limpiar saltos de línea para embedding

        try {
            console.log(`Procesando lote ${Math.floor(i/EMBEDDING_BATCH_SIZE) + 1}/${Math.ceil(chunks.length/EMBEDDING_BATCH_SIZE)}...`);
            const { data: embeddingResponseData, usage } = await openai.embeddings.create({
                model: EMBEDDING_MODEL,
                input: inputs
            });

            if (usage) totalTokens += usage.total_tokens;

            if (!embeddingResponseData || embeddingResponseData.length !== batchChunks.length) {
                 console.warn(`Respuesta de embedding inesperada para el lote ${i}. Se recibieron ${embeddingResponseData?.length || 0} embeddings.`);
                 // Marcar estos chunks como fallidos o reintentar? Por ahora, los omitimos.
                 continue; // Saltar este lote
            }

            batchChunks.forEach((chunk, idx) => {
                if (embeddingResponseData[idx]?.embedding) {
                    embeddingsData.push({
                        ...chunk, // Incluye text y metadata
                        embedding: embeddingResponseData[idx].embedding
                    });
                } else {
                     console.warn(`No se pudo generar embedding para el chunk ${i+idx}. Texto: "${chunk.text.substring(0,50)}..."`);
                }
            });

             // Pausa pequeña entre lotes para evitar rate limits estrictos
             if (i + EMBEDDING_BATCH_SIZE < chunks.length) {
                 await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 segundos
             }

        } catch (error) {
            console.error(`Error generando embeddings para el lote ${i}:`, error.message);
            // Podríamos implementar reintentos aquí
        }
    }
    console.log(`Embeddings generados para ${embeddingsData.length} chunks. Tokens totales usados: ${totalTokens}`);
    return embeddingsData;
}

/**
 * Almacena los chunks con embeddings en Supabase.
 */
async function storeChunks(clientId, chunksWithEmbeddings) {
    if (!chunksWithEmbeddings || chunksWithEmbeddings.length === 0) {
        console.log("No hay chunks válidos con embeddings para almacenar.");
        return { data: null, error: null, count: 0 };
    }

    console.log(`Almacenando ${chunksWithEmbeddings.length} chunks en Supabase para cliente ${clientId}...`);

    // Mapear al formato esperado por la tabla 'knowledge_base'
    const recordsToInsert = chunksWithEmbeddings.map(c => ({
        client_id: clientId,
        content: c.text, // Texto original del chunk
        embedding: c.embedding, // Vector
        metadata: c.metadata, // Objeto { url, hierarchy }
        // 'fts' (tsvector) debería generarse automáticamente en Supabase
        // mediante un trigger o columna generada:
        // Ejemplo SQL: ALTER TABLE knowledge_base ADD COLUMN fts tsvector
        // GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED;
    }));

    try {
        // Insertar en lotes si es necesario (Supabase tiene límites, pero insert suele manejar arrays grandes)
        const { data, error, count } = await supabase
            .from('knowledge_base') // Nombre de tu tabla RAG
            .insert(recordsToInsert);

        if (error) {
            console.error("Error al almacenar chunks en Supabase:", error.message);
            // Loguear detalles del error si es posible
            if (error.details) console.error("Detalles:", error.details);
             if (error.hint) console.error("Sugerencia:", error.hint);
            return { data, error, count: count || 0 };
        }

        console.log(`Almacenamiento completado. ${count ?? recordsToInsert.length} chunks guardados/actualizados.`);
        return { data, error, count: count ?? recordsToInsert.length };

    } catch (error) {
        console.error("Error inesperado durante el almacenamiento en Supabase:", error);
        return { data: null, error, count: 0 };
    }
}

// --- Ejecución Principal del Script ---
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Uso: node src/scripts/ingestWebsite.js <clientId> <url>");
        process.exit(1);
    }
    const clientId = args[0];
    const urlToIngest = args[1];

    if (!clientId || !urlToIngest || !urlToIngest.startsWith('http')) {
        console.error("Por favor, proporciona un clientId válido y una URL completa (ej: https://...).");
        process.exit(1);
    }

    console.log(`\n--- Iniciando Ingesta para Cliente ${clientId} desde ${urlToIngest} ---`);

    try {
        // 1. Descargar HTML
        console.log("Descargando HTML...");
        const response = await axios.get(urlToIngest, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000 // Timeout de 15 segundos
        });
        const html = response.data;
        console.log(`HTML descargado (${(html.length / 1024).toFixed(1)} KB).`);

        // 2. Extraer y Dividir Contenido
        const chunks = chunkContent(html, urlToIngest);
        if (chunks.length === 0) {
            console.warn("No se generaron chunks válidos. Finalizando ingesta.");
            return;
        }

        // 3. Generar Embeddings
        const chunksWithEmbeddings = await generateEmbeddings(chunks);
        if (chunksWithEmbeddings.length === 0) {
            console.warn("No se pudieron generar embeddings. Finalizando ingesta.");
            return;
        }

        // 4. Almacenar en Supabase
        await storeChunks(clientId, chunksWithEmbeddings);

        console.log(`--- Ingesta Finalizada para ${urlToIngest} ---`);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`Error de red/HTTP al descargar ${urlToIngest}: ${error.message}`);
             if (error.response) {
                 console.error(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data).substring(0, 200)}...`);
             }
        } else {
            console.error(`Error general durante la ingesta de ${urlToIngest}:`, error.message);
             if (error.stack) { console.error(error.stack.substring(0, 500)); }
        }
        process.exitCode = 1; // Indicar que hubo un error
    }
}

// Ejecutar la función principal
main();