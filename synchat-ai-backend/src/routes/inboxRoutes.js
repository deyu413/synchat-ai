const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const inboxController = require('../controllers/inboxController'); // Controller to be created later

// Route to list conversations
router.get('/conversations', authMiddleware, inboxController.listConversations);

// Route to get messages for a specific conversation
router.get('/conversations/:conversation_id/messages', authMiddleware, inboxController.getConversationMessages);

// Route to post a new agent message to a conversation
router.post('/conversations/:conversation_id/messages', authMiddleware, inboxController.postAgentMessage);

// Route to change the status of a conversation
router.put('/conversations/:conversation_id/status', authMiddleware, inboxController.changeConversationStatus);

module.exports = router;
