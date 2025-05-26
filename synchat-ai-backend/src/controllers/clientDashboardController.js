// synchat-ai-backend/src/controllers/clientDashboardController.js
// Controller for handling client dashboard related API requests.

// Corrected import paths from ../../services/ to ../services/
import { supabase } from '../services/supabaseClient.js';
import { ingestWebsite } from '../services/ingestionService.js';

// Placeholder for database service or Supabase client if needed later
// e.g., const db = require('../services/dbService'); // Or your Supabase client

/**
 * Retrieves the client's current configuration.
 */
export const getClientConfig = async (req, res) => {
    console.log('clientDashboardController.getClientConfig called');
    const clientId = req.user?.id; // Consistent with authMiddleware (Supabase user ID)

    if (!clientId) {
        // This case should ideally be caught by authMiddleware, but double-check.
        return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' });
    }

    try {
        const { data, error } = await supabase
            .from('synchat_clients') // Assuming 'client_id' in this table is the Supabase user ID
            .select('client_name, email, widget_config, knowledge_source_url, last_ingest_status, last_ingest_at')
            .eq('client_id', clientId)
            .single();

        if (error) {
            console.error('Error fetching client config:', error.message);
            return res.status(500).json({ message: 'Error fetching client configuration.', error: error.message });
        }

        if (!data) {
            return res.status(404).json({ message: 'Client configuration not found.' });
        }

        res.status(200).json(data);
    } catch (err) {
        console.error('Unexpected error in getClientConfig:', err.message);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

/**
 * Updates the client's configuration for widget_config and knowledge_source_url.
 */
export const updateClientConfig = async (req, res) => {
    console.log('clientDashboardController.updateClientConfig called');
    const clientId = req.user?.id; // Consistent with authMiddleware

    if (!clientId) {
        return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' });
    }

    const { widget_config: newWidgetConfigData, knowledge_source_url } = req.body;

    // Basic validation: Check if at least one updatable field is provided
    if (newWidgetConfigData === undefined && knowledge_source_url === undefined) {
        return res.status(400).json({ message: 'No valid fields provided for update. Provide widget_config or knowledge_source_url.' });
    }

    const updateFields = {};

    try {
        // Handle widget_config update (if newWidgetConfigData is provided and is an object)
        if (newWidgetConfigData !== undefined) {
            if (typeof newWidgetConfigData !== 'object' || newWidgetConfigData === null) {
                return res.status(400).json({ message: 'Invalid widget_config format. It must be an object.' });
            }

            let currentWidgetConfig = {};
            const { data: clientRecord, error: fetchError } = await supabase
                .from('synchat_clients')
                .select('widget_config')
                .eq('client_id', clientId)
                .single();

            if (fetchError) {
                console.error('Error fetching current widget_config:', fetchError.message);
                // PGRST116: "The result contains 0 rows" - this is not an error if client exists but has no widget_config yet
                if (fetchError.code !== 'PGRST116') { 
                     return res.status(500).json({ message: 'Error fetching current configuration for update.', error: fetchError.message });
                }
            }
            currentWidgetConfig = clientRecord?.widget_config || {};
            
            const mergedWidgetConfig = { ...currentWidgetConfig, ...newWidgetConfigData };
            updateFields.widget_config = mergedWidgetConfig;
        }

        // Handle knowledge_source_url update
        if (knowledge_source_url !== undefined) {
            // Basic URL validation (optional, but good practice)
            try {
                if (knowledge_source_url !== '') { // Allow empty string to clear the URL
                    new URL(knowledge_source_url);
                }
            } catch (urlError) {
                return res.status(400).json({ message: 'Invalid knowledge_source_url format.' });
            }
            updateFields.knowledge_source_url = knowledge_source_url;
        }

        // If no fields were actually prepared for update (e.g., only undefined values were passed for updatable fields)
        if (Object.keys(updateFields).length === 0) {
            // Optionally, fetch and return current data if no update is made, or just a message.
            // For this task, we'll return a message indicating no update was performed.
            // However, the initial check for both being undefined should catch most of this.
            // This check is more for if widget_config was passed as undefined and knowledge_source_url was also undefined.
            return res.status(200).json({ message: 'No new data provided to update.' });
        }
        
        // updated_at is handled by the database trigger

        const { data, error } = await supabase
            .from('synchat_clients')
            .update(updateFields)
            .eq('client_id', clientId)
            .select('client_id, widget_config, knowledge_source_url, updated_at') // Return updated fields
            .single();

        if (error) {
            console.error('Error updating client config:', error.message);
            return res.status(500).json({ message: 'Error updating client configuration.', error: error.message });
        }
        
        if (!data) {
            // This case might happen if the clientId is valid but somehow the update affects 0 rows.
            // Or if RLS prevents the select after update.
            return res.status(404).json({ message: 'Client not found or update failed to return data.' });
        }

        res.status(200).json({ message: 'Client configuration updated successfully.', data });
    } catch (err) {
        console.error('Unexpected error in updateClientConfig:', err.message, err.stack);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

/**
 * Initiates a request to ingest knowledge from the client's configured source URL.
 */
export const requestKnowledgeIngest = async (req, res) => {
    console.log('clientDashboardController.requestKnowledgeIngest called');
    const clientId = req.user?.id; // Consistent with authMiddleware

    if (!clientId) {
        return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' });
    }

    try {
        // 1. Fetch the client's saved knowledge_source_url
        const { data: clientData, error: fetchError } = await supabase
            .from('synchat_clients')
            .select('knowledge_source_url')
            .eq('client_id', clientId) // Assuming 'client_id' in this table is the Supabase user ID
            .single();

        if (fetchError) {
            console.error('Error fetching client data for ingest:', fetchError.message);
            return res.status(500).json({ message: 'Error fetching client data.', error: fetchError.message });
        }

        if (!clientData || !clientData.knowledge_source_url) {
            return res.status(400).json({ message: 'No knowledge source URL configured for this client. Please set it up in your configuration.' });
        }

        const knowledge_source_url = clientData.knowledge_source_url;

        // Call ingestWebsite in a non-blocking way
        ingestWebsite(clientId, knowledge_source_url)
            .then(result => {
                if (result.success) {
                    console.log(`Ingestion completed successfully for client ${clientId}. Details:`, result.data);
                    // For this task, only logging. Actual status update ('completed'/'failed')
                    // would ideally be handled by the service or a robust job queue.
                } else {
                    console.error(`Ingestion failed for client ${clientId}. Error:`, result.error);
                }
            })
            .catch(error => {
                console.error(`Critical error during background ingestion for client ${clientId}:`, error);
            });

        // 2. Update last_ingest_status to 'pending' and last_ingest_at
        // This indicates the request has been accepted and is being processed (by the background task)
        const { error: updateError } = await supabase
            .from('synchat_clients')
            .update({ 
                last_ingest_status: 'pending',
                last_ingest_at: new Date().toISOString() 
            })
            .eq('client_id', clientId); // Assuming 'client_id' in this table is the Supabase user ID

        if (updateError) {
            console.error('Error updating client ingest status:', updateError.message);
            // Note: If this update fails, the ingestion is still triggered in the background.
            // Consider how to handle this inconsistency if critical. For MVP, logging is okay.
            // The ingestWebsite service itself will attempt to update to 'completed' or 'failed'.
        }

        // 3. (Conceptually) Trigger the actual ingestion process
        // The actual call to ingestionService (ingestWebsite) is done above and runs asynchronously.
        console.log(`Ingestion process initiated for client ${clientId} with URL ${knowledge_source_url}`);
        

        res.status(202).json({ message: 'Knowledge ingestion request received and is being processed. Status set to pending.' });

    } catch (err) {
        console.error('Unexpected error in requestKnowledgeIngest:', err.message, err.stack);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};


/**
 * Retrieves client usage data, specifically AI resolution counts.
 * Defaults to the current month's statistics if no `billing_cycle_id` is provided.
 */
export const getClientUsageResolutions = async (req, res) => {
    console.log('clientDashboardController.getClientUsageResolutions called');
    const clientId = req.user?.id; // Changed from req.user?.client_id to req.user.id based on authMiddleware

    if (!clientId) {
        return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' });
    }

    let { billing_cycle_id } = req.query; // Optional query parameter

    // If no billing_cycle_id is provided, default to the current month in 'YYYY-MM' format
    if (!billing_cycle_id) {
        const now = new Date();
        const year = now.getFullYear();
        const month = (now.getMonth() + 1).toString().padStart(2, '0'); // JavaScript months are 0-indexed
        billing_cycle_id = `${year}-${month}`;
        console.log(`No billing_cycle_id provided, defaulting to current month: ${billing_cycle_id}`);
    }

    try {
        let query = supabase
            .from('ia_resolutions_log')
            .select('*', { count: 'exact', head: true }) // Using head:true for count only
            .eq('client_id', clientId) 
            .eq('billing_cycle_id', billing_cycle_id); 

        const { count, error } = await query;

        if (error) {
            console.error('Error fetching client usage resolutions:', error.message);
            return res.status(500).json({ message: 'Error fetching client usage data.', error: error.message });
        }

        const resolutionCount = count === null ? 0 : count;

        res.status(200).json({
            client_id: clientId,
            billing_cycle_id: billing_cycle_id,
            ai_resolutions_current_month: resolutionCount, 
            total_queries_current_month: 'N/A' // Placeholder as per plan
        });

    } catch (err) {
        console.error('Unexpected error in getClientUsageResolutions:', err.message, err.stack);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};
