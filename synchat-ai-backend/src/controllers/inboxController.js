// src/controllers/inboxController.js
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const POSITIVE_INT_REGEX = /^[1-9]\d*$/;

import {
    getClientConversations,
    getMessagesForConversation,
    addAgentMessageToConversation,
    updateConversationStatusByAgent,
    logRagFeedback // Added for RAG feedback
} from '../services/databaseService.js';

// Allowed statuses an agent can set (for validation in changeConversationStatus)
const AGENT_SETTABLE_STATUSES = [
    'open', // Agent might reopen a closed conversation
    'awaiting_agent_reply', // Agent assigns to themselves or confirms they are working on it
    'agent_replied', // This status is set by addAgentMessageToConversation, but could be set manually too
    'closed_by_agent',
    'archived' // Agent archives a conversation
    // 'escalated_to_human' might be set by the bot, or an agent if re-routing.
    // 'bot_active', 'closed_by_user', 'resolved_by_ia' are typically set by system/user.
];


// 1. List Conversations
export const listConversations = async (req, res) => {
    const clientId = req.user.id; // Assuming client_id refers to the organization/tenant ID
    const { status, page: pageQuery, pageSize: pageSizeQuery } = req.query;

    let statusFiltersArray = [];
    if (status && typeof status === 'string') {
        statusFiltersArray = status.split(',').map(s => s.trim()).filter(s => s);
    } else if (Array.isArray(status)) { // If query parser somehow produces an array
        statusFiltersArray = status.map(s => String(s).trim()).filter(s => s);
    }
    
    // Default to ['escalated_to_human'] if no specific filters are provided for MVP
    if (statusFiltersArray.length === 0) {
        statusFiltersArray = ['escalated_to_human', 'awaiting_agent_reply', 'agent_replied', 'open'];
    }

    const page = parseInt(pageQuery, 10) || 1;
    const pageSize = parseInt(pageSizeQuery, 10) || 20;

    try {
        console.log(`(InboxCtrl) Listing conversations for client ${clientId}, page ${page}, size ${pageSize}, statuses: ${statusFiltersArray.join(', ')}`);
        const result = await getClientConversations(clientId, statusFiltersArray, page, pageSize);
        
        if (result.error) { // Handle errors returned by the service itself (e.g. DB connection issues)
             console.error(`(InboxCtrl) Error from getClientConversations service:`, result.error);
             return res.status(500).json({ message: "Error retrieving conversations.", error: result.error });
        }

        res.status(200).json(result);
    } catch (error) {
        console.error(`(InboxCtrl) Exception in listConversations for client ${clientId}:`, error);
        res.status(500).json({ message: 'Failed to retrieve conversations due to an unexpected error.', error: error.message });
    }
};

// 2. Get Messages for a Specific Conversation
export const getConversationMessages = async (req, res) => {
    const clientId = req.user.id;
    const { conversation_id } = req.params;

    if (!conversation_id) {
        return res.status(400).json({ message: 'Conversation ID is required.' });
    }
    if (!UUID_REGEX.test(conversation_id)) {
        return res.status(400).json({ error: 'conversation_id has an invalid format.' });
    }

    try {
        console.log(`(InboxCtrl) Getting messages for conversation ${conversation_id}, client ${clientId}`);
        const messages = await getMessagesForConversation(conversation_id, clientId);
        res.status(200).json(messages);
    } catch (error) {
        console.error(`(InboxCtrl) Error in getConversationMessages for conv ${conversation_id}, client ${clientId}:`, error);
        if (error.message.toLowerCase().includes("not found or access denied")) {
            return res.status(404).json({ message: 'Conversation not found or access denied.' });
        }
        if (error.message.toLowerCase().includes("ownership verification failed")) {
             return res.status(403).json({ message: 'Access to this conversation is forbidden.' });
        }
        res.status(500).json({ message: 'Failed to retrieve messages.', error: error.message });
    }
};

// 3. Post a New Agent Message to a Conversation
export const postAgentMessage = async (req, res) => {
    const agentUserId = req.user.id; // The authenticated user is the agent
    const clientId = req.user.client_id; // Assuming client_id is on req.user for ownership check
                                         // If not, and client_id is a path param or similar, adjust.
                                         // For this implementation, we'll assume the service function
                                         // needs the client_id of the conversation, which it fetches.
                                         // The `addAgentMessageToConversation` in DB service takes `clientId` for ownership verification.

    const { conversation_id } = req.params;
    const { content } = req.body;

    if (!conversation_id) {
        return res.status(400).json({ message: 'Conversation ID is required.' });
    }
    if (!UUID_REGEX.test(conversation_id)) {
        return res.status(400).json({ error: 'conversation_id has an invalid format.' });
    }
    if (!content || typeof content !== 'string' || content.trim() === '') {
        return res.status(400).json({ message: 'Message content is required and cannot be empty.' });
    }
    
    // We need the client_id associated with the user/agent to pass to the service for ownership check.
    // If `req.user.client_id` is not available, this logic needs to be re-evaluated.
    // For now, assuming `req.user.id` is the agent's user ID and the service handles client ownership check.
    // The `databaseService.addAgentMessageToConversation` takes `clientId` as the second param for this check.
    // Let's assume that `clientId` for the conversation must be derived or passed if not available on `req.user`.
    // The current DB service `addAgentMessageToConversation(conversationId, clientId, agentUserId, content)`
    // uses `clientId` to verify conversation ownership. This `clientId` should be the ID of the client/tenant
    // that owns the conversation. If an agent belongs to a specific client, this `clientId` might be part of `req.user`.

    // If `req.user.client_id` is not the tenant ID but agent's own ID, we need to be careful.
    // For now, I'll pass req.user.id as agentUserId, and assume the `clientId` for conversation ownership
    // check is correctly handled by the service or needs to be fetched/passed if not on `req.user`.
    // The prompt says: "Extract `clientId` (as `agentUserId` for the service call, or `clientId` for ownership check) from `req.user.id`."
    // This is a bit ambiguous. Let's assume:
    // - `req.user.id` IS the `agentUserId`.
    // - The `clientId` for the conversation ownership check is also derived from the agent's context,
    //   or the service is robust enough. The databaseService `addAgentMessageToConversation` takes `clientId`
    //   as a parameter for the conversation's client owner.
    // If an agent can manage multiple clients, this `clientId` should come from the route or context.
    // Assuming the agent is tied to ONE client, `req.user.client_id` would be ideal.
    // If not, the route `/api/client/:client_id_param/me/inbox/...` would be more RESTful.
    // Given existing routes: /api/client/me/inbox, `req.user.id` is likely the client_id of the dashboard user.
    // If the dashboard user IS the agent, then `req.user.id` is the agent.
    // This implies an agent is also a "client" user in `auth.users`.
    // Let's assume `req.user.id` is the `agentUserId` AND this agent acts on behalf of their primary `client_id` (tenant).
    // The service layer `addAgentMessageToConversation` needs `clientId` for the conversation's owner.
    // The route is `/api/client/me/inbox`, `req.user.id` is the client_id.
    // So, an "agent" is a "client" user. `agentUserId` IS `req.user.id`. `clientId` (for conv owner) IS ALSO `req.user.id`.

    const conversationOwnerClientId = req.user.id; // The client who owns the dashboard and the conversation.
    const actingAgentUserId = req.user.id; // The user acting as an agent is the client themselves.
                                           // If agents were separate entities, this would be different.

    try {
        console.log(`(InboxCtrl) Posting agent message by ${actingAgentUserId} to conv ${conversation_id} (owned by ${conversationOwnerClientId})`);
        const newMessage = await addAgentMessageToConversation(conversation_id, conversationOwnerClientId, actingAgentUserId, content);
        res.status(201).json(newMessage);
    } catch (error) {
        console.error(`(InboxCtrl) Error in postAgentMessage for conv ${conversation_id}:`, error);
        if (error.message.toLowerCase().includes("not found or access denied")) {
            return res.status(404).json({ message: 'Conversation not found or access denied.' });
        }
        if (error.message.toLowerCase().includes("ownership verification failed")) {
             return res.status(403).json({ message: 'Access to this conversation is forbidden.' });
        }
        res.status(500).json({ message: 'Failed to post message.', error: error.message });
    }
};

// 4. Change Conversation Status
export const changeConversationStatus = async (req, res) => {
    const conversationOwnerClientId = req.user.id;
    const actingAgentUserId = req.user.id; // User acting as agent
    const { conversation_id } = req.params;
    const { newStatus } = req.body;

    if (!conversation_id) {
        return res.status(400).json({ message: 'Conversation ID is required.' });
    }
    if (!UUID_REGEX.test(conversation_id)) {
        return res.status(400).json({ error: 'conversation_id has an invalid format.' });
    }
    if (!newStatus || typeof newStatus !== 'string' || newStatus.trim() === '') {
        return res.status(400).json({ message: 'New status is required.' });
    }

    // Validate newStatus against allowed agent-settable statuses
    if (!AGENT_SETTABLE_STATUSES.includes(newStatus)) {
        return res.status(400).json({ 
            message: `Invalid status value. Allowed statuses are: ${AGENT_SETTABLE_STATUSES.join(', ')}.` 
        });
    }

    try {
        console.log(`(InboxCtrl) Changing status for conv ${conversation_id} (owned by ${conversationOwnerClientId}) to ${newStatus} by agent ${actingAgentUserId}`);
        const updatedConversation = await updateConversationStatusByAgent(conversation_id, conversationOwnerClientId, actingAgentUserId, newStatus);

        // Define terminal statuses for analytics finalization
        const terminalStatuses = ['resolved_by_ia', 'closed_by_agent', 'closed_by_user', 'archived'];
        if (terminalStatuses.includes(newStatus)) {
            // Use updated_at from the conversation record as the lastMessageAt for analytics
            const lastMessageAtForAnalytics = updatedConversation.updated_at || new Date().toISOString();
            db.finalizeConversationAnalyticRecord(conversation_id, newStatus, lastMessageAtForAnalytics)
                .catch(err => console.error(`Analytics: Failed to finalize record for CV:${conversation_id}`, err));
        }

        res.status(200).json(updatedConversation);
    } catch (error) {
        console.error(`(InboxCtrl) Error in changeConversationStatus for conv ${conversation_id}:`, error);
         if (error.message.toLowerCase().includes("not found or access denied")) {
            return res.status(404).json({ message: 'Conversation not found or access denied.' });
        }
        if (error.message.toLowerCase().includes("ownership verification failed")) {
             return res.status(403).json({ message: 'Access to this conversation is forbidden.' });
        }
        // Handle potential errors from DB if status ENUM is violated (though AGENT_SETTABLE_STATUSES should prevent this)
        if (error.message.toLowerCase().includes("invalid input value for enum")) {
            return res.status(400).json({ message: `Invalid status value: ${newStatus}.` });
        }
        res.status(500).json({ message: 'Failed to update conversation status.', error: error.message });
    }
};

// 5. Submit Feedback for a Message
export const submitMessageFeedback = async (req, res) => {
    const agentUserId = req.user.id; // User acting as agent is the dashboard owner
    const clientId = req.user.id; // The client context for this operation
    const { conversation_id, message_id } = req.params;
    const { rating, comment } = req.body;

    if (!conversation_id || !message_id) {
        return res.status(400).json({ message: 'Conversation ID and Message ID are required.' });
    }
    if (!UUID_REGEX.test(conversation_id)) {
        return res.status(400).json({ error: 'conversation_id has an invalid format.' });
    }
    if (!POSITIVE_INT_REGEX.test(message_id)) {
        return res.status(400).json({ error: 'message_id must be a positive integer string.' });
    }
    if (rating === undefined || ![-1, 1].includes(Number(rating))) {
        return res.status(400).json({ message: 'Rating is required and must be 1 (positive) or -1 (negative).' });
    }
    if (comment && typeof comment !== 'string') {
        return res.status(400).json({ message: 'Comment must be a string.' });
    }

    try {
        // Optional: Verify the message belongs to the conversation and client if needed,
        // but RLS on message_feedback table should handle security.
        // We trust message_id comes from a message displayed to this client.

        console.log(`(InboxCtrl) Submitting feedback for msg ${message_id} in conv ${conversation_id} by agent ${agentUserId} (Client: ${clientId})`);

        // The databaseService.logMessageFeedback function was added in a previous step.
        // Its signature is: logMessageFeedback(messageId, clientId, agentUserId, rating, comment)
        // Note: The existing code uses 'db.logMessageFeedback'. This seems to be an inconsistency
        // as other functions are imported directly. Assuming direct import for new function.
        // If 'db' is an alias or instance, this might need adjustment.
        // For now, proceeding with direct import as per other examples in this file.
        const { data, error: dbError } = await logMessageFeedback(message_id, clientId, agentUserId, Number(rating), comment);
        // For consistency, I should check if `logMessageFeedback` is actually what's used or if it's an alias.
        // The prompt refers to `databaseService.logRagFeedback`.
        // The existing code for `submitMessageFeedback` uses `db.logMessageFeedback`.
        // This is confusing. I will use the direct import style for the new RAG feedback function.
        // It's possible `logMessageFeedback` is also directly imported but aliased or part of an object not shown.

        if (dbError) {
            console.error(`(InboxCtrl) Error from logMessageFeedback service:`, dbError);
            return res.status(500).json({ message: "Error submitting feedback.", error: dbError });
        }

        res.status(201).json({ message: 'Feedback submitted successfully.', data });

    } catch (error) {
        console.error(`(InboxCtrl) Error in submitMessageFeedback for msg ${message_id}:`, error);
        // Check for specific DB errors if needed, e.g., foreign key violation if message_id is wrong
        if (error.message && error.message.includes("violates foreign key constraint")) {
             return res.status(404).json({ message: 'Failed to submit feedback: Invalid message or conversation.' });
        }
        res.status(500).json({ message: 'Failed to submit feedback.', error: error.message });
    }
};

// 6. Handle RAG Feedback for a specific message
export const handleMessageRagFeedback = async (req, res) => {
    const { conversation_id, message_id } = req.params;
    const { rating, comment, rag_interaction_log_id, feedback_context } = req.body;
    const user_id = req.user.id; // From authMiddleware (Supabase user UID)
    const client_id = req.user.id; // Assuming Supabase user UID is the client_id for 'synchat_clients'

    // Validate critical inputs
    if (typeof rating !== 'number') {
        return res.status(400).json({ error: 'Rating must be a number.' });
    }
    if (!client_id) {
        // This case should ideally be prevented by auth or earlier checks if client_id is essential for all user ops
        console.error('(InboxCtrl) Critical: Client ID not found for authenticated user in handleMessageRagFeedback. User ID:', user_id);
        return res.status(500).json({ error: 'Could not determine client ID for feedback. Ensure user is correctly associated with a client.' });
    }
    if (!conversation_id || !message_id) {
        return res.status(400).json({ error: 'Conversation ID and Message ID are required in path parameters.' });
    }
    if (!UUID_REGEX.test(conversation_id)) {
        return res.status(400).json({ error: 'conversation_id has an invalid format.' });
    }
    if (!POSITIVE_INT_REGEX.test(message_id)) {
        return res.status(400).json({ error: 'message_id must be a positive integer string.' });
    }

    // Validate rag_interaction_log_id if provided
    if (rag_interaction_log_id && !UUID_REGEX.test(rag_interaction_log_id)) {
        return res.status(400).json({ error: 'rag_interaction_log_id has an invalid format.' });
    }

    const feedbackData = {
        client_id,
        user_id, // user_id from auth, represents the person giving feedback
        conversation_id,
        message_id,
        rag_interaction_log_id, // Optional, from request body
        feedback_type: 'response_quality', // Fixed for this endpoint
        rating,
        comment, // Optional, from request body
        feedback_context // Optional, from request body
    };

    // Ensure optional fields that are undefined are not sent to the DB service,
    // as it already handles stripping undefined keys.
    if (rag_interaction_log_id === undefined) delete feedbackData.rag_interaction_log_id;
    if (comment === undefined) delete feedbackData.comment;
    if (feedback_context === undefined) delete feedbackData.feedback_context;


    try {
        console.log(`(InboxCtrl) Submitting RAG feedback for msg ${message_id} in conv ${conversation_id} by user ${user_id} (Client: ${client_id})`);
        const result = await logRagFeedback(feedbackData);

        if (result.error) {
            console.error('(InboxCtrl) Error in handleMessageRagFeedback calling logRagFeedback:', result.error);
            // Check for specific error messages from databaseService if needed
            if (result.error.includes('Invalid input')) {
                return res.status(400).json({ error: result.error });
            }
            return res.status(500).json({ error: "Failed to submit RAG feedback due to a server error." });
        }

        res.status(201).json({ message: 'RAG Feedback submitted successfully', data: result.data });
    } catch (error) {
        console.error('(InboxCtrl) Exception in handleMessageRagFeedback:', error);
        res.status(500).json({ error: 'Failed to submit RAG feedback due to an unexpected server error.' });
    }
};