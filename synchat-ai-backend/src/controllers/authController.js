// synchat-ai-backend/src/controllers/authController.js
import { supabase } from '../services/supabaseClient.js'; // Backend Supabase client (service role)
import logger from '../utils/logger.js'; // Assuming logger is in utils

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handlePostRegistration(req, res) {
    const { userId, userEmail } = req.body;

    if (!userId || !userEmail) {
        logger.warn('handlePostRegistration: Missing userId or userEmail.');
        return res.status(400).json({ message: 'User ID and User Email are required.' });
    }
    if (!UUID_REGEX.test(userId)) {
        logger.warn(`handlePostRegistration: Invalid userId format: ${userId}`);
        return res.status(400).json({ message: 'Invalid User ID format.' });
    }
    if (!EMAIL_REGEX.test(userEmail)) {
        logger.warn(`handlePostRegistration: Invalid userEmail format: ${userEmail}`);
        return res.status(400).json({ message: 'Invalid User Email format.' });
    }

    try {
        logger.info(`handlePostRegistration: Received request for userId: ${userId}, userEmail: ${userEmail}`);

        const { data: existingClient, error: checkError } = await supabase
            .from('synchat_clients')
            .select('client_id')
            .eq('client_id', userId)
            .maybeSingle(); // Use maybeSingle to not error if not found

        if (checkError) {
            logger.error(`handlePostRegistration: Error checking existing synchat_client for ${userId}:`, checkError.message);
            return res.status(500).json({ message: 'Database error while checking client existence.' });
        }

        if (existingClient) {
            logger.info(`handlePostRegistration: Client entry already exists for ${userId}. Skipping creation.`);
            return res.status(200).json({ message: 'Client entry already exists and is confirmed.', clientId: userId });
        }

        logger.info(`handlePostRegistration: Calling RPC public.create_synchat_client_entry for user ${userId}`);
        const { error: rpcError } = await supabase.rpc('create_synchat_client_entry', {
            p_client_id: userId,
            p_email: userEmail
        });

        if (rpcError) {
            logger.error(`handlePostRegistration: Error calling RPC create_synchat_client_entry for ${userId}:`, rpcError);
            // Check for specific Supabase error details if possible
            if (rpcError.details) logger.error(`RPC Error Details: ${rpcError.details}`);
            if (rpcError.hint) logger.error(`RPC Error Hint: ${rpcError.hint}`);
            return res.status(500).json({ message: 'Failed to create client entry due to a database procedure error.' });
        }

        logger.info(`handlePostRegistration: Successfully ensured synchat_client entry for ${userId}`);
        return res.status(201).json({ message: 'Client initialized successfully.', clientId: userId });

    } catch (error) {
        logger.error('handlePostRegistration: Unhandled exception:', error);
        return res.status(500).json({ message: 'Internal server error during post-registration processing.' });
    }
}
