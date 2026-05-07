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

  const { data, error } = await supabase.rpc('analytics_ai_performance', {
    p_business_id: auth.businessId,
    p_from: from,
    p_to: to,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const row = data?.[0] || { auto_sent: 0, drafted: 0, human_sent: 0, total: 0 };

  return new Response(JSON.stringify({
    autoSent: Number(row.auto_sent),
    drafted: Number(row.drafted),
    humanSent: Number(row.human_sent),
    total: Number(row.total),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
