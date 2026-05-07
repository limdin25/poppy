import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const from = url.searchParams.get('from') || new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') || new Date().toISOString();

  const { data, error } = await supabase.rpc('analytics_busiest_hours', {
    p_business_id: auth.businessId,
    p_from: from,
    p_to: to,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({
    grid: (data || []).map((r: any) => ({
      dayOfWeek: Number(r.day_of_week),
      hour: Number(r.hour),
      count: Number(r.count),
    })),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
