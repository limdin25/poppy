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
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = parseInt(url.searchParams.get('per_page') || '20', 10);
    const offset = (page - 1) * perPage;

    const { data: periods, count } = await supabase
      .from('billing_periods')
      .select('*', { count: 'exact' })
      .eq('business_id', businessId)
      .neq('status', 'active')
      .order('period_start', { ascending: false })
      .range(offset, offset + perPage - 1);

    return new Response(JSON.stringify({
      periods: (periods || []).map((p: any) => ({
        id: p.id,
        start: p.period_start,
        end: p.period_end,
        booking_count: p.booking_count,
        total_amount: parseFloat(p.total_amount) || 0,
        total_before_cap: parseFloat(p.total_before_cap) || 0,
        cap_reached: p.cap_reached,
        currency: p.currency,
        status: p.status,
        paid_at: p.paid_at,
        stripe_invoice_id: p.stripe_invoice_id,
      })),
      total: count || 0,
      page,
      per_page: perPage,
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
