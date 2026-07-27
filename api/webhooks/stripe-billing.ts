import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
});

const WEBHOOK_SECRET = process.env.STRIPE_BILLING_WEBHOOK_SECRET!;

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
      // constructEventAsync — see the note in api/webhooks/stripe.ts. The sync
      // variant cannot work on edge (SubtleCryptoProvider throws) and 401s
      // every delivery.
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, WEBHOOK_SECRET);
    } catch (err: any) {
      console.error('[stripe-billing-webhook] signature verification failed:', err?.message);
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    switch (event.type) {
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const billingPeriodId = invoice.metadata?.billing_period_id;

        if (billingPeriodId) {
          await supabase.from('billing_periods').update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            stripe_invoice_status: 'paid',
          }).eq('id', billingPeriodId);
        } else {
          const customerId = invoice.customer as string;
          await supabase.from('billing_periods').update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            stripe_invoice_status: 'paid',
          })
            .eq('stripe_invoice_id', invoice.id);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const billingPeriodId = invoice.metadata?.billing_period_id;

        if (billingPeriodId) {
          await supabase.from('billing_periods').update({
            status: 'failed',
            stripe_invoice_status: 'failed',
          }).eq('id', billingPeriodId);
        } else {
          await supabase.from('billing_periods').update({
            status: 'failed',
            stripe_invoice_status: 'failed',
          }).eq('stripe_invoice_id', invoice.id);
        }
        break;
      }

      case 'invoice.voided': {
        const invoice = event.data.object as Stripe.Invoice;
        await supabase.from('billing_periods').update({
          status: 'void',
          stripe_invoice_status: 'void',
        }).eq('stripe_invoice_id', invoice.id);
        break;
      }

      default:
        break;
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('[stripe-billing-webhook] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
