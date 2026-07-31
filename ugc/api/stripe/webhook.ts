// The ugc webhook endpoint, with its OWN signing secret. Signature verified
// on the RAW body; the decision itself is the pure decideWebhook (tested);
// the RPCs are idempotent so Stripe retries and replays are no-ops. RPC
// failures return 500 ON PURPOSE: Stripe retries until the credit lands.

import type { IncomingMessage, ServerResponse } from 'http';
import Stripe from 'stripe';
import { json, readRawBody, serviceRpc } from '../_lib/http.js';
import { decideWebhook } from '../../src/core/stripeWebhook.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) return json(res, 500, { error: 'Webhook is not configured' });

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') return json(res, 400, { error: 'Missing signature' });

  const raw = await readRawBody(req);
  const stripe = new Stripe(secretKey);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, webhookSecret);
  } catch (e) {
    return json(res, 401, { error: `Bad signature: ${(e as Error).message}` });
  }

  const decision = decideWebhook(event as never);

  if (decision.action === 'ignore') return json(res, 200, { ignored: decision.why });

  if (decision.action === 'apply_purchase') {
    const r = await serviceRpc('ugc_apply_purchase', {
      p_session_id: decision.sessionId,
      p_user_id: decision.userId,
      p_credits: decision.credits,
      p_amount_pence: decision.amountPence,
    });
    if (!r.ok) return json(res, 500, { error: `apply_purchase failed: ${await r.text()}` });
    return json(res, 200, { credited: decision.credits });
  }

  const r = await serviceRpc('ugc_clawback', { p_session_id: decision.sessionId });
  if (!r.ok) return json(res, 500, { error: `clawback failed: ${await r.text()}` });
  return json(res, 200, { clawedBack: decision.sessionId });
}
