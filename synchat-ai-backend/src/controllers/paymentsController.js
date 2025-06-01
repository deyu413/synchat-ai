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
    // ASSUMPTION: A column named 'subscription_current_period_end' of type TIMESTAMPTZ exists in 'synchat_clients' table.
    // Other columns like 'stripe_customer_id', 'subscription_id', 'subscription_status' are also assumed to exist.
    logger.info("(Payments) Using assumed column 'subscription_current_period_end' for subscription period end date.");

    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            logger.info(`(Payments) Processing checkout.session.completed: ${session.id}`);
            try {
                const clientId = session.metadata.app_client_id;
                const stripeCustomerId = session.customer;
                const subscriptionId = session.subscription;

                if (!clientId || !stripeCustomerId || !subscriptionId) {
                    logger.error(`(Payments) Missing critical data in checkout.session.completed: clientId: ${clientId}, stripeCustomerId: ${stripeCustomerId}, subscriptionId: ${subscriptionId}`);
                    // Do not record event if critical data is missing for processing
                    eventShouldBeRecorded = false;
                    break;
                }

                const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

                const { error: updateError } = await supabase
                    .from('synchat_clients')
                    .update({
                        stripe_customer_id: stripeCustomerId,
                        subscription_id: subscriptionId,
                        subscription_status: 'active',
                        subscription_current_period_end: currentPeriodEnd.toISOString(),
                    })
                    .eq('client_id', clientId);

                if (updateError) {
                    logger.error(`(Payments) Error updating synchat_clients for clientId ${clientId} on checkout.session.completed:`, updateError);
                } else {
                    logger.info(`(Payments) Fulfilled checkout.session.completed for clientId ${clientId}: Stripe CustomerID ${stripeCustomerId}, SubscriptionID ${subscriptionId}, PeriodEnd ${currentPeriodEnd.toISOString()}`);
                }
            } catch (e) {
                logger.error(`(Payments) Exception processing checkout.session.completed ${session.id}:`, e);
            }
            eventShouldBeRecorded = true;
            break;

        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            logger.info(`(Payments) Processing invoice.payment_succeeded: ${invoice.id}`);
            if (invoice.subscription && invoice.customer) {
                try {
                    const stripeCustomerId = invoice.customer;
                    const subscriptionId = invoice.subscription;

                    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
                    const newStatus = subscription.status; // e.g., 'active'

                    const { data: client, error: fetchError } = await supabase
                        .from('synchat_clients')
                        .select('client_id')
                        .eq('stripe_customer_id', stripeCustomerId)
                        .single();

                    if (fetchError) {
                        logger.error(`(Payments) Error fetching client_id for stripe_customer_id ${stripeCustomerId} on invoice.payment_succeeded:`, fetchError);
                    } else if (client) {
                        const { error: updateError } = await supabase
                            .from('synchat_clients')
                            .update({
                                subscription_status: newStatus,
                                subscription_current_period_end: currentPeriodEnd.toISOString(),
                            })
                            .eq('client_id', client.client_id);

                        if (updateError) {
                            logger.error(`(Payments) Error updating synchat_clients for clientId ${client.client_id} on invoice.payment_succeeded:`, updateError);
                        } else {
                            logger.info(`(Payments) Updated subscription for clientId ${client.client_id} on invoice.payment_succeeded: Status ${newStatus}, PeriodEnd ${currentPeriodEnd.toISOString()}`);
                        }
                    } else {
                        logger.warn(`(Payments) No client found with stripe_customer_id ${stripeCustomerId} for invoice.payment_succeeded.`);
                    }
                } catch (e) {
                    logger.error(`(Payments) Exception processing invoice.payment_succeeded ${invoice.id}:`, e);
                }
            } else {
                logger.info(`(Payments) Invoice ${invoice.id} (payment_succeeded) does not have a subscription or customer. Skipping detailed processing.`);
            }
            eventShouldBeRecorded = true;
            break;

        case 'invoice.payment_failed':
            const failedInvoice = event.data.object;
            logger.info(`(Payments) Processing invoice.payment_failed: ${failedInvoice.id}`);
            if (failedInvoice.subscription && failedInvoice.customer) {
                try {
                    const stripeCustomerId = failedInvoice.customer;
                    const subscriptionId = failedInvoice.subscription;

                    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                    const currentStatus = subscription.status; // e.g., 'past_due', 'unpaid'

                    const { data: client, error: fetchError } = await supabase
                        .from('synchat_clients')
                        .select('client_id')
                        .eq('stripe_customer_id', stripeCustomerId)
                        .single();

                    if (fetchError) {
                        logger.error(`(Payments) Error fetching client_id for stripe_customer_id ${stripeCustomerId} on invoice.payment_failed:`, fetchError);
                    } else if (client) {
                        const { error: updateError } = await supabase
                            .from('synchat_clients')
                            .update({
                                subscription_status: currentStatus,
                            })
                            .eq('client_id', client.client_id);
                        if (updateError) {
                            logger.error(`(Payments) Error updating synchat_clients for clientId ${client.client_id} on invoice.payment_failed:`, updateError);
                        } else {
                            logger.info(`(Payments) Updated subscription status for clientId ${client.client_id} to ${currentStatus} on invoice.payment_failed.`);
                        }
                    } else {
                        logger.warn(`(Payments) No client found with stripe_customer_id ${stripeCustomerId} for invoice.payment_failed.`);
                    }
                } catch (e) {
                    logger.error(`(Payments) Exception processing invoice.payment_failed ${failedInvoice.id}:`, e);
                }
            } else {
                logger.info(`(Payments) Invoice ${failedInvoice.id} (payment_failed) does not have a subscription or customer. Skipping detailed processing.`);
            }
            eventShouldBeRecorded = true;
            break;

        case 'customer.subscription.updated':
            const subscriptionUpdated = event.data.object;
            logger.info(`(Payments) Processing customer.subscription.updated: ${subscriptionUpdated.id}`);
            try {
                const subscriptionId = subscriptionUpdated.id;
                const newStatus = subscriptionUpdated.status;
                const newPeriodEnd = new Date(subscriptionUpdated.current_period_end * 1000);
                const stripeCustomerId = subscriptionUpdated.customer;

                // Prefer updating by subscription_id if it's reliably stored and unique. Otherwise, use customer_id.
                const { data: client, error: fetchError } = await supabase
                    .from('synchat_clients')
                    .select('client_id')
                    .eq('stripe_customer_id', stripeCustomerId) // Could also use .eq('subscription_id', subscriptionId) if preferred
                    .single();

                if (fetchError) {
                     logger.error(`(Payments) Error fetching client_id for stripe_customer_id ${stripeCustomerId} (or sub_id ${subscriptionId}) on customer.subscription.updated:`, fetchError);
                } else if (client) {
                    const { error: updateError } = await supabase
                        .from('synchat_clients')
                        .update({
                            subscription_status: newStatus,
                            subscription_current_period_end: newPeriodEnd.toISOString(),
                            // Ensure subscription_id is also updated if it changed, though less common for 'updated' event itself.
                            // If this event can change the subscription_id for a customer (rare), more complex logic needed.
                            subscription_id: subscriptionId
                        })
                        .eq('client_id', client.client_id);

                    if (updateError) {
                        logger.error(`(Payments) Error updating synchat_clients for clientId ${client.client_id} on customer.subscription.updated:`, updateError);
                    } else {
                        logger.info(`(Payments) Updated subscription for clientId ${client.client_id} on customer.subscription.updated: Status ${newStatus}, PeriodEnd ${newPeriodEnd.toISOString()}`);
                    }
                } else {
                     logger.warn(`(Payments) No client found for stripe_customer_id ${stripeCustomerId} (or sub_id ${subscriptionId}) for customer.subscription.updated.`);
                }
            } catch (e) {
                logger.error(`(Payments) Exception processing customer.subscription.updated ${subscriptionUpdated.id}:`, e);
            }
            eventShouldBeRecorded = true;
            break;

        case 'customer.subscription.deleted':
            const subscriptionDeleted = event.data.object;
            logger.info(`(Payments) Processing customer.subscription.deleted: ${subscriptionDeleted.id}`);
            try {
                const subscriptionId = subscriptionDeleted.id;
                const stripeCustomerId = subscriptionDeleted.customer;
                // status from event is usually 'canceled' but could be other things if ended due to non-payment.
                // We'll use a consistent internal status.
                const finalStatus = 'cancelled';

                const { data: client, error: fetchError } = await supabase
                    .from('synchat_clients')
                    .select('client_id')
                    .eq('stripe_customer_id', stripeCustomerId) // Or .eq('subscription_id', subscriptionId)
                    .single();

                if (fetchError) {
                    logger.error(`(Payments) Error fetching client_id for stripe_customer_id ${stripeCustomerId} (or sub_id ${subscriptionId}) on customer.subscription.deleted:`, fetchError);
                } else if (client) {
                    const { error: updateError } = await supabase
                        .from('synchat_clients')
                        .update({
                            subscription_status: finalStatus,
                            // Optionally, clear subscription_id and subscription_current_period_end or leave as is for history
                            // subscription_id: null,
                            // subscription_current_period_end: null
                        })
                        .eq('client_id', client.client_id);

                    if (updateError) {
                        logger.error(`(Payments) Error updating synchat_clients for clientId ${client.client_id} to status ${finalStatus} on customer.subscription.deleted:`, updateError);
                    } else {
                        logger.info(`(Payments) Marked subscription as ${finalStatus} for clientId ${client.client_id} on customer.subscription.deleted (SubID: ${subscriptionId}).`);
                    }
                } else {
                    logger.warn(`(Payments) No client found for stripe_customer_id ${stripeCustomerId} (or sub_id ${subscriptionId}) for customer.subscription.deleted.`);
                }
            } catch (e) {
                logger.error(`(Payments) Exception processing customer.subscription.deleted ${subscriptionDeleted.id}:`, e);
            }
            eventShouldBeRecorded = true;
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
