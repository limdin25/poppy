import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  try {
    const { data: business } = await supabase
      .from('businesses')
      .select('currency, billing_active, activation_credit_paid')
      .eq('id', businessId)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    const isFree = !business.billing_active;

    const { data: period } = await supabase
      .from('billing_periods')
      .select('*')
      .eq('business_id', businessId)
      .eq('status', 'active')
      .order('period_start', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!period) {
      return new Response(JSON.stringify({
        current_period: null,
        is_free: isFree,
        activation_credit: {
          paid: business.activation_credit_paid || false,
          amount: 5,
          applied: false,
        },
      }), { status: 200 });
    }

    const periodEnd = new Date(period.period_end);
    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const totalBeforeCap = parseFloat(period.total_before_cap) || 0;
    const totalAmount = parseFloat(period.total_amount) || 0;
    const amountSaved = totalBeforeCap - totalAmount;

    return new Response(JSON.stringify({
      current_period: {
        id: period.id,
        start: period.period_start,
        end: period.period_end,
        booking_count: period.booking_count,
        total_amount: totalAmount,
        total_before_cap: totalBeforeCap,
        cap_amount: parseFloat(period.cap_amount) || 189,
        cap_reached: period.cap_reached,
        currency: period.currency,
        days_remaining: daysRemaining,
        amount_saved: amountSaved,
      },
      is_free: isFree,
      activation_credit: {
        paid: business.activation_credit_paid || false,
        amount: 5,
        applied: false,
      },
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
