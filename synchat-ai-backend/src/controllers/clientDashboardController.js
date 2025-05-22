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
 * Initiates a request to ingest knowledge from a specified source.
 * (Placeholder implementation)
 */
const requestKnowledgeIngest = async (req, res) => {
    console.log('clientDashboardController.requestKnowledgeIngest called');
    // TODO: Logic to be implemented in a later task.
    // Example:
    // const clientId = req.user?.client_id;
    // const { knowledge_source_url } = req.body; // Could also come from client's saved config
    // if (!clientId) {
    //     return res.status(401).json({ message: 'Unauthorized: Client ID missing.' });
    // }
    // if (!knowledge_source_url) {
    //     return res.status(400).json({ message: 'Knowledge source URL is required.' });
    // }
    // await someService.startIngestionProcess(clientId, knowledge_source_url);
    // res.status(202).json({ message: 'Knowledge ingestion request received and is being processed.' });
    res.status(501).json({ message: 'Request knowledge ingest not implemented yet.' });
};

/**
 * Retrieves client usage data, specifically AI resolution counts, possibly filtered by billing cycle.
 * (Placeholder implementation)
 */
const getClientUsageResolutions = async (req, res) => {
    console.log('clientDashboardController.getClientUsageResolutions called');
    // TODO: Logic to be implemented in a later task.
    // Example:
    // const clientId = req.user?.client_id;
    // const { billing_cycle_id } = req.query; // Or determine current/default cycle
    // if (!clientId) {
    //     return res.status(401).json({ message: 'Unauthorized: Client ID missing.' });
    // }
    // const usageData = await someService.fetchUsageResolutions(clientId, billing_cycle_id);
    // res.status(200).json(usageData);
    res.status(501).json({ message: 'Get client usage resolutions not implemented yet.' });
};

module.exports = {
    getClientConfig,
    updateClientConfig,
    requestKnowledgeIngest,
    getClientUsageResolutions,
};
