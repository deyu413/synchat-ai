// synchat-ai-backend/src/routes/clientDashboardRoutes.js
import express from 'express';
import { protectRoute } from '../middleware/authMiddleware.js'; // Actual middleware
import { // Assuming clientDashboardController.js uses named exports
    getClientConfig,
    updateClientConfig,
    requestKnowledgeIngest,
    getClientUsageResolutions,
} from '../controllers/clientDashboardController.js';

const router = express.Router();

// All routes are protected by protectRoute
router.get('/me/config', protectRoute, getClientConfig);
router.put('/me/config', protectRoute, updateClientConfig);
router.post('/me/ingest', protectRoute, requestKnowledgeIngest);
router.get('/me/usage/resolutions', protectRoute, getClientUsageResolutions);

export default router;
