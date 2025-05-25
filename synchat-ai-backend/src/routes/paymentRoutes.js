// synchat-ai-backend/src/routes/paymentRoutes.js

const express = require('express');
const router = express.Router();

// Import controller functions
const {
    createCheckoutSession,
    handleStripeWebhook,
} = require('../controllers/paymentsController.js');

// Placeholder authMiddleware (copied from clientDashboardRoutes.js for now)
// In a real application, this would involve token verification (e.g., JWT, Supabase session)
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        // TODO: Replace with actual token verification logic in a later task.
        // For this placeholder, we'll simulate a successful verification if a token exists.
        // A real implementation would decode the token to get user details.
        if (token) { 
            // Simulate extracting client_id from a JWT's 'sub' claim or a Supabase user object
            req.user = { client_id: 'simulated_client_id_from_token' }; 
            console.log(`AuthMiddleware: User authenticated, client_id: ${req.user.client_id}`);
            next();
        } else {
            console.warn('AuthMiddleware: Token invalid or verification failed.');
            res.status(401).json({ message: 'Invalid or missing token' });
        }
    } else {
        console.warn('AuthMiddleware: Authorization header missing or malformed.');
        res.status(401).json({ message: 'Authorization header missing or malformed' });
    }
};

// Define payment routes

// POST /api/payments/create-checkout-session - Create a Stripe Checkout Session
router.post('/create-checkout-session', authMiddleware, createCheckoutSession);

// POST /api/payments/stripe-webhooks - Handle incoming Stripe webhooks
// Stripe requires the raw body for signature verification, hence express.raw
router.post('/stripe-webhooks', express.raw({type: 'application/json'}), handleStripeWebhook);

module.exports = router;

/*
Note on Main App Integration:
This router needs to be mounted in the main Express application file (e.g., app.js, server.js, or api.js).
Example:
const paymentRoutes = require('./routes/paymentRoutes');
// Assuming your API routes are prefixed, e.g., with /api
app.use('/api/payments', paymentRoutes); 
*/
