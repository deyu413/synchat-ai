// synchat-ai-backend/src/controllers/paymentsController.js
// Controller for handling Stripe payment processing.

import 'dotenv/config'; // Ensure environment variables are loaded
import Stripe from 'stripe';

// Initialize Stripe with the secret key from environment variables
// Ensure STRIPE_SECRET_KEY is set in your Vercel environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Ensure STRIPE_WEBHOOK_SECRET is set in Vercel for webhook verification
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Creates a Stripe Checkout Session for a given priceId.
 */
export const createCheckoutSession = async (req, res) => {
    console.log('paymentsController.createCheckoutSession called');
    const { priceId, customerEmail } = req.body; // priceId from your Stripe Dashboard, customerEmail for Stripe customer
    const clientId = req.user?.id; // Assuming protectRoute adds user object with id

    if (!priceId) {
        return res.status(400).json({ error: 'Price ID is required.' });
    }
    if (!clientId) {
        // Should be caught by protectRoute, but good to double check
        return res.status(401).json({ error: 'User not authenticated.' });
    }
    
    // Determine customer email: use provided, or fallback to user's email if available from token
    const finalCustomerEmail = customerEmail || req.user?.email; 
    if (!finalCustomerEmail) {
        console.warn('(Payments) Customer email not provided and not found in user token.');
        // return res.status(400).json({ error: 'Customer email is required.' }); // Decide if strictly required
    }


    // YOU NEED TO CONFIGURE THESE URLs IN YOUR VERCEL ENVIRONMENT OR FRONTEND
    const YOUR_DOMAIN = process.env.FRONTEND_URL || 'http://localhost:3000'; // Fallback for local dev

    try {
        let stripeCustomer;
        if (finalCustomerEmail) {
            const existingCustomers = await stripe.customers.list({ email: finalCustomerEmail, limit: 1 });
            if (existingCustomers.data.length > 0) {
                stripeCustomer = existingCustomers.data[0];
                console.log(`(Payments) Existing Stripe customer found: ${stripeCustomer.id} for email ${finalCustomerEmail}`);
            } else {
                stripeCustomer = await stripe.customers.create({
                    email: finalCustomerEmail,
                    name: req.user?.name || undefined, // Optional: if you have user's name
                    metadata: {
                        app_client_id: clientId, 
                    },
                });
                console.log(`(Payments) New Stripe customer created: ${stripeCustomer.id} for email ${finalCustomerEmail}`);
            }
        } else {
            // Handle case where no email is available - might need to adjust logic
            // or rely on Stripe to collect email during checkout if not provided here.
            // For now, proceeding without a customer if no email. Stripe will create a guest.
            console.warn('(Payments) Proceeding without specific Stripe customer due to missing email.');
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
            // If customer not created yet but email is available, pass it to checkout
            sessionParams.customer_email = finalCustomerEmail;
        }
        // If no customer and no email, Stripe will require email on their page.

        const session = await stripe.checkout.sessions.create(sessionParams);

        console.log(`(Payments) Stripe Checkout session created: ${session.id}`);
        res.status(200).json({ sessionId: session.id, checkoutUrl: session.url });

    } catch (error) {
        console.error('(Payments) Error creating Stripe Checkout session:', error);
        res.status(500).json({ error: { message: error.message } });
    }
};

/**
 * Handles incoming webhooks from Stripe.
 */
export const handleStripeWebhook = async (req, res) => {
    console.log('paymentsController.handleStripeWebhook received a request');
    const sig = req.headers['stripe-signature'];

    if (!endpointSecret) {
        console.error('(Payments) CRITICAL: STRIPE_WEBHOOK_SECRET is not set. Cannot verify webhook.');
        return res.status(400).send('Webhook secret not configured.');
    }
    if (!sig) {
        console.warn('(Payments) Webhook received without stripe-signature. Ignoring.');
        return res.status(400).send('No signature provided.');
    }
    if (!req.body) {
         console.warn('(Payments) Webhook received without body. Ignoring.');
        return res.status(400).send('No body provided.');
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        console.log(`(Payments) Stripe webhook event verified: ${event.id}, type: ${event.type}`);
    } catch (err) {
        console.error(`(Payments) Webhook signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log(`(Payments) Checkout session completed: ${session.id}`);
            // TODO:
            // 1. Retrieve customer details (session.customer) and your internal clientId from session.metadata.app_client_id.
            // 2. Check if you've already processed this event (idempotency using event.id or session.id).
            // 3. Provision the subscription or product for the customer.
            //    - Update your database: mark user as subscribed, store stripe_customer_id, subscription_id, plan_id, status, current_period_end.
            //    - Example: await databaseService.activateClientSubscription(session.metadata.app_client_id, session.customer, session.subscription, session.display_items[0].plan.id, 'active', new Date(session.current_period_end * 1000));
            console.log(`(Payments) TODO: Fulfill order for session: ${session.id}, Client ID: ${session.metadata.app_client_id}, Stripe Customer ID: ${session.customer}, Stripe Subscription ID: ${session.subscription}`);
            break;

        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            console.log(`(Payments) Invoice payment succeeded: ${invoice.id} for customer ${invoice.customer}, Subscription: ${invoice.subscription}`);
            // TODO:
            // - If this is for a subscription renewal, update current_period_end in your database.
            // - Log payment for records.
            // - Handle if subscription was past_due and is now active.
            // Example: const { customer, subscription, lines } = invoice;
            //          const newPeriodEnd = new Date(lines.data[0].period.end * 1000);
            //          await databaseService.updateSubscriptionPeriod(subscription, newPeriodEnd);
            break;

        case 'invoice.payment_failed':
            const failedInvoice = event.data.object;
            console.log(`(Payments) Invoice payment failed: ${failedInvoice.id} for customer ${failedInvoice.customer}`);
            // TODO:
            // - Notify the customer about the payment failure.
            // - Update subscription status in your database (e.g., to 'past_due' or 'unpaid').
            break;

        case 'customer.subscription.updated':
            const subscriptionUpdated = event.data.object;
            console.log(`(Payments) Customer subscription updated: ${subscriptionUpdated.id}, Status: ${subscriptionUpdated.status}`);
            // TODO:
            // - Handle changes in subscription status (e.g., 'active', 'past_due', 'canceled', 'unpaid').
            // - Update your database with the new status and current_period_end.
            // Example: const { id, status, current_period_end, customer, plan } = subscriptionUpdated;
            //          await databaseService.updateClientSubscriptionStatus(id, status, new Date(current_period_end * 1000));
            break;

        case 'customer.subscription.deleted': // Occurs when a subscription is canceled, at the end of the billing period or immediately.
            const subscriptionDeleted = event.data.object;
            console.log(`(Payments) Customer subscription deleted: ${subscriptionDeleted.id}, Status: ${subscriptionDeleted.status}`);
            // TODO:
            // - Mark the subscription as 'canceled' in your database. The status from Stripe will reflect its final state.
            // Example: await databaseService.cancelClientSubscription(subscriptionDeleted.id, subscriptionDeleted.status, new Date(subscriptionDeleted.current_period_end * 1000));
            break;
            
        default:
            console.log(`(Payments) Unhandled Stripe event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
};
