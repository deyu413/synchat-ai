// synchat-ai-backend/src/controllers/paymentsController.js
// Controller for handling Stripe payment processing.

import logger from '../utils/logger.js';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/; // For consistency, not used here yet
const STRIPE_PRICE_ID_REGEX = /^price_[a-zA-Z0-9_]+$/; // Basic regex for Stripe Price IDs
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // Common email regex
import 'dotenv/config'; // Ensure environment variables are loaded
import Stripe from 'stripe';
import { supabase } from '../services/supabaseClient.js'; // Added for idempotency

// Initialize Stripe with the secret key from environment variables
// Ensure STRIPE_SECRET_KEY is set in your Vercel environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Ensure STRIPE_WEBHOOK_SECRET is set in Vercel for webhook verification
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Creates a Stripe Checkout Session for a given priceId.
 */
export const createCheckoutSession = async (req, res) => {
    logger.info('paymentsController.createCheckoutSession called');
    const { priceId, customerEmail } = req.body; // priceId from your Stripe Dashboard, customerEmail for Stripe customer
    const clientId = req.user?.id; // Assuming protectRoute adds user object with id

    if (!priceId) {
        return res.status(400).json({ error: 'Price ID is required.' });
    }
    // Validate priceId format
    if (!STRIPE_PRICE_ID_REGEX.test(priceId)) {
        // Note: A more specific regex might be needed depending on exact Stripe Price ID format variations.
        // This basic one checks for 'price_' prefix and common characters.
        return res.status(400).json({ error: 'Price ID has an invalid format.' });
    }

    if (!clientId) {
        // Should be caught by protectRoute, but good to double check
        return res.status(401).json({ error: 'User not authenticated.' });
    }
    
    const finalCustomerEmail = customerEmail || req.user?.email; 
    if (finalCustomerEmail && !EMAIL_REGEX.test(finalCustomerEmail)) {
        return res.status(400).json({ error: 'Customer email has an invalid format.' });
    }
    if (!finalCustomerEmail) {
        logger.warn('(Payments) Customer email not provided and not found in user token.');
    }

    const YOUR_DOMAIN = process.env.FRONTEND_URL || 'http://localhost:3000';

    try {
        let stripeCustomer;
        if (finalCustomerEmail) {
            const existingCustomers = await stripe.customers.list({ email: finalCustomerEmail, limit: 1 });
            if (existingCustomers.data.length > 0) {
                stripeCustomer = existingCustomers.data[0];
                logger.info(`(Payments) Existing Stripe customer found: ${stripeCustomer.id} for email ${finalCustomerEmail}`);
            } else {
                stripeCustomer = await stripe.customers.create({
                    email: finalCustomerEmail,
                    name: req.user?.name || undefined,
                    metadata: {
                        app_client_id: clientId, 
                    },
                });
                logger.info(`(Payments) New Stripe customer created: ${stripeCustomer.id} for email ${finalCustomerEmail}`);
            }
        } else {
            logger.warn('(Payments) Proceeding without specific Stripe customer due to missing email.');
        }

        const sessionParams = {
            payment_method_types: ['card'], 
            line_items: [
                {
                    price: priceId, 
                    quantity: 1,
                },
            ],
            mode: 'subscription', 
            success_url: `${YOUR_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${YOUR_DOMAIN}/payment-cancelled`,
            metadata: {
                app_client_id: clientId, 
            }
        };

        if (stripeCustomer) {
            sessionParams.customer = stripeCustomer.id;
        } else if (finalCustomerEmail) {
            sessionParams.customer_email = finalCustomerEmail;
        }

        const session = await stripe.checkout.sessions.create(sessionParams);

        logger.info(`(Payments) Stripe Checkout session created: ${session.id}`);
        res.status(200).json({ sessionId: session.id, checkoutUrl: session.url });

    } catch (error) {
        logger.error('(Payments) Error creating Stripe Checkout session:', error);
        res.status(500).json({ error: { message: error.message } });
    }
};

/**
 * Handles incoming webhooks from Stripe.
 */
export const handleStripeWebhook = async (req, res) => {
    logger.info('paymentsController.handleStripeWebhook received a request');
    const sig = req.headers['stripe-signature'];

    if (!endpointSecret) {
        logger.error('(Payments) CRITICAL: STRIPE_WEBHOOK_SECRET is not set. Cannot verify webhook.');
        return res.status(400).send('Webhook secret not configured.');
    }
    if (!sig) {
        logger.warn('(Payments) Webhook received without stripe-signature. Ignoring.');
        return res.status(400).send('No signature provided.');
    }
    if (!req.body) {
         logger.warn('(Payments) Webhook received without body. Ignoring.');
        return res.status(400).send('No body provided.');
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        logger.info(`(Payments) Stripe webhook event verified: ${event.id}, type: ${event.type}`);
    } catch (err) {
        logger.error(`(Payments) Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Idempotency Check: Has this event already been processed?
    try {
        const { data: existingEvent, error: checkError } = await supabase
            .from('processed_stripe_events')
            .select('event_id')
            .eq('event_id', event.id)
            .maybeSingle(); // Use maybeSingle to not error if not found

        if (checkError) {
            // Handle potential database errors (e.g., connection issues)
            // PGRST116 means "Not a single row was found", which is fine for maybeSingle.
            // We only worry about other errors.
            if (checkError.code !== 'PGRST116') {
                logger.error(`(Payments) Error checking for existing event ${event.id} in DB:`, checkError);
                // Return 500 to signal Stripe to retry, as we couldn't confirm idempotency.
                return res.status(500).json({ error: 'Database error during idempotency check.' });
            }
        }

        if (existingEvent) {
            logger.info(`(Payments) Event ${event.id} (type: ${event.type}) already processed. Acknowledging with 200.`);
            return res.status(200).json({ received: true, status: 'already_processed' });
        }
    } catch (dbError) { // Catch any unexpected errors from the try block itself
        logger.error(`(Payments) Unexpected error during idempotency check for event ${event.id}:`, dbError);
        return res.status(500).json({ error: 'Unexpected error during idempotency check.' });
    }

    // Variable to track if we need to record the event after processing
    let eventShouldBeRecorded = false;

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            logger.info(`(Payments) Checkout session completed: ${session.id}`);
            // TODO: (Original TODOs can be refined or removed if handled)
            // 1. Retrieve customer details (session.customer) and your internal clientId from session.metadata.app_client_id.
            // 2. Idempotency check is now done above.
            // 3. Provision the subscription or product for the customer.
            //    - Update your database: mark user as subscribed, store stripe_customer_id, subscription_id, plan_id, status, current_period_end.
            logger.info(`(Payments) Fulfilling order for session: ${session.id}, Client ID: ${session.metadata.app_client_id}, Stripe Customer ID: ${session.customer}, Stripe Subscription ID: ${session.subscription}`);
            // --- SIMULATE FULFILLMENT LOGIC ---
            // Example:
            // await databaseService.activateClientSubscription(
            //    session.metadata.app_client_id,
            //    session.customer,
            //    session.subscription,
            //    session.display_items[0].plan.id, // This might not be robust, check Stripe object structure
            //    'active',
            //    new Date(session.current_period_end * 1000) // current_period_end might not be on session, but on subscription
            // );
            // --- END SIMULATE FULFILLMENT ---
            eventShouldBeRecorded = true; // Mark for recording
            break;

        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            logger.info(`(Payments) Invoice payment succeeded: ${invoice.id} for customer ${invoice.customer}, Subscription: ${invoice.subscription}`);
            // TODO:
            // - If this is for a subscription renewal, update current_period_end in your database.
            // - Log payment for records.
            // - Handle if subscription was past_due and is now active.
            // Example:
            // if (invoice.subscription) {
            //   const subscriptionDetails = await stripe.subscriptions.retrieve(invoice.subscription);
            //   const newPeriodEnd = new Date(subscriptionDetails.current_period_end * 1000);
            //   await databaseService.updateSubscriptionPeriod(invoice.subscription, newPeriodEnd, 'active');
            // }
            eventShouldBeRecorded = true; // Mark for recording
            break;

        case 'invoice.payment_failed':
            const failedInvoice = event.data.object;
            logger.info(`(Payments) Invoice payment failed: ${failedInvoice.id} for customer ${failedInvoice.customer}`);
            // TODO:
            // - Notify the customer about the payment failure.
            // - Update subscription status in your database (e.g., to 'past_due' or 'unpaid').
            // Example:
            // if (failedInvoice.subscription) {
            //    await databaseService.updateSubscriptionStatus(failedInvoice.subscription, 'past_due');
            // }
            eventShouldBeRecorded = true; // Mark for recording, as state might change
            break;

        case 'customer.subscription.updated':
            const subscriptionUpdated = event.data.object;
            logger.info(`(Payments) Customer subscription updated: ${subscriptionUpdated.id}, Status: ${subscriptionUpdated.status}`);
            // TODO:
            // - Handle changes in subscription status (e.g., 'active', 'past_due', 'canceled', 'unpaid').
            // - Update your database with the new status and current_period_end.
            // Example:
            // const { id, status, current_period_end, customer, plan } = subscriptionUpdated;
            // await databaseService.updateClientSubscriptionStatus(id, status, new Date(current_period_end * 1000));
            eventShouldBeRecorded = true; // Mark for recording
            break;

        case 'customer.subscription.deleted':
            const subscriptionDeleted = event.data.object;
            logger.info(`(Payments) Customer subscription deleted: ${subscriptionDeleted.id}, Status: ${subscriptionDeleted.status}`);
            // TODO:
            // - Mark the subscription as 'canceled' in your database.
            // Example:
            // await databaseService.cancelClientSubscription(subscriptionDeleted.id, subscriptionDeleted.status);
            eventShouldBeRecorded = true; // Mark for recording
            break;
            
        default:
            logger.warn(`(Payments) Unhandled Stripe event type: ${event.type}. Not recording.`);
            // For unhandled events, we typically don't record them as "processed" in our idempotency table
            // unless we are sure we want to ignore them permanently after seeing them once.
            // If it's truly unhandled and might be important later, not recording allows it to be re-processed
            // if Stripe sends it again (e.g., after a new deployment handles this event type).
            eventShouldBeRecorded = false;
    }

    // If the event type was one that we processed and it should be marked as such
    if (eventShouldBeRecorded) {
        try {
            const { error: insertError } = await supabase
                .from('processed_stripe_events')
                .insert({ event_id: event.id });

            if (insertError) {
                logger.error(`(Payments) Error inserting event ${event.id} into processed_stripe_events:`, insertError);
                // This is a non-critical error for the response to Stripe, as the primary action succeeded.
                // However, it means idempotency might fail for a retry of *this specific event*.
                // Depending on business logic, you might choose to return 500 here if recording is absolutely vital.
                // For now, logging and still returning 200 to Stripe.
            } else {
                logger.info(`(Payments) Event ${event.id} successfully recorded in processed_stripe_events.`);
            }
        } catch (dbInsertError) {
            logger.error(`(Payments) Unexpected error while inserting event ${event.id} into processed_stripe_events:`, dbInsertError);
            // Similar to above, log but don't necessarily fail the webhook response to Stripe.
        }
    }

    res.status(200).json({ received: true });
};
