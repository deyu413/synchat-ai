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
const updateClientConfig = async (req, res) => {
    console.log('clientDashboardController.updateClientConfig called');
    const clientId = req.user?.id; // Consistent with authMiddleware

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
        updateData.widget_config = widget_config;
    }
    if (knowledge_source_url !== undefined) {
        updateData.knowledge_source_url = knowledge_source_url;
    }
    // updated_at is handled by the database trigger

    try {
        const { data, error } = await supabase
            .from('synchat_clients')
            .update(updateData)
            .eq('client_id', clientId) // Assuming 'client_id' in this table is the Supabase user ID
            .select('client_id, widget_config, knowledge_source_url, updated_at') // Return updated fields
            .single();

        if (error) {
            console.error('Error updating client config:', error.message);
            return res.status(500).json({ message: 'Error updating client configuration.', error: error.message });
        }
        
        if (!data) {
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

        // 2. Update last_ingest_status to 'pending' and last_ingest_at
        const { error: updateError } = await supabase
            .from('synchat_clients')
            .update({ 
                last_ingest_status: 'pending',
                last_ingest_at: new Date().toISOString() 
            })
            .eq('client_id', clientId); // Assuming 'client_id' in this table is the Supabase user ID

        if (updateError) {
            console.error('Error updating client ingest status:', updateError.message);
            return res.status(500).json({ message: 'Error updating client ingest status.', error: updateError.message });
        }

        // 3. (Conceptually) Trigger the actual ingestion process
        console.log(`Ingestion process would be started here for client ${clientId} with URL ${knowledge_source_url}`);
        // Actual call to ingestionService would happen here, likely asynchronously

        res.status(202).json({ message: 'Knowledge ingestion request received and is being processed. Status set to pending.' });

    } catch (err) {
        console.error('Unexpected error in requestKnowledgeIngest:', err.message);
        res.status(500).json({ message: 'An unexpected error occurred.', error: err.message });
    }
};

/**
 * Retrieves client usage data, specifically AI resolution counts.
 * Defaults to the current month's statistics if no `billing_cycle_id` is provided.
 */
const getClientUsageResolutions = async (req, res) => {
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
            .select('*', { count: 'exact', head: true })
            .eq('client_id', clientId) // Assuming 'client_id' in this table is the Supabase user ID
            .eq('billing_cycle_id', billing_cycle_id); // Always filter by a billing_cycle_id

        const { count, error } = await query;

        if (error) {
            console.error('Error fetching client usage resolutions:', error.message);
            return res.status(500).json({ message: 'Error fetching client usage data.', error: error.message });
        }

        const resolutionCount = count === null ? 0 : count;

        res.status(200).json({
            client_id: clientId,
            billing_cycle_id: billing_cycle_id,
            ai_resolutions_current_month: resolutionCount, // Key expected by frontend
            total_queries_current_month: 'N/A' // Placeholder as per plan
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
