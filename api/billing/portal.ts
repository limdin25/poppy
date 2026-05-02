import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const APP_URL = process.env.APP_URL || 'https://app.poppy.ai';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { businessId } = await req.json();

    if (!businessId) {
      return new Response(JSON.stringify({ error: 'businessId is required' }), { status: 400 });
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('stripe_customer_id')
      .eq('id', businessId)
      .single();

    if (!business?.stripe_customer_id) {
      return new Response(
        JSON.stringify({ error: 'No billing account found for this business' }),
        { status: 404 },
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: business.stripe_customer_id,
      return_url: `${APP_URL}/billing`,
    });

    return new Response(JSON.stringify({ url: session.url }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
