// src/routes/internalRoutes.js
import express from 'express';
import { internalAuthMiddleware } from '../middleware/internalAuthMiddleware.js';
import * as internalController from '../controllers/internalController.js';

const router = express.Router();

// This endpoint is designed to be called by a trusted scheduler (e.g., Supabase Edge Function via cron)
// to trigger suggestion generation for all relevant clients.
router.post(
    '/suggestions/trigger-all-clients-generation',
    internalAuthMiddleware,
    internalController.triggerAllClientsSuggestionGeneration
);

// module.exports = router; // For CommonJS
export default router; // For ES Modules (matching project type)
