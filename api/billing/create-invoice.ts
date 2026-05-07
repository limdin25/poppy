import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
});

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: expiredPeriods } = await supabase
      .from('billing_periods')
      .select('*, businesses!inner(stripe_customer_id, stripe_subscription_id, name)')
      .eq('status', 'active')
      .lte('period_end', today)
      .limit(100);

    if (!expiredPeriods || expiredPeriods.length === 0) {
      return new Response(JSON.stringify({ ok: true, invoiced: 0 }), { status: 200 });
    }

    let invoiced = 0;
    let voided = 0;

    for (const period of expiredPeriods) {
      const totalAmount = parseFloat(period.total_amount) || 0;
      const business = (period as any).businesses;

      if (totalAmount === 0) {
        await supabase.from('billing_periods').update({ status: 'void' }).eq('id', period.id);
        voided++;
      } else if (business?.stripe_customer_id && business?.stripe_subscription_id) {
        try {
          const currencyCode = (period.currency || 'GBP').toLowerCase();
          const amountInCents = Math.round(totalAmount * 100);

          const invoice = await stripe.invoices.create({
            customer: business.stripe_customer_id,
            auto_advance: true,
            collection_method: 'charge_automatically',
            currency: currencyCode,
            description: `Hey Elsie — ${period.booking_count} bookings (${period.period_start} to ${period.period_end})`,
            metadata: { billing_period_id: period.id, business_id: period.business_id },
          });

          await stripe.invoiceItems.create({
            customer: business.stripe_customer_id,
            invoice: invoice.id,
            amount: amountInCents,
            currency: currencyCode,
            description: `${period.booking_count} AI bookings × £10 (capped at £${period.cap_amount})`,
          });

          await stripe.invoices.finalizeInvoice(invoice.id);

          await supabase.from('billing_periods').update({
            status: 'invoiced',
            stripe_invoice_id: invoice.id,
            stripe_invoice_status: 'pending',
          }).eq('id', period.id);

          invoiced++;
        } catch (stripeErr: any) {
          console.error(`[create-invoice] Stripe error for period ${period.id}:`, stripeErr.message);
        }
      }

      const nextStart = new Date(period.period_end);
      nextStart.setDate(nextStart.getDate() + 1);
      const nextEnd = new Date(nextStart);
      nextEnd.setDate(nextEnd.getDate() + 30);

      const { data: existingNext } = await supabase
        .from('billing_periods')
        .select('id')
        .eq('business_id', period.business_id)
        .eq('period_start', nextStart.toISOString().split('T')[0])
        .maybeSingle();

      if (!existingNext) {
        await supabase.from('billing_periods').insert({
          business_id: period.business_id,
          period_start: nextStart.toISOString().split('T')[0],
          period_end: nextEnd.toISOString().split('T')[0],
          currency: period.currency,
          cap_amount: 200,
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, invoiced, voided }), { status: 200 });
  } catch (err: any) {
    console.error('[create-invoice] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
