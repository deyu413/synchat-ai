// synchat-ai-backend/src/routes/publicChatRoutes.js
import express from 'express';
import { getWidgetConfigByClientId } from '../controllers/publicChatController.js'; // Adjust path if necessary

const router = express.Router();

// GET /api/public-chat/widget-config?clientId=CLIENT_ID_HERE
router.get('/widget-config', getWidgetConfigByClientId);

export default router;
