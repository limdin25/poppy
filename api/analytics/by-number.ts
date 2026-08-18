import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { aggregateByAgent } from '../../src/features/analytics/aggregateByAgent.js';
import { formatPhone } from '../../src/core/lib/formatPhone.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * Per-number / per-A-B-variant voice metrics: calls, bookings, average hold
 * time, conversion. Each voice number is its own agent row; A-B variants (e.g.
 * the English voice with no phone) appear by their name. Bookings attribute via
 * the appointment's conversation → agent.
 */
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const bid = auth.businessId;

  const url = new URL(req.url);
  const from = url.searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString();
  const to = url.searchParams.get('to') || new Date().toISOString();

  const [agentsRes, channelsRes, callsRes, apptsRes] = await Promise.all([
    supabase.from('agents').select('id, name, is_default, sort_order').eq('business_id', bid).eq('agent_type', 'voice').order('sort_order'),
    supabase.from('channels').select('agent_id, config').eq('business_id', bid).eq('type', 'voice'),
    supabase.from('calls').select('agent_id, duration_seconds').eq('business_id', bid).gte('created_at', from).lte('created_at', to),
    supabase.from('appointments').select('agent_id, conversation:conversations(agent_id)').eq('business_id', bid).gte('created_at', from).lte('created_at', to),
  ]);

  const phoneByAgent: Record<string, string> = {};
  for (const ch of (channelsRes.data || []) as Array<{ agent_id: string | null; config: Record<string, unknown> | null }>) {
    if (ch.agent_id && ch.config?.phone) phoneByAgent[ch.agent_id] = String(ch.config.phone);
  }
  const metas = ((agentsRes.data || []) as Array<{ id: string; name: string | null }>).map((a) => ({
    agentId: a.id,
    label: phoneByAgent[a.id] ? formatPhone(phoneByAgent[a.id]) : (a.name || 'Voice line'),
  }));
  // supabase-js types the joined `conversation` as an array; at runtime a
  // to-one join is an object, hence the through-unknown cast.
  const apptAgents = ((apptsRes.data || []) as unknown as Array<{ agent_id: string | null; conversation: { agent_id: string | null } | null }>).map((p) => ({
    agent_id: p.agent_id ?? p.conversation?.agent_id ?? null,
  }));

  const rows = aggregateByAgent(metas, (callsRes.data || []) as Array<{ agent_id: string | null; duration_seconds: number | null }>, apptAgents);
  // Drop numbers that have never had a call AND never a booking, to keep it clean.
  const visible = rows.filter((r) => r.calls > 0 || r.bookings > 0);

  return new Response(JSON.stringify({ rows: visible.length ? visible : rows }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
