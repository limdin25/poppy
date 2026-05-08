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
    const body = await req.json().catch(() => ({})) as { payment_method_id?: string };

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
      const customerData: Stripe.CustomerCreateParams = {
        email,
        name: business.name,
        metadata: { business_id: business.id, currency },
      };
      if (body.payment_method_id) {
        customerData.payment_method = body.payment_method_id;
        customerData.invoice_settings = { default_payment_method: body.payment_method_id };
      }
      const customer = await stripe.customers.create(customerData);
      customerId = customer.id;
    } else if (body.payment_method_id) {
      await stripe.paymentMethods.attach(body.payment_method_id, { customer: customerId });
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: body.payment_method_id },
      });
    }

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
