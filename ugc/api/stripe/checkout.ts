// Creates the 49 GBP credit-pack checkout session for the signed-in user.
// Every session is stamped metadata.app='ugc' so the shared Stripe account's
// other webhooks ignore it and ours ignores theirs.

import type { IncomingMessage, ServerResponse } from 'http';
import Stripe from 'stripe';
import { json, requireUser } from '../_lib/http';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.UGC_STRIPE_PRICE_ID;
  const appUrl = process.env.APP_URL;
  if (!secretKey || !priceId || !appUrl) {
    return json(res, 500, { error: 'Billing is not configured on the server' });
  }

  const user = await requireUser(req);
  if (!user) return json(res, 401, { error: 'Sign in first' });

  const stripe = new Stripe(secretKey);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { app: 'ugc', user_id: user.userId },
    payment_intent_data: {
      // Lets charge.refunded find its way back to the session for clawback.
      metadata: { app: 'ugc', user_id: user.userId },
    },
    ...(user.email ? { customer_email: user.email } : {}),
    success_url: `${appUrl}/?purchase=success`,
    cancel_url: `${appUrl}/?purchase=cancelled`,
  });

  return json(res, 200, { url: session.url });
}
