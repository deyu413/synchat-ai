import express from 'express';
import { protectRoute as authMiddleware } from '../middleware/authMiddleware.js';
import * as inboxController from '../controllers/inboxController.js'; // inboxController uses named exports

const router = express.Router();

// Route to list conversations
router.get('/conversations', authMiddleware, inboxController.listConversations);

// Route to get messages for a specific conversation
router.get('/conversations/:conversation_id/messages', authMiddleware, inboxController.getConversationMessages);

// Route to post a new agent message to a conversation
router.post('/conversations/:conversation_id/messages', authMiddleware, inboxController.postAgentMessage);

// Route to change the status of a conversation
router.put('/conversations/:conversation_id/status', authMiddleware, inboxController.changeConversationStatus);

// Route to submit feedback for a specific message within a conversation
router.post('/conversations/:conversation_id/messages/:message_id/feedback', authMiddleware, inboxController.submitMessageFeedback);

// Route for submitting RAG feedback on a message
router.post(
    '/conversations/:conversation_id/messages/:message_id/rag_feedback',
    authMiddleware, // Protect the route
    inboxController.handleMessageRagFeedback // New controller function
);

export default router;
