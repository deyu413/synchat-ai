// src/controllers/inboxController.js
import {
    getClientConversations,
    getMessagesForConversation,
    addAgentMessageToConversation,
    updateConversationStatusByAgent
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

