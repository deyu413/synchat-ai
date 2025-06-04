// synchat-ai-backend/src/routes/authRoutes.js
import express from 'express';
import { handlePostRegistration } from '../controllers/authController.js'; // Adjust path as needed

const router = express.Router();

// If not using user's token for this specific call, consider an API key middleware
// For Option 3a (passing userId, userEmail in body):
router.post('/post-registration', handlePostRegistration);

// For Option 3b (using user's token to get userId, userEmail):
// router.post('/post-registration', protectRoute, handlePostRegistrationWithToken);
// where handlePostRegistrationWithToken would get userId/email from req.user

export default router;
