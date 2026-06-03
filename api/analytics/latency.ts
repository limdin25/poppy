import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * AI response latency. Pairs each inbound message with the next outbound message
 * in the same conversation, measures the gap, and returns P50/P95/P99 + a
 * bucketed histogram. All from real `messages` rows — no synthetic data.
 */
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const from = url.searchParams.get('from') || new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = url.searchParams.get('to') || new Date().toISOString();

  const { data: convs } = await supabase
    .from('conversations')
    .select('id')
    .eq('business_id', auth.businessId);
  const convoIds = (convs || []).map((c) => c.id);
  if (!convoIds.length) {
    return new Response(JSON.stringify({ count: 0, p50: null, p95: null, p99: null, histogram: [] }), { status: 200 });
  }

  const { data: msgs } = await supabase
    .from('messages')
    .select('conversation_id, direction, created_at')
    .in('conversation_id', convoIds)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: true })
    .limit(5000);

  // Pair inbound → next outbound per conversation.
  const lastInbound = new Map<string, number>();
  const deltas: number[] = [];
  for (const m of msgs || []) {
    const t = new Date(m.created_at).getTime();
    if (m.direction === 'inbound') {
      if (!lastInbound.has(m.conversation_id)) lastInbound.set(m.conversation_id, t);
    } else if (m.direction === 'outbound') {
      const inAt = lastInbound.get(m.conversation_id);
      if (inAt != null) {
        const sec = (t - inAt) / 1000;
        if (sec >= 0 && sec < 86_400) deltas.push(sec); // ignore >24h gaps
        lastInbound.delete(m.conversation_id);
      }
    }
  }

  if (!deltas.length) {
    return new Response(JSON.stringify({ count: 0, p50: null, p95: null, p99: null, histogram: [] }), { status: 200 });
  }

  deltas.sort((a, b) => a - b);
  const pct = (p: number) => deltas[Math.min(deltas.length - 1, Math.floor((p / 100) * deltas.length))];

  const buckets = [
    { label: '0–1s', max: 1 },
    { label: '1–3s', max: 3 },
    { label: '3–10s', max: 10 },
    { label: '10–30s', max: 30 },
    { label: '30s–2m', max: 120 },
    { label: '2m–10m', max: 600 },
    { label: '10m+', max: Infinity },
  ];
  const histogram = buckets.map((b, i) => {
    const min = i === 0 ? 0 : buckets[i - 1].max;
    return { label: b.label, count: deltas.filter((d) => d >= min && d < b.max).length };
  });

  return new Response(
    JSON.stringify({
      count: deltas.length,
      p50: Math.round(pct(50) * 10) / 10,
      p95: Math.round(pct(95) * 10) / 10,
      p99: Math.round(pct(99) * 10) / 10,
      histogram,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
