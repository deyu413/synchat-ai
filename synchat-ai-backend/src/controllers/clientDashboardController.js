// synchat-ai-backend/src/controllers/clientDashboardController.js
// Controller for handling client dashboard related API requests.

const supabase = require('../../services/supabaseClient'); // Adjusted path

// Placeholder for database service or Supabase client if needed later
// e.g., const db = require('../services/dbService'); // Or your Supabase client

/**
 * Retrieves the client's current configuration.
 */
const getClientConfig = async (req, res) => {
    console.log('clientDashboardController.getClientConfig called');
    const clientId = req.user?.client_id; // Assumes authMiddleware adds req.user with client_id

    if (!clientId) {
        // This case should ideally be caught by authMiddleware, but double-check.
        return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' });
    }

    try {
        const { data, error } = await supabase
            .from('synchat_clients')
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
const updateClientConfig = async (req, res) => {
    console.log('clientDashboardController.updateClientConfig called');
    const clientId = req.user?.client_id; // Assumes authMiddleware adds req.user with client_id

    if (!clientId) {
        return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' });
    }

    const { widget_config, knowledge_source_url } = req.body;

    // Basic validation: Check if at least one updatable field is provided
    if (widget_config === undefined && knowledge_source_url === undefined) {
        return res.status(400).json({ message: 'No valid fields provided for update. Provide widget_config or knowledge_source_url.' });
    }

    const updateData = {};
    if (widget_config !== undefined) {
        // Add further validation for widget_config structure if necessary
        updateData.widget_config = widget_config;
    }
    if (knowledge_source_url !== undefined) {
        // Add URL validation if necessary
        updateData.knowledge_source_url = knowledge_source_url;
    }
    // Ensure `updated_at` is handled by the database trigger if configured,
    // or manually set `updated_at: new Date().toISOString()` if not.
    // The synchat_clients migration includes a trigger for updated_at.

    try {
        const { data, error } = await supabase
            .from('synchat_clients')
            .update(updateData)
            .eq('client_id', clientId)
            .select('client_id, widget_config, knowledge_source_url, updated_at') // Return updated fields
            .single();

        if (error) {
            console.error('Error updating client config:', error.message);
            // Check for specific errors, e.g., RLS violation or record not found (though eq+single should handle not found)
            return res.status(500).json({ message: 'Error updating client configuration.', error: error.message });
        }
        
        if (!data) {
             // This might happen if RLS prevents update or client_id doesn't exist,
             // though .eq().single() on update might behave differently than select.
             // Supabase update returns data by default if select() is chained.
             // If data is null and no error, it might mean the row wasn't found or RLS denied.
            return res.status(404).json({ message: 'Client not found or update failed.' });
        }

        res.status(200).json({ message: 'Client configuration updated successfully.', data });
    } catch (err) {
        console.error('Unexpected error in updateClientConfig:', err.message);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

/**
 * Initiates a request to ingest knowledge from the client's configured source URL.
 */
const requestKnowledgeIngest = async (req, res) => {
    console.log('clientDashboardController.requestKnowledgeIngest called');
    const clientId = req.user?.client_id;

    if (!clientId) {
        return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' });
    }

    try {
        // 1. Fetch the client's saved knowledge_source_url
        const { data: clientData, error: fetchError } = await supabase
            .from('synchat_clients')
            .select('knowledge_source_url')
            .eq('client_id', clientId)
            .single();

        if (fetchError) {
            console.error('Error fetching client data for ingest:', fetchError.message);
            return res.status(500).json({ message: 'Error fetching client data.', error: fetchError.message });
        }

        if (!clientData || !clientData.knowledge_source_url) {
            return res.status(400).json({ message: 'No knowledge source URL configured for this client. Please set it up in your configuration.' });
        }

        const knowledge_source_url = clientData.knowledge_source_url;

        // 2. Update last_ingest_status to 'pending' and last_ingest_at
        const { error: updateError } = await supabase
            .from('synchat_clients')
            .update({ 
                last_ingest_status: 'pending',
                last_ingest_at: new Date().toISOString() 
            })
            .eq('client_id', clientId);

        if (updateError) {
            console.error('Error updating client ingest status:', updateError.message);
            return res.status(500).json({ message: 'Error updating client ingest status.', error: updateError.message });
        }

        // 3. (Conceptually) Trigger the actual ingestion process
        // This part will be fully implemented when ingestionService is built.
        // For now, we'll just log it.
        console.log(`Ingestion process would be started here for client ${clientId} with URL ${knowledge_source_url}`);
        // try {
        //    const ingestionService = require('../services/ingestionService'); // Assuming path
        //    await ingestionService.startIngestion(clientId, knowledge_source_url);
        // } catch (ingestionError) {
        //      console.error('Error calling ingestion service (conceptual):', ingestionError.message);
        //      // Note: Decouple this. The status is 'pending'. Actual ingestion failure
        //      // should be handled by the ingestion service updating the status later.
        // }

        res.status(202).json({ message: 'Knowledge ingestion request received and is being processed. Status set to pending.' });

    } catch (err) {
        console.error('Unexpected error in requestKnowledgeIngest:', err.message);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

/**
 * Retrieves client usage data, specifically AI resolution counts.
 * Optionally filters by `billing_cycle_id` if provided in query.
 * If no `billing_cycle_id` is provided, it counts all resolutions for the client.
 */
const getClientUsageResolutions = async (req, res) => {
    console.log('clientDashboardController.getClientUsageResolutions called');
    const clientId = req.user?.client_id; // Assumes authMiddleware adds req.user with client_id

    if (!clientId) {
        return res.status(401).json({ message: 'Unauthorized: Client ID not found in token.' });
    }

    const { billing_cycle_id } = req.query; // Optional query parameter

    try {
        let query = supabase
            .from('ia_resolutions_log')
            .select('*', { count: 'exact', head: true }) // Use head:true to only get the count
            .eq('client_id', clientId);

        if (billing_cycle_id) {
            query = query.eq('billing_cycle_id', billing_cycle_id);
        }

        const { count, error } = await query;

        if (error) {
            console.error('Error fetching client usage resolutions:', error.message);
            return res.status(500).json({ message: 'Error fetching client usage data.', error: error.message });
        }

        res.status(200).json({
            client_id: clientId,
            billing_cycle_id: billing_cycle_id || 'all_time', // Indicate if it's for a specific cycle or all
            resolution_count: count === null ? 0 : count, // Supabase count might be null if no records
        });

    } catch (err) {
        console.error('Unexpected error in getClientUsageResolutions:', err.message);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

module.exports = {
    getClientConfig,
    updateClientConfig,
    requestKnowledgeIngest,
    getClientUsageResolutions,
};
