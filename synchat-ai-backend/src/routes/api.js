// src/routes/api.js
import express from 'express';
import chatController from '../controllers/chatController.js';
import { protectRoute } from '../middleware/authMiddleware.js'; // Import protectRoute

const router = express.Router();

console.log('>>> api.js: Cargando el router de API');

// POST /api/chat/start - Iniciar una nueva conversación (Protected)
router.post('/start', protectRoute, chatController.startConversation);

// POST /api/chat/message - Enviar un mensaje (Protected)
router.post('/message', protectRoute, chatController.handleChatMessage);

console.log('>>> api.js: Rutas definidas y protegidas');

export default router;
