// Public checkout-session status, polled by go.heyelsie.com/continue after
// Stripe redirects a buyer back.
//
// WHY THIS EXISTS: the redirect is instant, the webhook is asynchronous. Before
// this, a customer who had just paid landed on a page that asked them to retype
// their email, tried to send them a login code, and showed a raw Supabase error
// because their account didn't exist yet. There was no confirmation they had
// paid at all.
//
// It ALSO provisions as a fallback (from attempt 3, ~6s in, giving the webhook
// first crack). Provisioning is the one operation where failure means we took
// money and delivered nothing, so it must not depend on a single mechanism.
// That is only safe because of the stripe_provisioning claim ledger — without
// it, two concurrent provisioning runs would collide on businesses.slug.
//
// SECURITY TRADEOFF, stated deliberately: whoever holds the cs_… id can read
// the email typed at checkout. Session ids are high-entropy and appear only in
// the buyer's own URL bar and the Stripe dashboard — the same trust model as
// any Stripe success page. Nothing else about the account is returned.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { provisionVslSale } from '../lib/vsl-provision.js';
import { ensureNumberRequest } from '../lib/vsl-provision.js';
import { sendReviewsWelcome } from '../lib/reviews-welcome.js';
import { REVIEWS_PRICE_TO_PLAN } from '../lib/review-plans.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
});

export const config = { runtime: 'edge' };

const SESSION_ID = /^cs_[A-Za-z0-9_]{10,200}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(req.url);
  const sessionId = (url.searchParams.get('session_id') || '').trim();
  const attempt = Number(url.searchParams.get('attempt') || '1') || 1;

  // Shape-check before spending a Stripe call — this endpoint is public and
  // there is no rate-limiting infrastructure in this stack.
  if (!SESSION_ID.test(sessionId)) return json({ error: 'Bad session id' }, 400);

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return json({ error: 'Unknown session' }, 404);
  }

  if (session.status === 'expired') {
    return json({ paid: false, ready: false, expired: true });
  }

  // 'no_payment_required' covers any £0 session (legacy, or a future 100%
  // coupon). Checking only 'paid' would strand those buyers.
  const paid =
    session.status === 'complete' &&
    (session.payment_status === 'paid' || session.payment_status === 'no_payment_required');

  if (!paid) return json({ paid: false, ready: false, expired: false });

  const claimKey = `provision:${session.id}`;
  let ledger = await readLedger(claimKey);

  // Fallback provisioning. Deliberately not on the first poll — the webhook is
  // the primary path and usually wins; this is the safety net for when it
  // doesn't (misconfigured endpoint, Stripe outage, a failed earlier run).
  if (ledger?.status !== 'done' && attempt >= 3) {
    try {
      if (session.metadata?.vsl_page_id) {
        await provisionVslSale(session);
      } else if (session.metadata?.business_id) {
        await provisionSelfServe(session, session.metadata.business_id, claimKey);
      }
    } catch (e) {
      // Never 500 the poller — it will simply try again on the next tick.
      console.error('[session-status] fallback provision failed:', (e as Error).message);
    }
    ledger = await readLedger(claimKey);
  }

  return json({
    paid: true,
    ready: ledger?.status === 'done',
    expired: false,
    email: session.customer_details?.email ?? null,
  });
}

async function readLedger(key: string): Promise<{ status: string } | null> {
  const { data } = await supabase
    .from('stripe_provisioning')
    .select('status')
    .eq('key', key)
    .maybeSingle();
  return data ?? null;
}

/** Mirror of the webhook's business_id branch, for the fallback path. */
async function provisionSelfServe(
  session: Stripe.Checkout.Session,
  businessId: string,
  claimKey: string,
): Promise<void> {
  const { data: claimed } = await supabase.rpc('claim_stripe_provision', { p_key: claimKey });
  if (!claimed) return;

  const subId = session.subscription as string | null;
  if (!subId) return;
  const sub = await stripe.subscriptions.retrieve(subId);
  const priceId = sub.items?.data?.[0]?.price?.id ?? '';
  const plan = REVIEWS_PRICE_TO_PLAN[priceId] ?? null;

  const { error } = await supabase
    .from('businesses')
    .update({
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: subId,
      billing_status: sub.status === 'trialing' ? 'trialing' : 'active',
      ...(plan && { plan }),
    })
    .eq('id', businessId);
  if (error) {
    await supabase.rpc('fail_stripe_provision', { p_key: claimKey, p_error: error.message });
    throw new Error(error.message);
  }

  await supabase.rpc('finish_stripe_provision', { p_key: claimKey, p_business_id: businessId });

  if (plan?.startsWith('reviews_')) {
    await ensureNumberRequest(businessId, 'Self-serve reviews signup');
    await sendReviewsWelcome(businessId).catch((e) =>
      console.error('[session-status] welcome email deferred to cron:', (e as Error).message));
  }
}
