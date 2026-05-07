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

const PRICE_MAP: Record<string, string> = {
  GBP: process.env.STRIPE_BOOKING_PRICE_GBP || '',
  USD: process.env.STRIPE_BOOKING_PRICE_USD || '',
  EUR: process.env.STRIPE_BOOKING_PRICE_EUR || '',
};

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId, businessId } = auth;

  try {
    const { payment_method_id } = await req.json() as { payment_method_id: string };

    if (!payment_method_id) {
      return new Response(JSON.stringify({ error: 'payment_method_id required' }), { status: 400 });
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('id, name, currency, billing_active, stripe_customer_id')
      .eq('id', businessId)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    if (business.billing_active) {
      return new Response(JSON.stringify({ error: 'Billing already active' }), { status: 400 });
    }

    const currency = business.currency || 'GBP';
    const bookingPriceId = PRICE_MAP[currency];

    if (!bookingPriceId) {
      return new Response(JSON.stringify({ error: `No booking price configured for ${currency}` }), { status: 500 });
    }

    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const email = userData?.user?.email || '';

    let customerId = business.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        name: business.name,
        metadata: { business_id: business.id, currency },
        payment_method: payment_method_id,
        invoice_settings: { default_payment_method: payment_method_id },
      });
      customerId = customer.id;
    } else {
      await stripe.paymentMethods.attach(payment_method_id, { customer: customerId });
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: payment_method_id },
      });
    }

    await stripe.paymentIntents.create({
      amount: 500,
      currency: currency.toLowerCase(),
      customer: customerId,
      payment_method: payment_method_id,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: 'Hey Elsie activation credit — covers first booking',
      metadata: { business_id: business.id, type: 'activation_credit' },
    });

    await stripe.customers.createBalanceTransaction(customerId, {
      amount: -500,
      currency: currency.toLowerCase(),
      description: 'Activation credit — applied to first booking',
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: bookingPriceId }],
    });

    const today = new Date().toISOString().split('T')[0];
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 30);

    await supabase.from('businesses').update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      billing_active: true,
      billing_started_at: new Date().toISOString(),
      activation_credit_paid: true,
    }).eq('id', business.id);

    await supabase.from('billing_periods').insert({
      business_id: business.id,
      period_start: today,
      period_end: periodEnd.toISOString().split('T')[0],
      currency,
      cap_amount: 189,
    });

    return new Response(JSON.stringify({ ok: true, subscription_id: subscription.id }), { status: 200 });
  } catch (err: any) {
    console.error('[billing/activate] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
