import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const {
      business_id,
      appointment_id,
      contact_id,
      contact_name,
      service_description,
      appointment_datetime,
      channel,
    } = await req.json() as {
      business_id: string;
      appointment_id?: string;
      contact_id?: string;
      contact_name?: string;
      service_description?: string;
      appointment_datetime?: string;
      channel?: string;
    };

    if (!business_id) {
      return new Response(JSON.stringify({ error: 'business_id required' }), { status: 400 });
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('currency, billing_active')
      .eq('id', business_id)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    const isFree = !business.billing_active;
    const currency = business.currency || 'GBP';
    const today = new Date().toISOString().split('T')[0];

    let { data: period } = await supabase
      .from('billing_periods')
      .select('*')
      .eq('business_id', business_id)
      .eq('status', 'active')
      .lte('period_start', today)
      .gte('period_end', today)
      .maybeSingle();

    if (!period) {
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + 30);
      const { data: newPeriod } = await supabase
        .from('billing_periods')
        .insert({
          business_id,
          period_start: today,
          period_end: periodEnd.toISOString().split('T')[0],
          currency,
          cap_amount: 200,
        })
        .select('*')
        .single();
      period = newPeriod;
    }

    if (!period) {
      return new Response(JSON.stringify({ error: 'Failed to get billing period' }), { status: 500 });
    }

    const currentTotal = parseFloat(period.total_amount) || 0;
    const capAmount = parseFloat(period.cap_amount) || 200;
    const capped = currentTotal >= capAmount;
    const amountBilled = capped ? 0 : Math.min(10, capAmount - currentTotal);

    const { data: bookingEvent, error: insertErr } = await supabase
      .from('booking_events')
      .insert({
        business_id,
        billing_period_id: period.id,
        appointment_id: appointment_id || null,
        contact_id: contact_id || null,
        contact_name: contact_name || null,
        service_description: service_description || null,
        appointment_datetime: appointment_datetime || null,
        channel: channel || null,
        amount_raw: 10,
        amount_billed: amountBilled,
        currency,
        capped,
      })
      .select('*')
      .single();

    if (insertErr) {
      console.error('[record-booking] insert error:', insertErr);
      return new Response(JSON.stringify({ error: 'Failed to record booking' }), { status: 500 });
    }

    const newTotal = currentTotal + amountBilled;
    const newTotalBeforeCap = (parseFloat(period.total_before_cap) || 0) + 10;
    const newCapReached = newTotal >= capAmount;

    await supabase.from('billing_periods').update({
      booking_count: (period.booking_count || 0) + 1,
      total_amount: newTotal,
      total_before_cap: newTotalBeforeCap,
      ...(newCapReached && !period.cap_reached ? { cap_reached: true, cap_reached_at: new Date().toISOString() } : {}),
    }).eq('id', period.id);

    return new Response(JSON.stringify({ ok: true, booking_event: bookingEvent, simulated: isFree }), { status: 200 });
  } catch (err: any) {
    console.error('[record-booking] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
