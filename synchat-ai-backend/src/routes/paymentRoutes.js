// synchat-ai-backend/src/routes/paymentRoutes.js
import express from 'express';
import { protectRoute } from '../middleware/authMiddleware.js'; // Using actual auth middleware
import {
    createCheckoutSession,
    handleStripeWebhook,
} from '../controllers/paymentsController.js';

const router = express.Router();

// POST /api/payments/create-checkout-session - Create a Stripe Checkout Session
// This route should be protected as it's initiated by an authenticated client.
router.post('/create-checkout-session', protectRoute, createCheckoutSession);

// POST /api/payments/webhook - Handle incoming Stripe webhooks
// The express.raw middleware is applied in server.js for the full path /api/payments/webhook
// No additional express.raw() needed here if server.js handles it for the specific path.
router.post('/webhook', handleStripeWebhook);

export default router;
