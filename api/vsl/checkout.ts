// VSL £1 checkout. Public (the page has no login): POST {page_id, price_id}.
// Creates a Stripe Checkout Session: chosen reviews tier trialing 10 days
// + a one-time £1 line charged today, card always collected. Email is typed
// on Stripe's page; the webhook provisions the account after payment.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { VSL_PRICES, VSL_POUND_PRICE, advanceVslState } from '../lib/vsl-settings.js';
import { notifyFunnelEvent } from '../lib/vsl-notify.js';
import { TRIAL_DAYS } from '../lib/review-plans.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const GO_URL = process.env.GO_APP_URL || 'https://go.heyelsie.com';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
});

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body: { page_id?: string; price_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const pageId = (body.page_id || '').trim();
  const priceId = (body.price_id || '').trim();
  if (!pageId || !VSL_PRICES[priceId]) {
    return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
  }

  const { data: page } = await supabase
    .from('wk_vsl_pages')
    .select('*')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) {
    return new Response(JSON.stringify({ error: 'Unknown page' }), { status: 404 });
  }
  if (page.state === 'paid') {
    return new Response(JSON.stringify({ error: 'Already subscribed' }), { status: 409 });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        { price: priceId, quantity: 1 },
        // The £1 "first 10 days" — one-time, charged today while the
        // subscription itself trials for 10 days.
        { price: VSL_POUND_PRICE, quantity: 1 },
      ],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        // The Subscription object used to carry NOTHING, so every later
        // customer.subscription.* event was unreconcilable back to the funnel.
        metadata: {
          vsl_page_id: page.id,
          contact_id: page.contact_id,
          agent_id: page.agent_id,
          price_id: priceId,
        },
      },
      client_reference_id: page.id,
      payment_method_collection: 'always',
      allow_promotion_codes: false,
      // Sessions self-expire in 1h so an abandoned tab can't be paid days later
      // against stale pricing.
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      // {CHECKOUT_SESSION_ID} is a Stripe template token — it must NOT be
      // URL-encoded. /continue uses it to confirm the payment, pre-fill the
      // email and poll until provisioning lands, instead of asking a customer
      // who just paid to retype the address they used seconds ago.
      success_url: `${GO_URL}/continue?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://heyelsie.com/${page.slug}?from=stripe`,
      metadata: {
        vsl_page_id: page.id,
        contact_id: page.contact_id,
        agent_id: page.agent_id,
        price_id: priceId,
      },
    });

    const { error: evErr } = await supabase.from('wk_vsl_events').insert({
      page_id: page.id,
      type: 'checkout_start',
      meta: { price_id: priceId, session_id: session.id },
    });
    if (evErr) console.error('[vsl/checkout] event insert failed:', evErr);
    const adv = await advanceVslState(page, 'checkout_started');
    // Only on the real transition — a second checkout attempt is not news.
    if (adv?.advanced) await notifyFunnelEvent({ page, kind: 'vsl_checkout_start' });

    return new Response(JSON.stringify({ url: session.url }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
