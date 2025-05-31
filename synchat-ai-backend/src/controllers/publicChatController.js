// synchat-ai-backend/src/controllers/publicChatController.js
import { supabase } from '../services/supabaseClient.js'; // Adjust path if necessary

export const getWidgetConfigByClientId = async (req, res) => {
    const { clientId } = req.query;

    if (!clientId) {
        return res.status(400).json({ error: 'ClientId is missing.' });
    }

    // Validate clientId format as UUID.
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(clientId)) {
        return res.status(400).json({ error: 'ClientId has an invalid format.' });
    }

    try {
        const { data: clientRecord, error: dbError } = await supabase
            .from('synchat_clients')
            .select('widget_config')
            .eq('client_id', clientId)
            .single();

        if (dbError) {
            console.error(`(Public Controller) Error fetching widget_config for clientId ${clientId}:`, dbError.message);
            if (dbError.code === 'PGRST116') { // PGRST116: Supabase code for "0 rows"
                return res.status(404).json({ error: 'Widget configuration not found for the provided client ID.' });
            }
            return res.status(500).json({ error: 'Failed to retrieve widget configuration.' });
        }

        const baseConfig = (typeof clientRecord?.widget_config === 'object' && clientRecord.widget_config !== null) 
                            ? clientRecord.widget_config 
                            : {};

        const responseConfig = {
            botName: baseConfig.botName || 'SynChat Bot', // Default if not set
            welcomeMessage: baseConfig.welcomeMessage || 'Hello! How can I help you today?', // Default if not set
            ...baseConfig // Spread other existing properties from widget_config
        };
        
        // Ensure botName and welcomeMessage are explicitly part of the object even if baseConfig was empty.
        if (!responseConfig.hasOwnProperty('botName')) {
            responseConfig.botName = 'SynChat Bot';
        }
        if (!responseConfig.hasOwnProperty('welcomeMessage')) {
            responseConfig.welcomeMessage = 'Hello! How can I help you today?';
        }

        res.status(200).json(responseConfig);

    } catch (error) {
        console.error('(Public Controller) Unexpected error in getWidgetConfigByClientId:', error.message, error.stack);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
};
