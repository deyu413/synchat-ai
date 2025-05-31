import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Assuming databaseService and openaiService are set up to initialize their clients
// (e.g., Supabase client, OpenAI client) using environment variables.
import * as databaseService from '../services/databaseService.js';
import * as openaiService from '../services/openaiService.js';
// We will not import from chatController to keep this script more standalone for evaluation.
// We'll define simplified versions of necessary constants/prompts here.

// --- Configuration & Constants ---
const GOLDEN_DATASET_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden_dataset_es.json');
const CHAT_MODEL_FOR_EVAL = "gpt-3.5-turbo"; // Or your target model
const BOT_CANNOT_ANSWER_MSG_FOR_TEST = "Lo siento, no tengo información específica sobre eso en la base de datos de SynChat AI."; // Align with chatController

// Configuration for new metrics
const FAITHFULNESS_MODEL = "gpt-3.5-turbo";
const RELEVANCY_MODEL = "gpt-3.5-turbo";
const METRIC_LLM_TEMP = 0.2; // Low temperature for objective assessment
const METRIC_LLM_MAX_TOKENS = 10; // For YES/NO responses

// Simplified base system prompt for evaluation purposes
const SYSTEM_PROMPT_BASE_TEMPLATE = `Eres Zoe, el asistente virtual IA especializado de SynChat AI (synchatai.com). Tu ÚNICA fuente de información es el "Contexto" proporcionado a continuación. NO debes usar ningún conocimiento externo ni hacer suposiciones.

Instrucciones ESTRICTAS:
1.  Responde SOLAMENTE basándote en la información encontrada en el "Contexto". NO debes usar ningún conocimiento externo ni hacer suposiciones.
2.  Si la respuesta a la pregunta del usuario se encuentra en el "Contexto", respóndela de forma clara y concisa (máximo 3-4 frases).
3.  Si varios fragmentos del contexto responden a la pregunta del usuario, sintetiza la información en una respuesta única y coherente en español. No te limites a enumerar los fragmentos.
4.  Cuando utilices información de una fuente específica del contexto, menciónala de forma breve al final de tu respuesta de la siguiente manera: '(Fuente: [Nombre de la Fuente del Contexto])'. Por ejemplo: "La configuración se encuentra en el panel de administración (Fuente: Manual de Usuario Avanzado)."
5.  Si el contexto no contiene una respuesta clara, o si la información es contradictoria o ambigua, responde ÚNICA Y EXACTAMENTE con: "${BOT_CANNOT_ANSWER_MSG_FOR_TEST}" NO intentes adivinar ni buscar en otro lado.
6.  Sé amable y profesional.`;
// Examples from the original prompt are omitted here for brevity in this script's direct prompt construction,
// but could be added if desired for more complex evaluations.

/**
 * Loads the golden dataset from the JSON file.
 */
function loadGoldenDataset(filePath) {
    try {
        const rawData = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(rawData);
    } catch (error) {
        console.error(`Error loading golden dataset from ${filePath}:`, error);
        process.exit(1);
    }
}

/**
 * Constructs the RAG context string from retrieved chunks.
 */
function buildRagContextString(retrievedChunks) {
    if (!retrievedChunks || retrievedChunks.length === 0) {
        return "";
    }
    return retrievedChunks
        .map(chunk => {
            const sourceInfo = chunk.metadata?.hierarchy?.map(h => h.text).join(" > ") || chunk.metadata?.url || chunk.metadata?.source_name || 'Fuente Desconocida';
            const prefix = `Fuente: ${sourceInfo}\n`;
            return `${prefix}Contenido: ${chunk.content}`;
        })
        .join("\n\n---\n\n");
}

/**
 * Main function to run the RAG evaluation.
 */
async function runEvaluation() {
    console.log("--- Starting RAG Evaluation Script ---");
    const goldenDataset = loadGoldenDataset(GOLDEN_DATASET_PATH);
    const evaluationResults = [];

    // Ensure services are initialized (this depends on how services handle their init)
    // For this script, we assume they initialize correctly when their functions are called,
    // relying on environment variables for API keys etc.
    // If specific init functions were needed, they'd be called here.

    for (const testCase of goldenDataset) {
        console.log(`\n--- Running Test: ${testCase.test_id} ---`);
        console.log(`Query: ${testCase.query}`);

        let llm_response = "ERROR: LLM call not made or failed.";
        let keywordsCheckPassed = false;
        let retrievedChunksForLog = [];
        let ragContextStringForTest = "";
        let systemPromptForTest = "";

        try {
            // a. Simulate RAG Call (Simplified)
            // Assuming hybridSearch expects (clientId, queryText, conversationId, options)
            // conversationId can be null for evaluation if not used by search logic itself for filtering.
            const hybridSearchResult = await databaseService.hybridSearch(
                testCase.client_id_for_test,
                testCase.query,
                null, // conversationId - not strictly needed for a single query eval
                {}    // options - use defaults
            );

            // The hybridSearch now returns { results, searchParams, queriesEmbedded, rawRankedResultsForLog }
            const retrievedChunks = hybridSearchResult.results || []; // Use the final top N results
            retrievedChunksForLog = retrievedChunks.slice(0, 5).map(chunk => ({ // Log top 5 for brevity
                id: chunk.id,
                preview: chunk.content.substring(0, 100) + "...",
                score: chunk.reranked_score !== undefined ? chunk.reranked_score : chunk.hybrid_score, // Use reranked if available
                source: chunk.metadata?.hierarchy?.map(h => h.text).join(" > ") || chunk.metadata?.url || chunk.metadata?.source_name || 'N/A'
            }));

            console.log(`Retrieved context chunks: ${retrievedChunks.length}`);
            retrievedChunksForLog.forEach(chunk =>
                console.log(`  - Chunk ID: ${chunk.id}, Preview: "${chunk.preview}", Score: ${chunk.score?.toFixed(4)}, Source: ${chunk.source}`)
            );

            ragContextStringForTest = buildRagContextString(retrievedChunks);

            systemPromptForTest = SYSTEM_PROMPT_BASE_TEMPLATE +
                (ragContextStringForTest ? `\n\n--- Contexto ---\n${ragContextStringForTest}\n--- Fin del Contexto ---` : '\n\n(No se encontró contexto relevante para esta pregunta)');

            const messagesForAPI = [
                { role: "system", content: systemPromptForTest },
                { role: "user", content: testCase.query }
            ];

            // Call LLM
            // Note: openaiService.getChatCompletion returns the text content directly or null
            const rawLlmResponse = await openaiService.getChatCompletion(messagesForAPI, CHAT_MODEL_FOR_EVAL);
            llm_response = rawLlmResponse || "ERROR: LLM returned null or empty.";
            console.log(`LLM Response: ${llm_response}`);

            // b. Perform Basic Automated Checks
            if (llm_response && !llm_response.startsWith("ERROR:")) {
                keywordsCheckPassed = true; // Assume pass unless a keyword is missing
                for (const keyword of testCase.expected_keywords_in_answer) {
                    if (!llm_response.toLowerCase().includes(keyword.toLowerCase())) {
                        keywordsCheckPassed = false;
                        console.log(`  MISSING Keyword: ${keyword}`);
                        break;
                    }
                }
            }
            console.log(`Expected Keywords Check: ${keywordsCheckPassed ? 'PASS' : 'FAIL'}`);

        } catch (error) {
            console.error(`Error during test case ${testCase.test_id}:`, error);
            llm_response = `ERROR: ${error.message}`;
            keywordsCheckPassed = false;
        }

        // --- Faithfulness Check ---
        let faithfulness_check = "N/A";
        if (llm_response && !llm_response.startsWith("ERROR:")) {
            try {
                const faithfulnessPrompt = `Given this context: "${ragContextStringForTest}"

And this answer: "${llm_response}"

Is the answer fully supported by the context and free of hallucinated information not present in the context? Respond with only 'YES' or 'NO'.`;
                const faithfulnessMessages = [
                    { role: "system", content: "You are an AI evaluator. Respond only with YES or NO." },
                    { role: "user", content: faithfulnessPrompt }
                ];
                const ff_res = await openaiService.getChatCompletion(faithfulnessMessages, FAITHFULNESS_MODEL, METRIC_LLM_TEMP, METRIC_LLM_MAX_TOKENS);
                faithfulness_check = ff_res?.trim().toUpperCase() || "NO_RESPONSE";
                console.log(`Faithfulness Check: ${faithfulness_check}`);
            } catch (e) {
                console.error(`Faithfulness check error for test ${testCase.test_id}:`, e.message);
                faithfulness_check = "ERROR_FAITHFULNESS";
            }
        } else {
            faithfulness_check = "N/A (LLM error)";
        }

        // --- Answer Relevancy Check ---
        let answer_relevancy_check = "N/A";
        if (llm_response && !llm_response.startsWith("ERROR:")) {
            try {
                const relevancyPrompt = `Given this user question: "${testCase.query}"

And this answer: "${llm_response}"

Is the answer relevant to the question? Respond with only 'YES' or 'NO'.`;
                const relevancyMessages = [
                    { role: "system", content: "You are an AI evaluator. Respond only with YES or NO." },
                    { role: "user", content: relevancyPrompt }
                ];
                const ar_res = await openaiService.getChatCompletion(relevancyMessages, RELEVANCY_MODEL, METRIC_LLM_TEMP, METRIC_LLM_MAX_TOKENS);
                answer_relevancy_check = ar_res?.trim().toUpperCase() || "NO_RESPONSE";
                console.log(`Answer Relevancy Check: ${answer_relevancy_check}`);
            } catch (e) {
                console.error(`Answer relevancy check error for test ${testCase.test_id}:`, e.message);
                answer_relevancy_check = "ERROR_RELEVANCY";
            }
        } else {
            answer_relevancy_check = "N/A (LLM error)";
        }

        evaluationResults.push({
            test_id: testCase.test_id,
            query: testCase.query,
            expected_keywords: testCase.expected_keywords_in_answer,
            retrieved_chunks_preview: retrievedChunksForLog,
            system_prompt_length_chars: systemPromptForTest.length,
            rag_context_length_chars: ragContextStringForTest.length,
            llm_response: llm_response,
            keywords_check: keywordsCheckPassed ? 'PASS' : 'FAIL',
            faithfulness_check: faithfulness_check,
            answer_relevancy_check: answer_relevancy_check
        });
    }

    // c. Output Results Summary
    console.log("\n\n--- Evaluation Summary ---");
    evaluationResults.forEach(result => {
        console.log(
            `Test ID: ${result.test_id} | Query: "${result.query.substring(0,30)}..." | Keywords: ${result.keywords_check} | Faithfulness: ${result.faithfulness_check} | Relevancy: ${result.answer_relevancy_check}`
        );
    });

    const passedKeywordsCount = evaluationResults.filter(r => r.keywords_check === 'PASS').length;
    const passedFaithfulnessCount = evaluationResults.filter(r => r.faithfulness_check === 'YES').length;
    const passedAnswerRelevancyCount = evaluationResults.filter(r => r.answer_relevancy_check === 'YES').length;

    console.log(`\nTotal Tests: ${evaluationResults.length}`);
    console.log(`Passed Keyword Checks: ${passedKeywordsCount} (${((passedKeywordsCount/evaluationResults.length)*100).toFixed(2)}%)`);
    console.log(`Passed Faithfulness Checks (YES): ${passedFaithfulnessCount} (${((passedFaithfulnessCount/evaluationResults.length)*100).toFixed(2)}%)`);
    console.log(`Passed Answer Relevancy Checks (YES): ${passedAnswerRelevancyCount} (${((passedAnswerRelevancyCount/evaluationResults.length)*100).toFixed(2)}%)`);
    // Optionally write detailed results to a file
    const reportPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evaluation_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(evaluationResults, null, 2), 'utf-8');
    console.log(`\nDetailed report written to: ${reportPath}`);

    console.log("\n--- Evaluation Script Finished ---");
}

// Run the evaluation
runEvaluation().catch(error => {
    console.error("Unhandled error during RAG evaluation:", error);
    process.exit(1);
});
