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
  const channel = url.searchParams.get('channel') || null;

  const bid = auth.businessId;

  const [convos, calls, contacts, responseTime, bizSummary] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, channel', { count: 'exact', head: false })
      .eq('business_id', bid)
      .gte('created_at', from)
      .lte('created_at', to)
      .then(r => {
        const rows = r.data || [];
        const total = r.count || 0;
        if (!channel) return { total, byChannel: countBy(rows, 'channel') };
        return { total: rows.filter(x => x.channel === channel).length, byChannel: countBy(rows, 'channel') };
      }),

    supabase
      .from('calls')
      .select('status, duration_seconds')
      .eq('business_id', bid)
      .gte('created_at', from)
      .lte('created_at', to)
      .then(r => {
        const rows = r.data || [];
        return {
          total: rows.length,
          answered: rows.filter(c => c.status === 'completed').length,
          missed: rows.filter(c => c.status === 'missed').length,
          failed: rows.filter(c => c.status === 'failed').length,
          totalDuration: rows.reduce((s, c) => s + (c.duration_seconds || 0), 0),
        };
      }),

    supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', bid)
      .gte('created_at', from)
      .lte('created_at', to)
      .then(r => ({ newContacts: r.count || 0 })),

    supabase.rpc('analytics_avg_response_time', {
      p_business_id: bid, p_from: from, p_to: to,
    }).then(r => r.data?.[0] || null),

    supabase.rpc('analytics_business_summary', {
      p_business_id: bid, p_from: from, p_to: to,
    }).then(r => r.data?.[0] || null),
  ]);

  // Message counts (separate query with channel filter)
  let msgQuery = supabase
    .from('messages')
    .select('direction, conversation_id, sender, status')
    .gte('created_at', from)
    .lte('created_at', to);

  const { data: msgRows } = await msgQuery;
  const filteredMsgs = msgRows || [];

  // If channel filter, we need conversation IDs for that channel
  let relevantConvoIds: Set<string> | null = null;
  if (channel) {
    const { data: chConvos } = await supabase
      .from('conversations')
      .select('id')
      .eq('business_id', bid)
      .eq('channel', channel);
    relevantConvoIds = new Set((chConvos || []).map(c => c.id));
  } else {
    const { data: allConvos } = await supabase
      .from('conversations')
      .select('id')
      .eq('business_id', bid);
    relevantConvoIds = new Set((allConvos || []).map(c => c.id));
  }

  const msgs = filteredMsgs.filter(m => relevantConvoIds!.has(m.conversation_id));

  return new Response(JSON.stringify({
    totalConversations: convos.total,
    conversationsByChannel: convos.byChannel,
    messagesSent: msgs.filter(m => m.direction === 'outbound').length,
    messagesReceived: msgs.filter(m => m.direction === 'inbound').length,
    callsTotal: calls.total,
    callsAnswered: calls.answered,
    callsMissed: calls.missed,
    callsFailed: calls.failed,
    callsDuration: calls.totalDuration,
    avgResponseSeconds: responseTime?.avg_seconds ?? null,
    medianResponseSeconds: responseTime?.median_seconds ?? null,
    newContacts: contacts.newContacts,
    appointments: bizSummary ? {
      total: Number(bizSummary.appointments_total),
      confirmed: Number(bizSummary.appointments_confirmed),
      cancelled: Number(bizSummary.appointments_cancelled),
      noShow: Number(bizSummary.appointments_no_show),
      completed: Number(bizSummary.appointments_completed),
    } : null,
    quotes: bizSummary ? {
      total: Number(bizSummary.quotes_total),
      sent: Number(bizSummary.quotes_sent),
      accepted: Number(bizSummary.quotes_accepted),
      totalValue: Number(bizSummary.quotes_value),
      acceptedValue: Number(bizSummary.quotes_accepted_value),
    } : null,
    invoices: bizSummary ? {
      total: Number(bizSummary.invoices_total),
      paid: Number(bizSummary.invoices_paid),
      overdue: Number(bizSummary.invoices_overdue),
      totalValue: Number(bizSummary.invoices_total_value),
      paidValue: Number(bizSummary.invoices_paid_value),
    } : null,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function countBy(arr: any[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of arr) {
    const v = item[key] || 'unknown';
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}
