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

export default router;
