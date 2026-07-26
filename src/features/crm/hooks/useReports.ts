// useReports — admin reports aggregations from wk_calls + wk_voice_call_costs.
//
// Driven by a date range (today / week / month). Returns:
//   - KPIs (calls, answer rate, avg duration, total spend)
//   - Hourly bucket counts for the chart
//   - Per-agent leaderboard rows
//
// Refreshes on date range change + every 60s.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useImpersonatedAgentId } from '../lib/ViewAsContext';
import { countVoicemailDrops } from '../lib/callStats';

export type ReportRange = 'today' | 'week' | 'month';

export interface AgentLeaderRow {
  agentId: string;
  agentName: string;
  calls: number;
  answered: number;
  avgDurationSec: number;
  spendPence: number;
  /** PR 109: outbound wk_sms_messages count for this agent in range. */
  messagesSent: number;
  /** Voicemail drops fired by this agent in range. */
  voicemailDrops: number;
}

export interface ReportData {
  totalCalls: number;
  answerRatePercent: number;
  avgDurationSec: number;
  totalSpendPence: number;
  /** Voicemail drops in range — separate from status='voicemail' (AMD). */
  voicemailsDropped: number;
  hourly: number[]; // 24 entries (or fewer for "today" up to current hour)
  hourLabels: string[];
  leaderboard: AgentLeaderRow[];
  loading: boolean;
}

const ZERO: ReportData = {
  totalCalls: 0,
  answerRatePercent: 0,
  avgDurationSec: 0,
  totalSpendPence: 0,
  voicemailsDropped: 0,
  hourly: [],
  hourLabels: [],
  leaderboard: [],
  loading: true,
};

function rangeStart(range: ReportRange): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  if (range === 'week') d.setUTCDate(d.getUTCDate() - 6);
  else if (range === 'month') d.setUTCDate(d.getUTCDate() - 29);
  return d;
}

interface CallRow {
  id: string;
  agent_id: string | null;
  status: string;
  duration_sec: number | null;
  started_at: string | null;
  voicemail_dropped: boolean | null;
}

export function useReports(range: ReportRange): ReportData {
  const impId = useImpersonatedAgentId();
  const [data, setData] = useState<ReportData>(ZERO);

  const refresh = useCallback(async () => {
    const start = rangeStart(range);
    const startIso = start.toISOString();

    // 1. Calls in range ("See as: <agent>" scopes to that agent when an admin
    // is impersonating).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let callsQ = (supabase.from('wk_calls' as any) as any)
      .select('id, agent_id, status, duration_sec, started_at, voicemail_dropped')
      .gte('started_at', startIso)
      .order('started_at', { ascending: true });
    if (impId) callsQ = callsQ.eq('agent_id', impId);
    const callsRes = await callsQ;

    const calls = (callsRes.data ?? []) as CallRow[];

    // 2. Costs joined to those call IDs
    let totalSpendPence = 0;
    const costByCall = new Map<string, number>();
    if (calls.length > 0) {
      const ids = calls.map((c) => c.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const costsRes = await (supabase.from('wk_voice_call_costs' as any) as any)
        .select('call_id, total_pence')
        .in('call_id', ids);
      for (const c of (costsRes.data ?? []) as Array<{ call_id: string; total_pence: number | null }>) {
        const v = c.total_pence ?? 0;
        costByCall.set(c.call_id, v);
        totalSpendPence += v;
      }
    }

    // 3. KPIs
    const answered = calls.filter((c) =>
      ['completed', 'in_progress', 'voicemail'].includes(c.status)
    );
    const tried = calls.filter((c) =>
      ['completed', 'in_progress', 'voicemail', 'no_answer', 'missed', 'busy', 'failed'].includes(c.status)
    );
    const answerRatePercent = tried.length > 0 ? Math.round((answered.length / tried.length) * 100) : 0;
    const totalAnsweredDur = answered.reduce((s, c) => s + (c.duration_sec ?? 0), 0);
    const avgDurationSec = answered.length > 0 ? Math.round(totalAnsweredDur / answered.length) : 0;
    const voicemailsDropped = countVoicemailDrops(calls);

    // 4. Hourly bucketing
    let hourly: number[];
    let hourLabels: string[];
    if (range === 'today') {
      hourly = new Array(24).fill(0);
      hourLabels = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
      for (const c of calls) {
        if (!c.started_at) continue;
        const h = new Date(c.started_at).getUTCHours();
        hourly[h] += 1;
      }
    } else {
      // Daily buckets for week/month
      const daysBack = range === 'week' ? 7 : 30;
      hourly = new Array(daysBack).fill(0);
      hourLabels = [];
      for (let i = daysBack - 1; i >= 0; i--) {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() - i);
        hourLabels.push(d.toISOString().slice(5, 10)); // MM-DD
      }
      for (const c of calls) {
        if (!c.started_at) continue;
        const cd = new Date(c.started_at);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const dayOffset = Math.floor(
          (today.getTime() - new Date(cd.toISOString().slice(0, 10) + 'T00:00:00Z').getTime()) /
            86_400_000
        );
        const idx = daysBack - 1 - dayOffset;
        if (idx >= 0 && idx < daysBack) hourly[idx] += 1;
      }
    }

    // 5. Per-agent leaderboard
    const byAgent = new Map<string, { calls: CallRow[]; spend: number }>();
    for (const c of calls) {
      const aid = c.agent_id ?? 'unknown';
      const bucket = byAgent.get(aid) ?? { calls: [], spend: 0 };
      bucket.calls.push(c);
      bucket.spend += costByCall.get(c.id) ?? 0;
      byAgent.set(aid, bucket);
    }

    // PR 109: messagesSent per agent (outbound wk_sms_messages in range).
    // Single query; bucketed client-side. Cheap for typical CRM volume.
    const messagesByAgent = new Map<string, number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msgsQ = (supabase.from('wk_sms_messages' as any) as any)
      .select('created_by')
      .eq('direction', 'outbound')
      .gte('created_at', startIso);
    if (impId) msgsQ = msgsQ.eq('created_by', impId);
    const msgsRes = await msgsQ;
    for (const m of (msgsRes.data ?? []) as Array<{ created_by: string | null }>) {
      const aid = m.created_by ?? 'unknown';
      messagesByAgent.set(aid, (messagesByAgent.get(aid) ?? 0) + 1);
    }

    // PR 109: include any agent who SENT messages but didn't make calls
    // — they still belong on the leaderboard.
    for (const aid of messagesByAgent.keys()) {
      if (aid === 'unknown') continue;
      if (!byAgent.has(aid)) byAgent.set(aid, { calls: [], spend: 0 });
    }

    const agentIds = Array.from(byAgent.keys()).filter((id) => id !== 'unknown');
    const profilesById = new Map<string, string>();
    // PR 109 (Item O): wk_voice_agent_limits.show_on_leaderboard filter.
    // Default to true when the column / row is missing so existing
    // agents stay visible until an admin opts them out.
    const showOnBoardById = new Map<string, boolean>();
    if (agentIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profRes = await (supabase.from('profiles' as any) as any)
        .select('id, name, email')
        .in('id', agentIds);
      for (const p of (profRes.data ?? []) as Array<{
        id: string;
        name: string | null;
        email: string | null;
      }>) {
        profilesById.set(p.id, p.name ?? p.email ?? 'Agent');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const limitsRes = await (supabase.from('wk_voice_agent_limits' as any) as any)
        .select('agent_id, show_on_leaderboard')
        .in('agent_id', agentIds);
      for (const l of (limitsRes.data ?? []) as Array<{
        agent_id: string;
        show_on_leaderboard: boolean | null;
      }>) {
        showOnBoardById.set(l.agent_id, l.show_on_leaderboard !== false);
      }
    }

    const leaderboard: AgentLeaderRow[] = Array.from(byAgent.entries())
      .filter(([id]) => id !== 'unknown')
      .filter(([id]) => showOnBoardById.get(id) !== false)
      .map(([id, b]) => {
        const ans = b.calls.filter((c) =>
          ['completed', 'in_progress', 'voicemail'].includes(c.status)
        );
        const totalDur = ans.reduce((s, c) => s + (c.duration_sec ?? 0), 0);
        return {
          agentId: id,
          agentName: profilesById.get(id) ?? 'Agent',
          calls: b.calls.length,
          answered: ans.length,
          avgDurationSec: ans.length > 0 ? Math.round(totalDur / ans.length) : 0,
          spendPence: b.spend,
          messagesSent: messagesByAgent.get(id) ?? 0,
          voicemailDrops: countVoicemailDrops(b.calls),
        };
      });
    leaderboard.sort((a, b) => b.calls - a.calls);

    setData({
      totalCalls: calls.length,
      answerRatePercent,
      avgDurationSec,
      totalSpendPence,
      voicemailsDropped,
      hourly,
      hourLabels,
      leaderboard,
      loading: false,
    });
  }, [range, impId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  return data;
}
