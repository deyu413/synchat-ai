// src/services/openaiService.js
import OpenAI from 'openai';
import 'dotenv/config';

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
    console.error("¡Error Fatal! La variable de entorno OPENAI_API_KEY no está definida.");
    // Lanzar error para detener la aplicación si falta la clave
    throw new Error("OPENAI_API_KEY no definida.");
}

const openai = new OpenAI({ apiKey });

console.log("(OpenAI Service) Cliente OpenAI inicializado.");

/**
 * Obtiene una respuesta del modelo de chat de OpenAI.
 * @param {Array<object>} messages - Array de mensajes en formato OpenAI.
 * @param {string} modelName - Nombre del modelo a usar (ej: "gpt-3.5-turbo").
 * @param {number} temperature - Temperatura para la generación.
 * @returns {Promise<string|null>} - La respuesta del bot o null si hay error.
 */
export const getChatCompletion = async (messages, modelName = "gpt-3.5-turbo", temperature = 0.7) => {
    console.log(`(OpenAI Service) Enviando ${messages.length} mensajes a la API (Modelo: ${modelName}, Temp: ${temperature})...`);
    try {
        const completion = await openai.chat.completions.create({
            model: modelName,
            messages: messages,
            temperature: temperature,
            // max_tokens: 500, // Considera añadir si necesitas limitar longitud
        });

        // Loguear el uso de tokens (útil para control de costes)
        if (completion.usage) {
            console.log(`(OpenAI Service) Tokens Usados: Prompt=${completion.usage.prompt_tokens}, Completion=${completion.usage.completion_tokens}, Total=${completion.usage.total_tokens}`);
        }

        const reply = completion.choices?.[0]?.message?.content?.trim();

        if (reply) {
            console.log("(OpenAI Service) Respuesta recibida de la API.");
            return reply;
        } else {
            console.error("(OpenAI Service) Respuesta inesperada o vacía de la API:", JSON.stringify(completion, null, 2));
            return null;
        }

    } catch (error) {
        console.error(`(OpenAI Service) Error al llamar a la API de OpenAI (${modelName}):`, error?.message || error);
         // Puedes añadir manejo específico para ciertos códigos de estado si es necesario
         // ej: if (error.status === 429) { ... } // Rate limit
        return null;
    }
};

// No necesitamos exportar el cliente directamente