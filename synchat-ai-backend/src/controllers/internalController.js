// src/controllers/internalController.js
import * as knowledgeSuggestionService from '../services/knowledgeSuggestionService.js';
import * as db from '../services/databaseService.js';

/**
 * Triggers suggestion generation for all active clients.
 * This is intended to be called by a secured internal scheduler (e.g., an Edge Function).
 */
export const triggerAllClientsSuggestionGeneration = async (req, res) => {
    console.log("(InternalCtrl) Received request to trigger suggestion generation for all clients.");

    try {
        const activeClientIds = await db.getAllActiveClientIds();

        if (!activeClientIds || activeClientIds.length === 0) {
            console.log("(InternalCtrl) No active clients found to process for suggestions.");
            return res.status(200).json({ message: "No active clients to process." });
        }

        console.log(`(InternalCtrl) Found ${activeClientIds.length} active clients. Initiating suggestion generation for each.`);

        // Asynchronously trigger generation for all clients.
        // We don't await all promises here to make the HTTP request return quickly.
        // The actual generation happens in the background.
        const generationPromises = activeClientIds.map(clientId => {
            return Promise.allSettled([
                knowledgeSuggestionService.generateContentGapSuggestions(clientId)
                    .then(() => console.log(`(InternalCtrl) Content gap suggestions processed for client ${clientId}.`))
                    .catch(err => console.error(`(InternalCtrl) Error in content gap suggestions for client ${clientId}:`, err.message)),
                knowledgeSuggestionService.generateFaqSuggestionsFromEscalations(clientId)
                    .then(() => console.log(`(InternalCtrl) FAQ from escalation suggestions processed for client ${clientId}.`))
                    .catch(err => console.error(`(InternalCtrl) Error in FAQ from escalation suggestions for client ${clientId}:`, err.message))
            ]);
        });

        // Optional: Log all promises once they settle if you need a summary after all attempts.
        // This part will run after the HTTP response has been sent.
        Promise.allSettled(generationPromises)
            .then(results => {
                console.log("(InternalCtrl) All client suggestion generation triggers have been processed (settled).");
                results.forEach((clientResult, index) => {
                    const clientId = activeClientIds[index];
                    if (clientResult.status === 'fulfilled') {
                        // clientResult.value is an array of two Promise.allSettled results
                        clientResult.value.forEach(opResult => {
                             if (opResult.status === 'rejected') {
                                console.error(`(InternalCtrl) Background processing error for client ${clientId} (one of the suggestion types):`, opResult.reason);
                            }
                        });
                    } else {
                        console.error(`(InternalCtrl) Major error triggering processing for client ${clientId}:`, clientResult.reason);
                    }
                });
            });


        res.status(202).json({
            message: `Suggestion generation process initiated for ${activeClientIds.length} active clients. Completion and any errors will be logged separately by the services.`
        });

    } catch (error) {
        console.error("(InternalCtrl) Critical error fetching client IDs or initiating suggestion generation:", error);
        res.status(500).json({ message: "Failed to initiate suggestion generation due to an internal error." });
    }
};
