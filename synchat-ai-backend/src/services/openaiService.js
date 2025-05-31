// src/services/openaiService.js
import openai from '../config/openaiClient.js'; // Use the shared client

if (!process.env.OPENAI_API_KEY) {
    throw new Error("Fatal Error: OPENAI_API_KEY must be defined in the environment variables.");
}

// console.log("(OpenAI Service) Using shared OpenAI client."); // Original log from shared client is in openaiClient.js

/**
 * Obtiene una respuesta del modelo de chat de OpenAI.
 * @param {Array<object>} messages - Array de mensajes en formato OpenAI.
 * @param {string} modelName - Nombre del modelo a usar (ej: "gpt-3.5-turbo").
 * @param {number} temperature - Temperatura para la generación.
 * @param {number} [maxTokensOverride] - Opcional: Número máximo de tokens para la respuesta.
 * @returns {Promise<string|null>} - La respuesta del bot o null si hay error.
 */
export const getChatCompletion = async (messages, modelName = "gpt-3.5-turbo", temperature = 0.7, maxTokensOverride = null) => {
    const effectiveMaxTokens = maxTokensOverride !== null ? maxTokensOverride : 500; // Default to 500 if not provided
    console.log(`(OpenAI Service) Enviando ${messages.length} mensajes a la API (Modelo: ${modelName}, Temp: ${temperature}, MaxTokens: ${effectiveMaxTokens})...`);
    try {
        const completion = await openai.chat.completions.create({
            model: modelName,
            messages: messages,
            temperature: temperature,
            max_tokens: effectiveMaxTokens,
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
