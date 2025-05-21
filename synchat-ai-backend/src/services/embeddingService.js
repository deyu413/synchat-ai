// src/services/embeddingService.js
import OpenAI from 'openai';
import 'dotenv/config';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
    console.error("¡Error Fatal! OPENAI_API_KEY no definida para Embedding Service.");
    throw new Error("OPENAI_API_KEY no definida.");
}

const openai = new OpenAI({ apiKey });

console.log("(Embedding Service) Cliente OpenAI inicializado para embeddings.");

// Configuración de Embedding
const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSION = 1536; // Exportar dimensión si es necesario en otro lugar

/**
 * Obtiene el vector (embedding) para un texto dado.
 * @param {string} text - El texto a convertir en vector.
 * @returns {Promise<Array<number>|null>} - El vector o null si hay error.
 */
export const getEmbedding = async (text) => {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        console.warn("(Embedding Service) Texto inválido o vacío proporcionado.");
        return null;
    }

    // Limpiar y normalizar texto
    const inputText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
     if (inputText.length === 0) {
         return null;
     }

    console.log(`(Embedding Service) Obteniendo embedding para texto: "${inputText.substring(0, 70)}..."`);

    try {
        const response = await openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: inputText,
            // dimensions: EMBEDDING_DIMENSION // OpenAI recomienda no especificar para text-embedding-3-small a menos que necesites truncar
        });

        // Loguear uso de tokens
         if (response.usage) {
             console.log(`(Embedding Service) Tokens Usados: ${response.usage.total_tokens}`);
         }

        const embedding = response?.data?.[0]?.embedding;

        if (embedding) {
             // Validación opcional de dimensión (puede variar ligeramente)
             // if (embedding.length !== EMBEDDING_DIMENSION) {
             //     console.warn(`(Embedding Service) Dimensión obtenida (${embedding.length}) difiere de la esperada (${EMBEDDING_DIMENSION})`);
             // }
             console.log("(Embedding Service) Embedding obtenido.");
            return embedding;
        } else {
            console.error("(Embedding Service) Respuesta inesperada de la API de Embeddings:", JSON.stringify(response, null, 2));
            return null;
        }
    } catch (error) {
        console.error(`(Embedding Service) Error al obtener embedding:`, error?.message || error);
        return null;
    }
};