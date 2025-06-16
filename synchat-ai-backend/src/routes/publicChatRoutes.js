// synchat-ai-backend/src/routes/publicChatRoutes.js
import express from 'express';
import * as publicChatController from '../controllers/publicChatController.js'; // Import all exports
import chatController from '../controllers/chatController.js'; // New import

const router = express.Router();

// GET /api/public-chat/widget-config?clientId=CLIENT_ID_HERE
router.get('/widget-config', publicChatController.getWidgetConfigByClientId);

// New public route to start a conversation
// POST /api/public-chat/start
// Body: { "clientId": "..." }
router.post('/start', chatController.startConversation);

// New public route to send a message
// POST /api/public-chat/message
// Body: { "clientId": "...", "conversationId": "...", "message": "..." }
router.post('/message', chatController.handleChatMessage);

// POST /api/public-chat/:conversationId/resolve
// This route will handle requests to mark a conversation as resolved by the user.
router.post('/:conversationId/resolve', publicChatController.markConversationAsResolved);

export default router;
