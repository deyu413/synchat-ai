// src/routes/api.js
import express from 'express';
import chatController from '../controllers/chatController.js'; // Añadir .js

const router = express.Router();

console.log('>>> api.js: Cargando el router de API');

// --- Definición de Rutas ---

// POST /api/chat/start - Iniciar una nueva conversación
router.post('/start', chatController.startConversation);

// POST /api/chat/message - Enviar un mensaje
router.post('/message', chatController.handleChatMessage);

// GET /api/chat/history?conversationId=... (Opcional, si se necesita)
// router.get('/history', chatController.getHistory);

console.log('>>> api.js: Rutas definidas');

export default router; // Usar export default