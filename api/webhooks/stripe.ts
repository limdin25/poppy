import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { provisionVslSale } from '../lib/vsl-provision.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
});

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

const PRICE_TO_PLAN: Record<string, string> = {
  'price_1TTj1DLdAEhwWg6w9uuBcjJl': 'starter',
  'price_1TTj1DLdAEhwWg6wERoybYsY': 'professional',
  'price_1TTj1DLdAEhwWg6w2l8IOzJ9': 'business',
  // HeyElsie Reviews tiers (product prod_Uv8eim0pBOmEGZ)
  'price_1TvIMsLdAEhwWg6w9VFZFSJ0': 'reviews_starter',
  'price_1TvIMtLdAEhwWg6wjAfYPZeq': 'reviews_growth',
  'price_1TvIMtLdAEhwWg6wiQM7pKvR': 'reviews_pro',
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
      event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    } catch {
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

        const businessId = session.metadata?.business_id;
        if (businessId && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          const plan = planFromSubscription(sub);
          await supabase
            .from('businesses')
            .update({
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
              billing_status: 'active',
              ...(plan && { plan }),
            })
            .eq('id', businessId);
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        await supabase
          .from('businesses')
          .update({ billing_status: 'active' })
          .eq('stripe_customer_id', customerId);

        // Referral program: the invitee's first PAID invoice (trials invoice £0,
        // which Stripe doesn't emit invoice.paid for) unlocks the £100/£100 reward.
        if ((invoice.amount_paid ?? 0) > 0) {
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
