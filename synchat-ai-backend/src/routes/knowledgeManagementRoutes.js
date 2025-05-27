const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const knowledgeManagementController = require('../controllers/knowledgeManagementController');

// Route to upload a file
router.post('/upload', authMiddleware, knowledgeManagementController.uploadFile);

// Route to get all knowledge sources for the client
router.get('/sources', authMiddleware, knowledgeManagementController.getSources);

// Route to trigger ingestion for a specific source
router.post('/sources/:source_id/ingest', authMiddleware, knowledgeManagementController.ingestSource);

// Route to delete a specific source
router.delete('/sources/:source_id', authMiddleware, knowledgeManagementController.deleteSource);

module.exports = router;
