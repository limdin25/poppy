import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { provisionVslSale } from '../lib/vsl-provision.js';
import { provisionSiteSale } from '../lib/site-provision.js';
import { REVIEWS_PRICE_TO_PLAN, CHEAPEST_PLAN_GBP } from '../lib/review-plans.js';
import { ensureNumberRequest } from '../lib/vsl-provision.js';
import { sendReviewsWelcome } from '../lib/reviews-welcome.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
});

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

const PRICE_TO_PLAN: Record<string, string> = {
  // Legacy receptionist product — not in the reviews canon.
  'price_1TTj1DLdAEhwWg6w9uuBcjJl': 'starter',
  'price_1TTj1DLdAEhwWg6wERoybYsY': 'professional',
  'price_1TTj1DLdAEhwWg6w2l8IOzJ9': 'business',
  // HeyElsie Reviews tiers, from the canon. Adding a price here by hand was
  // the easiest thing in the codebase to forget — and forgetting it means a
  // paying customer silently gets no plan written.
  ...REVIEWS_PRICE_TO_PLAN,
};

function planFromSubscription(subscription: Stripe.Subscription): string | null {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  return priceId ? PRICE_TO_PLAN[priceId] ?? null : null;
}

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const rawBody = await req.text();
    const signature = (req.headers as any).get?.('stripe-signature') || '';

    let event: Stripe.Event;
    try {
      // MUST be constructEventAsync. This handler runs on edge, where the Stripe
      // SDK resolves its `worker` export to SubtleCryptoProvider — whose
      // synchronous computeHMACSignature is a hard throw. The sync
      // constructEvent therefore returns 401 on EVERY delivery, silently.
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error('[stripe-webhook] signature verification failed:', err?.message);
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // VSL page sale (no account existed before checkout): provision the
        // whole account from the session + page row. Separate metadata key, so
        // the existing business_id flow below is untouched. Let it THROW on
        // failure — the outer catch returns 500 so Stripe retries rather than
        // leaving a paying customer with no account.
        if (session.metadata?.vsl_page_id) {
          await provisionVslSale(session);
          break;
        }

        // Site demo sale. Its own metadata key and its own provisioning, so the
        // two funnels can change independently. Same reasoning as above: let it
        // THROW, so the outer catch 500s and Stripe retries rather than leaving
        // someone who paid with no account.
        if (session.metadata?.site_page_id) {
          await provisionSiteSale(session);
          break;
        }

        const businessId = session.metadata?.business_id;
        if (businessId && session.subscription) {
          // Same claim as the VSL path, so a duplicate delivery can't double-write.
          const { data: claimed } = await supabase.rpc('claim_stripe_provision', {
            p_key: `provision:${session.id}`,
          });
          if (!claimed) break;

          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          const plan = planFromSubscription(sub);
          // Take the real status from Stripe rather than assuming 'active' — a
          // trialing subscription written as 'active' loses the customer their
          // "Free trial" pill and contradicts their own billing page.
          const { error: bizErr } = await supabase
            .from('businesses')
            .update({
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              billing_status: sub.status === 'trialing' ? 'trialing' : 'active',
              ...(plan && { plan }),
            })
            .eq('id', businessId);
          if (bizErr) throw new Error(`checkout.session.completed: ${bizErr.message}`);

          await supabase.rpc('finish_stripe_provision', {
            p_key: `provision:${session.id}`,
            p_business_id: businessId,
          });

          // Reviews accounts need a sender number queued or they can never send.
          if (plan?.startsWith('reviews_')) {
            await ensureNumberRequest(businessId, 'Self-serve reviews signup');
            await sendReviewsWelcome(businessId).catch((e) =>
              console.error('[stripe-webhook] welcome email deferred to cron:', (e as Error).message));
          }
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        // Only a real renewal flips a business to 'active'. The trial-start
        // invoice (billing_reason 'subscription_create') now carries the £1
        // entry charge, so it IS paid — writing 'active' off it would race the
        // 'trialing' written at provisioning time and land non-deterministically.
        // customer.subscription.created/updated is the authority on status.
        if (invoice.billing_reason === 'subscription_cycle') {
          await supabase
            .from('businesses')
            .update({ billing_status: 'active' })
            .eq('stripe_customer_id', customerId);
        }

        // Referral program: the invitee's first real RENEWAL unlocks the
        // £100/£100 reward. This used to be "any invoice over £0" on the
        // assumption that trials invoice £0 — an assumption the £1 entry charge
        // breaks for every single customer on day 0, handing out £100 for £1.
        // Belt and braces: the amount must also clear the cheapest plan.
        if (
          invoice.billing_reason === 'subscription_cycle' &&
          (invoice.amount_paid ?? 0) >= CHEAPEST_PLAN_GBP * 100
        ) {
          const { data: paidBiz } = await supabase
            .from('businesses')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .maybeSingle();
          if (paidBiz) {
            await supabase
              .from('review_referrals')
              .update({ status: 'paid' })
              .eq('invitee_business_id', paidBiz.id)
              .in('status', ['invited', 'signed_up']);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        await supabase
          .from('businesses')
          .update({ billing_status: 'past_due' })
          .eq('stripe_customer_id', customerId);
        break;
      }

      // created + updated share a handler: with invoice.paid no longer writing
      // status, the subscription events are the single source of truth for it.
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const status = subscription.status === 'active' ? 'active' : subscription.status;
        const plan = planFromSubscription(subscription);
        await supabase
          .from('businesses')
          .update({
            billing_status: status,
            stripe_subscription_id: subscription.id,
            ...(plan && { plan }),
          })
          .eq('stripe_customer_id', customerId);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        await supabase
          .from('businesses')
          .update({
            billing_status: 'cancelled',
            stripe_subscription_id: null,
            plan: 'trial',
          })
          .eq('stripe_customer_id', customerId);
        break;
      }

      default:
        // Unhandled event type — acknowledge anyway
        break;
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
