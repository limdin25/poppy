import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
});

const APP_URL = process.env.APP_URL || 'https://app.heyelsie.com';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  try {
    const { priceId, returnPath } = await req.json() as { priceId?: string; returnPath?: string };

    if (!priceId) {
      return new Response(
        JSON.stringify({ error: 'priceId is required' }),
        { status: 400 },
      );
    }

    // Get business to check for existing Stripe customer
    const { data: business } = await supabase
      .from('businesses')
      .select('stripe_customer_id, owner_id')
      .eq('id', businessId)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    // Get owner email for Stripe
    let customerId = business.stripe_customer_id;

    if (!customerId && business.owner_id) {
      const { data: userData } = await supabase.auth.admin.getUserById(business.owner_id);
      const email = userData?.user?.email;

      if (email) {
        const customer = await stripe.customers.create({
          email,
          metadata: { business_id: businessId },
        });
        customerId = customer.id;
        await supabase
          .from('businesses')
          .update({ stripe_customer_id: customerId })
          .eq('id', businessId);
      }
    }

    // HeyElsie Reviews tiers: 10-day free trial, card on file, and the
    // checkout returns to the go.heyelsie.com app instead of the receptionist.
    const REVIEWS_PRICES = new Set([
      'price_1TvIMsLdAEhwWg6w9VFZFSJ0',
      'price_1TvIMtLdAEhwWg6wjAfYPZeq',
      'price_1TvIMtLdAEhwWg6wiQM7pKvR',
    ]);
    const isReviews = REVIEWS_PRICES.has(priceId);
    const GO_URL = process.env.GO_APP_URL || 'https://go.heyelsie.com';

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: isReviews
        ? `${GO_URL}${typeof returnPath === 'string' && returnPath.startsWith('/') ? returnPath : '/onboarding'}?paid=1`
        : `${APP_URL}/account/billing?success=true`,
      cancel_url: isReviews
        ? `${GO_URL}/onboarding?cancelled=1`
        : `${APP_URL}/account/billing?cancelled=true`,
      metadata: { business_id: businessId },
      ...(isReviews
        ? {
            subscription_data: { trial_period_days: 10 },
            payment_method_collection: 'always' as const,
          }
        : {}),
    };

    if (customerId) {
      sessionParams.customer = customerId;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return new Response(JSON.stringify({ url: session.url }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
