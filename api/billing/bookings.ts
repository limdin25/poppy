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
    const periodId = url.searchParams.get('period_id');
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = parseInt(url.searchParams.get('per_page') || '20', 10);
    const offset = (page - 1) * perPage;

    let query = supabase
      .from('booking_events')
      .select('*', { count: 'exact' })
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    if (periodId) {
      query = query.eq('billing_period_id', periodId);
    }

    const { data: bookings, count } = await query;

    return new Response(JSON.stringify({
      bookings: (bookings || []).map((b: any) => ({
        id: b.id,
        created_at: b.created_at,
        contact_name: b.contact_name,
        service_description: b.service_description,
        appointment_datetime: b.appointment_datetime,
        channel: b.channel,
        amount_billed: parseFloat(b.amount_billed) || 0,
        capped: b.capped,
        currency: b.currency,
      })),
      total: count || 0,
      page,
      per_page: perPage,
    }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
