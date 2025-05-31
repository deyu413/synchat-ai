// src/services/knowledgeSuggestionService.js
import { supabase } from './supabaseClient.js';
import { getEmbedding, getChatCompletion } from './openaiService.js'; // Assuming getEmbedding might be used for future clustering
import * as db from './databaseService.js'; // For fetching conversation data, analytics

const TEXT_EMBEDDING_MODEL = "text-embedding-3-small";
const CHAT_COMPLETION_MODEL = "gpt-3.5-turbo";

const MAX_SUGGESTIONS_TO_CREATE_PER_RUN = 10; // Limit to avoid excessive OpenAI calls / DB writes in one go

/**
 * Helper to parse LLM response for title and description.
 * Assumes JSON format or a simple "Title: ...\nDescription: ..." format.
 * @param {string} llmResponseText
 * @returns {{title: string, description: string} | null}
 */
function parseLlmSuggestionResponse(llmResponseText) {
    if (!llmResponseText) return null;
    try {
        // First, try parsing as JSON (if LLM can be prompted to return JSON)
        const parsedAsJson = JSON.parse(llmResponseText);
        if (parsedAsJson.title && parsedAsJson.description) {
            return { title: parsedAsJson.title.trim(), description: parsedAsJson.description.trim() };
        }
    } catch (e) {
        // Not JSON, try parsing based on "Title:" and "Description:" keywords
        const titleMatch = llmResponseText.match(/Title:(.*?)Description:/is) || llmResponseText.match(/Título:(.*?)Descripción:/is);
        const descriptionMatch = llmResponseText.match(/Description:(.*)/is) || llmResponseText.match(/Descripción:(.*)/is);

        if (titleMatch && titleMatch[1] && descriptionMatch && descriptionMatch[1]) {
            return {
                title: titleMatch[1].trim(),
                description: descriptionMatch[1].trim()
            };
        }
        // Fallback if only title-like content is found
        const lines = llmResponseText.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length > 0) {
            return { title: lines[0], description: lines.slice(1).join(' ') || lines[0] }; // Use first line as title, rest as desc
        }
    }
    console.warn("(SuggestionService) Could not parse LLM response for suggestion:", llmResponseText);
    return null;
}


/**
 * Generates content gap suggestions based on unanswered or escalated queries.
 * @param {string} clientId - The client ID.
 */
export async function generateContentGapSuggestions(clientId) {
    console.log(`(SuggestionService) Starting content gap suggestion generation for client: ${clientId}`);
    let suggestionsCreated = 0;

    try {
        // 1. Fetch Unanswered/Escalated Queries (using existing function from databaseService)
        // These summaries already contain the user query and context of the event.
        const periodOptions = { period: '30d' }; // Look at last 30 days, can be configurable
        const unansweredQueries = await db.fetchUnansweredQueries(clientId, periodOptions, 50); // Fetch up to 50 to process

        if (!unansweredQueries || unansweredQueries.length === 0) {
            console.log(`(SuggestionService) No unanswered/escalated queries found for client ${clientId} in the period.`);
            return;
        }

        // Process distinct summaries (which contain the user query context)
        // fetchUnansweredQueries already groups by summary, so these are distinct user-facing issues.
        for (const queryData of unansweredQueries) {
            if (suggestionsCreated >= MAX_SUGGESTIONS_TO_CREATE_PER_RUN) {
                console.log("(SuggestionService) Reached max suggestions for this run (content gap).");
                break;
            }

            const userQueryText = queryData.summary; // The summary field contains "Bot cannot answer: [query]" or "Escalated: [query]"

            // Check if a similar "content_gap" suggestion (new status) already exists for this query/title
            // For simplicity, we'll generate title first then check. A more robust check would be semantic.

            // 2. Summarize and Suggest Topics (using LLM)
            const llmPrompt = `Basado en la siguiente consulta de usuario de un contexto de soporte técnico que no pudo ser respondida o fue escalada: "${userQueryText}". Genera un título conciso (máximo 10 palabras en español) para un nuevo artículo de FAQ o una sección de base de conocimiento que podría responder a esta consulta. Adicionalmente, escribe una breve descripción (1-2 frases en español) para esta sugerencia. Responde SÓLO con el título y la descripción, en el formato:
Título: [Tu título aquí]
Descripción: [Tu descripción aquí]`;

            const messages = [
                { role: "system", content: "Eres un asistente útil que ayuda a identificar temas para nuevo contenido de base de conocimiento." },
                { role: "user", content: llmPrompt }
            ];

            let suggestionDetails;
            try {
                const llmResponse = await getChatCompletion(messages, CHAT_COMPLETION_MODEL, 0.5);
                suggestionDetails = parseLlmSuggestionResponse(llmResponse);
            } catch (llmError) {
                console.error(`(SuggestionService) LLM error generating title/desc for query "${userQueryText}":`, llmError.message);
                continue; // Skip this query
            }

            if (!suggestionDetails || !suggestionDetails.title) {
                console.warn(`(SuggestionService) Could not generate valid title/desc from LLM for query: "${userQueryText}"`);
                continue;
            }

            // Check for existing similar 'new' suggestion by title
            const { data: existingSuggestions, error: checkError } = await supabase
                .from('knowledge_suggestions')
                .select('suggestion_id')
                .eq('client_id', clientId)
                .eq('title', suggestionDetails.title)
                .eq('type', 'content_gap')
                .in('status', ['new', 'reviewed_pending_action'])
                .limit(1);

            if (checkError) {
                console.error(`(SuggestionService) Error checking for existing suggestions:`, checkError.message);
                // Decide whether to proceed or skip; for now, proceed cautiously
            }

            if (existingSuggestions && existingSuggestions.length > 0) {
                console.log(`(SuggestionService) Similar 'content_gap' suggestion already exists for title: "${suggestionDetails.title}". Skipping.`);
                continue;
            }

            // 3. Store Suggestion
            const { error: insertError } = await supabase
                .from('knowledge_suggestions')
                .insert({
                    client_id: clientId,
                    type: 'content_gap',
                    title: suggestionDetails.title,
                    description: suggestionDetails.description,
                    source_queries: [userQueryText], // Store the summary from analytics as the source query
                    status: 'new'
                });

            if (insertError) {
                console.error(`(SuggestionService) DB Error inserting content gap suggestion for client ${clientId}:`, insertError.message);
            } else {
                console.log(`(SuggestionService) Content gap suggestion created for client ${clientId}: "${suggestionDetails.title}"`);
                suggestionsCreated++;
            }
        }
    } catch (error) {
        console.error(`(SuggestionService) Error in generateContentGapSuggestions for client ${clientId}:`, error.message, error.stack);
    }
}


/**
 * Generates FAQ suggestions based on escalated conversations that were resolved by agents.
 * @param {string} clientId - The client ID.
 */
export async function generateFaqSuggestionsFromEscalations(clientId) {
    console.log(`(SuggestionService) Starting FAQ suggestion generation from escalations for client: ${clientId}`);
    let suggestionsCreated = 0;

    try {
        // 1. Fetch Resolved Escalations
        // Need conversation_id, summary (for user query), escalation_timestamp
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: escalatedConvos, error: convoError } = await supabase
            .from('conversation_analytics')
            .select('conversation_id, summary, escalation_timestamp, first_message_at')
            .eq('client_id', clientId)
            .not('escalation_timestamp', 'is', null)
            .in('resolution_status', ['closed_by_agent', 'agent_replied']) // Consider convos where an agent intervened and closed/replied
            .gte('first_message_at', thirtyDaysAgo) // Limit to recent conversations
            .order('first_message_at', { ascending: false })
            .limit(20); // Process up to 20 recent relevant conversations

        if (convoError) {
            console.error(`(SuggestionService) Error fetching escalated convos for client ${clientId}:`, convoError.message);
            return;
        }
        if (!escalatedConvos || escalatedConvos.length === 0) {
            console.log(`(SuggestionService) No recently resolved escalated conversations found for FAQ generation for client ${clientId}.`);
            return;
        }

        for (const convo of escalatedConvos) {
            if (suggestionsCreated >= MAX_SUGGESTIONS_TO_CREATE_PER_RUN / 2) { // Lower limit for this type for now
                console.log("(SuggestionService) Reached max suggestions for this run (FAQ from escalation).");
                break;
            }

            // Extract last user query before escalation (approximate from summary)
            const summary = convo.summary || "";
            let lastUserQuery = summary;
            if (summary.includes("Escalated. Last user query:")) {
                lastUserQuery = summary.split("Escalated. Last user query:")[1]?.trim() || summary;
            } else if (summary.includes("Bot_cannot_answer. Last user query:")) {
                 lastUserQuery = summary.split("Bot_cannot_answer. Last user query:")[1]?.trim() || summary;
            }


            if (!lastUserQuery) continue;

            // Fetch first significant agent message after escalation_timestamp
            const { data: agentMessages, error: msgError } = await supabase
                .from('messages')
                .select('content')
                .eq('conversation_id', convo.conversation_id)
                .eq('sender', 'agent')
                .gt('timestamp', convo.escalation_timestamp) // Message sent after escalation
                .order('timestamp', { ascending: true })
                .limit(1);

            if (msgError || !agentMessages || agentMessages.length === 0) {
                console.warn(`(SuggestionService) No significant agent reply found after escalation for CV:${convo.conversation_id}. Skipping FAQ suggestion.`);
                continue;
            }
            const agentReplyContent = agentMessages[0].content;

            // Use LLM to generate FAQ title and description
            const llmPrompt = `Pregunta del usuario: "${lastUserQuery}"\nRespuesta del agente: "${agentReplyContent}"\n\nBasado en esta interacción, genera un título conciso (máximo 10 palabras en español) para una nueva FAQ. Además, escribe una breve descripción (1-2 frases en español) para esta sugerencia de FAQ. Responde SÓLO con el título y la descripción, en el formato:
Título: [Tu título aquí]
Descripción: [Tu descripción aquí]`;

            const messages = [
                { role: "system", content: "Eres un asistente útil que crea FAQs a partir de interacciones de soporte." },
                { role: "user", content: llmPrompt }
            ];

            let suggestionDetails;
            try {
                const llmResponse = await getChatCompletion(messages, CHAT_COMPLETION_MODEL, 0.5);
                suggestionDetails = parseLlmSuggestionResponse(llmResponse);
            } catch (llmError) {
                console.error(`(SuggestionService) LLM error generating FAQ for CV:${convo.conversation_id}:`, llmError.message);
                continue;
            }

            if (!suggestionDetails || !suggestionDetails.title) {
                console.warn(`(SuggestionService) Could not generate valid title/desc for FAQ from CV:${convo.conversation_id}`);
                continue;
            }

            // Check for existing similar 'new_faq_from_escalation' suggestion by title
             const { data: existingFaqSuggestions, error: checkFaqError } = await supabase
                .from('knowledge_suggestions')
                .select('suggestion_id')
                .eq('client_id', clientId)
                .eq('title', suggestionDetails.title)
                .eq('type', 'new_faq_from_escalation')
                .in('status', ['new', 'reviewed_pending_action'])
                .limit(1);

            if (checkFaqError) {
                console.error(`(SuggestionService) Error checking for existing FAQ suggestions:`, checkFaqError.message);
            }
            if (existingFaqSuggestions && existingFaqSuggestions.length > 0) {
                console.log(`(SuggestionService) Similar 'new_faq_from_escalation' suggestion already exists for title: "${suggestionDetails.title}". Skipping.`);
                continue;
            }

            // Store Suggestion
            const { error: insertError } = await supabase
                .from('knowledge_suggestions')
                .insert({
                    client_id: clientId,
                    type: 'new_faq_from_escalation',
                    title: suggestionDetails.title,
                    description: suggestionDetails.description,
                    source_queries: [lastUserQuery],
                    example_resolution: agentReplyContent,
                    status: 'new'
                });

            if (insertError) {
                console.error(`(SuggestionService) DB Error inserting FAQ suggestion for client ${clientId}, CV ${convo.conversation_id}:`, insertError.message);
            } else {
                console.log(`(SuggestionService) FAQ suggestion from escalation created for client ${clientId}: "${suggestionDetails.title}"`);
                suggestionsCreated++;
            }
        }

    } catch (error) {
        console.error(`(SuggestionService) Error in generateFaqSuggestionsFromEscalations for client ${clientId}:`, error.message, error.stack);
    }
}

// Placeholder for a function that might be called by a scheduler
// async function runForAllClients() {
//     const { data: clients, error } = await supabase.from('synchat_clients').select('client_id').eq('status', 'active'); // Example: only active clients
//     if (error) {
//         console.error("Error fetching clients:", error);
//         return;
//     }
//     for (const client of clients) {
//         await generateContentGapSuggestions(client.client_id);
//         await generateFaqSuggestionsFromEscalations(client.client_id);
//     }
// }
// runForAllClients();
