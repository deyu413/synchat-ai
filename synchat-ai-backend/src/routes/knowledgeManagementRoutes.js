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

// Route to get a sample of chunks for a specific source
router.get('/sources/:source_id/chunk_sample', authMiddleware, knowledgeManagementController.getSourceChunkSample);

// Route to update metadata for a specific source
router.put(
    '/sources/:source_id/metadata',
    authMiddleware, // Using authMiddleware as used elsewhere in this file
    knowledgeManagementController.updateSourceMetadata
);

// Route to get paginated chunks for a specific source
router.get(
    '/sources/:source_id/chunks',
    authMiddleware,
    knowledgeManagementController.getKnowledgeSourceChunks
);

export default router;
