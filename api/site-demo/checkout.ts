// This funnel's own Stripe checkout.
//
// Deliberately NOT api/vsl/checkout.ts, and it does not import from it. The two
// experiments have different prices, different trial terms and different copy,
// and Hugo needs to change one without touching the other. The shape is
// borrowed because it is proven; the code is separate because the funnels are.
//
// The offer: website plus AI receptionist, GBP 97 a month, GBP 1 today.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { advanceSiteState, logSiteEvent, siteUrl } from '../lib/site-demo.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any });

export const config = { runtime: 'edge' };

/** Days of trial after the GBP 1 entry charge, before the first full month. */
const TRIAL_DAYS = Number(process.env.SITE_DEMO_TRIAL_DAYS || 10);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function tokenValid(pageId: string, token: string): Promise<boolean> {
  const secret = process.env.SITE_BEACON_SECRET || '';
  if (!secret) return true;
  if (!token) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bucket = Math.floor(Date.now() / 3_600_000);
  for (const b of [bucket, bucket - 1]) {
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${pageId}:${b}`));
    const hex = Array.from(new Uint8Array(sig)).map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
    if (hex === token) return true;
  }
  return false;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const priceId = process.env.SITE_DEMO_PRICE_ID;
  const poundPriceId = process.env.SITE_DEMO_POUND_PRICE;
  if (!priceId || !poundPriceId) {
    // Hugo creates these in Stripe at go-live. Nothing is hardcoded, so an
    // unconfigured funnel refuses cleanly instead of charging a wrong amount.
    console.error('[site-demo/checkout] price env vars not configured');
    return json({ error: 'Checkout is not configured yet' }, 503);
  }

  let body: { page_id?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const pageId = String(body.page_id || '');
  if (!pageId) return json({ error: 'page_id required' }, 400);
  if (!(await tokenValid(pageId, String(body.token || '')))) return json({ error: 'Bad token' }, 403);

  const { data: page } = await supabase
    .from('wk_site_pages')
    .select('id, slug, contact_id, agent_id, business_name, owner_first, state')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) return json({ error: 'Not found' }, 404);
  if (page.state === 'converted') return json({ error: 'Already subscribed' }, 409);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [
      // The subscription itself, trialing. Nothing is taken for it today.
      { price: priceId, quantity: 1 },
      // The GBP 1 charged now. A real card charge, which is the whole point:
      // it proves the card works and it costs them something to say yes.
      { price: poundPriceId, quantity: 1 },
    ],
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      // On BOTH the subscription and the session. Without it here, later
      // customer.subscription.* events arrive with nothing to reconcile them
      // against, which is a bug the VSL side had to fix after the fact.
      metadata: {
        site_page_id: page.id,
        contact_id: page.contact_id,
        agent_id: page.agent_id,
        price_id: priceId,
      },
    },
    client_reference_id: page.id,
    payment_method_collection: 'always',
    allow_promotion_codes: false,
    // An abandoned tab must not be payable days later at stale pricing.
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    // {CHECKOUT_SESSION_ID} is a Stripe template token. It must NOT be URL
    // encoded or Stripe substitutes nothing and the success page cannot poll.
    success_url: `${process.env.GO_APP_URL || 'https://go.heyelsie.com'}/continue?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    // from=stripe so the page knows this is a return, not a fresh arrival, and
    // does not log it as another click.
    cancel_url: `${siteUrl(page.slug)}?from=stripe`,
    metadata: {
      site_page_id: page.id,
      contact_id: page.contact_id,
      agent_id: page.agent_id,
      price_id: priceId,
    },
  });

  await logSiteEvent(page.id, 'checkout_start', { session_id: session.id, price_id: priceId });
  await advanceSiteState(page, 'checkout_sent');

  return json({ url: session.url });
}
