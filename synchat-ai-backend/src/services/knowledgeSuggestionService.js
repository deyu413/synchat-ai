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
                console.error(`(SuggestionService) Error checking for existing suggestions for title "${suggestionDetails.title}":`, checkError.message);
                // Skip this queryData if the check failed, to avoid potential duplicates or errors.
                continue;
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
                console.error(`(SuggestionService) Error checking for existing FAQ suggestions for title "${suggestionDetails.title}":`, checkFaqError.message);
                // Skip this convo if the check failed, to avoid potential duplicates or errors.
                continue;
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

export async function analyzeAndFlagProblematicChunks(clientId, options = {}) {
    const NEGATIVE_RATING_THRESHOLD = options.negativeRatingThreshold || 3; // e.g., > 2 negative ratings
    const NEGATIVE_TO_POSITIVE_RATIO_THRESHOLD = options.negativeToPositiveRatioThreshold || 2; // e.g., neg:pos > 2:1
    const MAX_COMMENTS_TO_STORE = 3;

    console.log(`(SuggestionService) Starting chunk feedback analysis for client: ${clientId}`);

    let suggestionsCreated = 0;
    const MAX_SUGGESTIONS_PER_RUN_FEEDBACK = options.maxSuggestionsPerRun || 10; // Similar to other suggestion functions

    try {
        // 1. Fetch recent feedback entries
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // Process feedback from last 30 days for relevance
        const { data: feedbacks, error: feedbackError } = await supabase
            .from('rag_feedback_log')
            .select('knowledge_base_chunk_id, rating, comment, client_id')
            .eq('client_id', clientId)
            .eq('feedback_type', 'chunk_relevance') // Focus on chunk_relevance
            .not('knowledge_base_chunk_id', 'is', null)
            .gte('created_at', thirtyDaysAgo); // Process recent feedback

        if (feedbackError) {
            console.error(`(SuggestionService) Error fetching chunk feedback for client ${clientId}:`, feedbackError.message);
            return { suggestionsCreated: 0, error: feedbackError.message };
        }

        if (!feedbacks || feedbacks.length === 0) {
            console.log(`(SuggestionService) No recent chunk relevance feedback found for client ${clientId}.`);
            return { suggestionsCreated: 0, error: null };
        }

        // 2. Aggregate feedback per knowledge_base_chunk_id
        const chunkFeedbackStats = feedbacks.reduce((acc, fb) => {
            const chunkId = fb.knowledge_base_chunk_id;
            if (!acc[chunkId]) {
                acc[chunkId] = { positive: 0, negative: 0, comments: [], client_id: fb.client_id };
            }
            if (fb.rating === 1) {
                acc[chunkId].positive++;
            } else if (fb.rating === -1) {
                acc[chunkId].negative++;
            }
            // Only store recent, non-empty comments
            if (fb.comment && fb.comment.trim() !== "" && acc[chunkId].comments.length < MAX_COMMENTS_TO_STORE) {
                acc[chunkId].comments.push(fb.comment.trim());
            }
            return acc;
        }, {});

        // 3. Flagging Logic & Action
        for (const chunkIdStr in chunkFeedbackStats) {
            if (suggestionsCreated >= MAX_SUGGESTIONS_PER_RUN_FEEDBACK) {
                console.log(`(SuggestionService) Reached max suggestions for this run (chunk feedback).`);
                break;
            }

            const chunkId = parseInt(chunkIdStr, 10); // Ensure chunkId is a number if it's stored as such
            if (isNaN(chunkId)) {
                console.warn(`(SuggestionService) Invalid chunkId found: ${chunkIdStr}. Skipping.`);
                continue;
            }

            const stats = chunkFeedbackStats[chunkIdStr];

            const meetsNegativeThreshold = stats.negative >= NEGATIVE_RATING_THRESHOLD;
            const meetsRatioThreshold = stats.positive === 0 || (stats.negative / stats.positive) >= NEGATIVE_TO_POSITIVE_RATIO_THRESHOLD;

            if (meetsNegativeThreshold && meetsRatioThreshold) {
                console.log(`(SuggestionService) Chunk ID ${chunkId} flagged for review. Neg: ${stats.negative}, Pos: ${stats.positive}`);

                // Fetch original_source_id from knowledge_base metadata
                let originalSourceId = null;
                let chunkContentPreview = 'N/A';
                try {
                    const { data: chunkData, error: chunkError } = await supabase
                        .from('knowledge_base')
                        .select('metadata, content')
                        .eq('id', chunkId)
                        .eq('client_id', clientId) // Ensure client owns the chunk
                        .single();

                    if (chunkError) {
                        console.error(`(SuggestionService) Error fetching chunk metadata for chunk ${chunkId}:`, chunkError.message);
                        // Continue, but related_knowledge_source_ids might be empty
                    } else if (chunkData) {
                        originalSourceId = chunkData.metadata?.original_source_id;
                        chunkContentPreview = chunkData.content ? chunkData.content.substring(0, 100) + '...' : 'N/A';
                    }
                } catch (e) {
                    console.error(`(SuggestionService) Exception fetching chunk metadata for ${chunkId}:`, e.message);
                }

                const suggestionTitle = `Chunk ID ${chunkId} needs review (Neg: ${stats.negative}, Pos: ${stats.positive})`;
                const suggestionDescription = `Chunk (Preview: "${chunkContentPreview}") has received ${stats.negative} negative and ${stats.positive} positive ratings. Review for relevance/accuracy. Sample comments: ${stats.comments.join('; ')}`;

                // Check for existing 'new' or 'reviewed_pending_action' suggestion for this chunk
                const { data: existingSuggestion, error: checkError } = await supabase
                    .from('knowledge_suggestions')
                    .select('suggestion_id')
                    .eq('client_id', clientId)
                    .eq('type', 'chunk_needs_review')
                    // .eq('related_chunk_ids', [chunkId]) // This might not work directly if related_chunk_ids is an array.
                                                        // We might need to query if array contains chunkId: .contains('related_chunk_ids', [chunkId])
                                                        // For simplicity, check title or a specific field if chunkId is directly on suggestion.
                                                        // Let's assume for now we simplify and check based on title or a dedicated chunk_id field if added later.
                                                        // For now, a simpler check on title to avoid over-complicating without DB schema change.
                    .eq('title', suggestionTitle) // This is a proxy, ideally check if a suggestion for this chunkId already exists.
                    .in('status', ['new', 'reviewed_pending_action'])
                    .limit(1);

                if (checkError) {
                    console.error(`(SuggestionService) Error checking for existing 'chunk_needs_review' suggestion for chunk ${chunkId}:`, checkError.message);
                    continue; // Skip if check fails
                }

                if (existingSuggestion && existingSuggestion.length > 0) {
                    console.log(`(SuggestionService) 'chunk_needs_review' suggestion already exists for chunk ${chunkId} with similar title. Skipping.`);
                    continue;
                }

                const insertPayload = {
                    client_id: clientId,
                    type: 'chunk_needs_review',
                    title: suggestionTitle,
                    description: suggestionDescription,
                    related_knowledge_source_ids: originalSourceId ? [originalSourceId] : [],
                    related_chunk_id: chunkId, // Store the flagged chunk ID (singular)
                    status: 'new',
                    // source_queries: stats.comments, // Optionally store comments here if useful
                };

                const { error: insertError } = await supabase
                    .from('knowledge_suggestions')
                    .insert(insertPayload);

                if (insertError) {
                    console.error(`(SuggestionService) DB Error inserting 'chunk_needs_review' suggestion for chunk ${chunkId}:`, insertError.message);
                } else {
                    console.log(`(SuggestionService) 'chunk_needs_review' suggestion created for chunk ID ${chunkId}.`);
                    suggestionsCreated++;
                }

                // Option 2: Update knowledge_base metadata (Example, commented out as per plan)
                /*
                if (chunkData) { // From the fetch earlier
                    const newMetadata = {
                        ...(chunkData.metadata || {}),
                        review_needed: true,
                        last_feedback_analysis_at: new Date().toISOString(),
                        quality_score_adjustment: (chunkData.metadata?.quality_score_adjustment || 0) - 1 // Example adjustment
                    };
                    const { error: updateKbError } = await supabase
                        .from('knowledge_base')
                        .update({ metadata: newMetadata })
                        .eq('id', chunkId)
                        .eq('client_id', clientId);
                    if (updateKbError) {
                        console.error(`(SuggestionService) Error updating knowledge_base metadata for chunk ${chunkId}:`, updateKbError.message);
                    } else {
                        console.log(`(SuggestionService) Metadata updated for chunk ${chunkId} to mark for review.`);
                    }
                }
                */
            }
        }
        console.log(`(SuggestionService) Chunk feedback analysis complete for client ${clientId}. Suggestions created: ${suggestionsCreated}`);
        return { suggestionsCreated, error: null };

    } catch (error) {
        console.error(`(SuggestionService) General error in analyzeAndFlagProblematicChunks for client ${clientId}:`, error.message, error.stack);
        return { suggestionsCreated: 0, error: error.message };
    }
}
