// synchat-ai-backend/src/routes/clientDashboardRoutes.js
import express from 'express';
import { protectRoute } from '../middleware/authMiddleware.js'; // Actual middleware
import { // Assuming clientDashboardController.js uses named exports
    getClientConfig,
    updateClientConfig,
    requestKnowledgeIngest,
    getClientUsageResolutions,
    getChatbotAnalyticsSummary,
    getUnansweredQuerySuggestions,
    testKnowledgeQuery,
    getKnowledgeSuggestions, // New controller function for getting suggestions
    updateKnowledgeSuggestionStatus, // New controller function for updating suggestion status
    runRagPlaygroundQuery // Controller function for the RAG playground query
} from '../controllers/clientDashboardController.js';

const router = express.Router();

// All routes are protected by protectRoute
router.get('/me/config', protectRoute, getClientConfig);
router.put('/me/config', protectRoute, updateClientConfig);
router.post('/me/ingest', protectRoute, requestKnowledgeIngest);
router.get('/me/usage/resolutions', protectRoute, getClientUsageResolutions);

// New analytics routes
router.get('/me/analytics/summary', protectRoute, getChatbotAnalyticsSummary);
router.get('/me/analytics/suggestions/unanswered', protectRoute, getUnansweredQuerySuggestions);

// New route for testing knowledge query
router.post('/me/knowledge/test_query', protectRoute, testKnowledgeQuery);

// Routes for knowledge suggestions
router.get('/me/knowledge/suggestions', protectRoute, getKnowledgeSuggestions);
router.put('/me/knowledge/suggestions/:suggestion_id/status', protectRoute, updateKnowledgeSuggestionStatus);

// Route for RAG Playground query
router.post(
    '/me/knowledge/rag-playground-query',
    protectRoute,
    runRagPlaygroundQuery
);

export default router;
