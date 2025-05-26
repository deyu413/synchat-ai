// synchat-ai-backend/src/routes/publicChatRoutes.js
import express from 'express';
import { getWidgetConfigByClientId } from '../controllers/publicChatController.js'; // Adjust path if necessary
import chatController from '../controllers/chatController.js'; // New import

const router = express.Router();

// GET /api/public-chat/widget-config?clientId=CLIENT_ID_HERE
router.get('/widget-config', getWidgetConfigByClientId);

// New public route to start a conversation
// POST /api/public-chat/start
// Body: { "clientId": "..." }
router.post('/start', chatController.startConversation);

// New public route to send a message
// POST /api/public-chat/message
// Body: { "clientId": "...", "conversationId": "...", "message": "..." }
router.post('/message', chatController.handleChatMessage);

export default router;
