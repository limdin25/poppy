import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

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

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 503 });
  }

  try {
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id, name, owner_id, currency, billing_active')
      .eq('billing_active', true);

    if (!businesses || businesses.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { status: 200 });
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStr = todayStart.toISOString();

    let sent = 0;

    for (const biz of businesses) {
      const [callsRes, messagesRes, bookingsRes, periodRes, ownerRes] = await Promise.all([
        supabase.from('calls')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', biz.id)
          .eq('status', 'completed')
          .gte('created_at', todayStr),

        supabase.from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('sender', 'ai')
          .eq('direction', 'outbound')
          .eq('status', 'sent')
          .gte('created_at', todayStr),

        supabase.from('booking_events')
          .select('contact_name, service_description, appointment_datetime, channel')
          .eq('business_id', biz.id)
          .gte('created_at', todayStr),

        supabase.from('billing_periods')
          .select('total_amount, cap_amount, cap_reached, booking_count, period_end, currency')
          .eq('business_id', biz.id)
          .eq('status', 'active')
          .maybeSingle(),

        supabase.auth.admin.getUserById(biz.owner_id),
      ]);

      const callCount = callsRes.count || 0;
      const messageCount = messagesRes.count || 0;
      const bookings = bookingsRes.data || [];
      const period = periodRes.data;
      const ownerEmail = ownerRes.data?.user?.email;

      if (callCount === 0 && messageCount === 0 && bookings.length === 0) continue;
      if (!ownerEmail) continue;

      const ownerName = ownerRes.data?.user?.user_metadata?.name || ownerEmail.split('@')[0];
      const firstName = ownerName.split(' ')[0];
      const currencySymbol = biz.currency === 'GBP' ? '\u00a3' : biz.currency === 'EUR' ? '\u20ac' : '$';

      let bookingsList = '';
      if (bookings.length > 0) {
        bookingsList = '\nBookings:\n' + bookings.map((b: any) => {
          const dt = b.appointment_datetime ? new Date(b.appointment_datetime) : null;
          const dateStr = dt ? dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'TBC';
          const name = b.contact_name || 'Customer';
          const shortName = name.split(' ')[0] + (name.split(' ')[1] ? ' ' + name.split(' ')[1][0] + '.' : '');
          return `  - ${shortName} — ${b.service_description || 'Appointment'} — ${dateStr} (via ${b.channel || 'unknown'})`;
        }).join('\n');
      }

      let billingLine = '';
      if (period) {
        const total = parseFloat(period.total_amount) || 0;
        const cap = parseFloat(period.cap_amount) || 189;
        billingLine = `\nBilling this month: ${currencySymbol}${total.toFixed(0)} / ${currencySymbol}${cap} cap (${period.booking_count} bookings)`;
        if (period.cap_reached) {
          const endDate = new Date(period.period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          billingLine += `\nYou've hit your cap — everything is free until ${endDate}!`;
        }
      }

      const body = `Hi ${firstName},

Here's what Elsie handled today:

Calls answered: ${callCount}
Messages replied to: ${messageCount}
Appointments booked: ${bookings.length}
${bookingsList}
${billingLine}

View full details: https://app.heyelsie.com/billing

— Elsie`;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'Elsie <elsie@heyelsie.com>',
          to: ownerEmail,
          subject: `Elsie's daily report for ${biz.name}`,
          text: body,
        }),
      });

      if (res.ok) sent++;
    }

    return new Response(JSON.stringify({ ok: true, sent }), { status: 200 });
  } catch (err: any) {
    console.error('[daily-summary] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
