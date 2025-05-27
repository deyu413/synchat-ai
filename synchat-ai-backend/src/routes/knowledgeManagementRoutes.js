import express from 'express';
import { protectRoute as authMiddleware } from '../middleware/authMiddleware.js';
import * as knowledgeManagementController from '../controllers/knowledgeManagementController.js';

const router = express.Router();

// Route to upload a file
router.post('/upload', authMiddleware, knowledgeManagementController.uploadFile);

// Route to get all knowledge sources for the client
router.get('/sources', authMiddleware, knowledgeManagementController.getSources);

// Route to trigger ingestion for a specific source
router.post('/sources/:source_id/ingest', authMiddleware, knowledgeManagementController.ingestSource);

// Route to delete a specific source
router.delete('/sources/:source_id', authMiddleware, knowledgeManagementController.deleteSource);

export default router;
