// VSL £1 checkout. Public (the page has no login): POST {page_id, price_id}.
// Creates a Stripe Checkout Session: chosen reviews tier trialing 10 days
// + a one-time £1 line charged today, card always collected. Email is typed
// on Stripe's page; the webhook provisions the account after payment.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { VSL_PRICES, VSL_POUND_PRICE, advanceVslState } from '../lib/vsl-settings.js';
import { notifyFunnelEvent } from '../lib/vsl-notify.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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
      subscription_data: { trial_period_days: 10 },
      payment_method_collection: 'always',
      allow_promotion_codes: false,
      // Sessions self-expire in 1h so an abandoned tab can't be paid days later
      // against stale pricing.
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      success_url: 'https://go.heyelsie.com/continue?paid=1',
      cancel_url: `https://heyelsie.com/${page.slug}`,
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
