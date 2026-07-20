// useDashboardStats — live admin dashboard KPIs from wk_calls + wk_voice_call_costs.
//
// Calls today          → count(wk_calls) where started_at >= midnight UTC
// Active agents        → count distinct agent_id with status != 'offline'
// Spend today          → sum(wk_voice_call_costs.total_pence) joined to today's calls
// Answer rate          → answered / (answered + missed/no_answer) over rolling 24h
// Connected now        → count(wk_calls) where status='in_progress'
//
// Refreshes every 30s and reacts to wk_calls realtime so a finished call
// updates the cards within ~1s.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { countVoicemailDrops } from '../lib/callStats';

export interface DashboardStats {
  callsToday: number;
  activeAgents: number;
  totalAgents: number;
  spendTodayPence: number;
  answerRatePercent: number;
  connectedNow: number;
  /** Voicemail drops fired today (wk_calls.voicemail_dropped). */
  vmDropsToday: number;
  loading: boolean;
}

const ZERO: DashboardStats = {
  callsToday: 0,
  activeAgents: 0,
  totalAgents: 0,
  spendTodayPence: 0,
  answerRatePercent: 0,
  connectedNow: 0,
  vmDropsToday: 0,
  loading: true,
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfYesterdayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
}

export function useDashboardStats(): DashboardStats {
  const [stats, setStats] = useState<DashboardStats>(ZERO);

  const refresh = useCallback(async () => {
    const todayIso = startOfTodayIso();
    const yesterdayIso = startOfYesterdayIso();

    // 1. Calls today (count + answered/missed for answer rate)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callsTodayRes = await (supabase.from('wk_calls' as any) as any)
      .select('id, status, started_at, agent_id, voicemail_dropped')
      .gte('started_at', todayIso);

    // 2. Calls in last 24h (for rolling answer rate)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls24Res = await (supabase.from('wk_calls' as any) as any)
      .select('status')
      .gte('started_at', yesterdayIso);

    // 3. Connected now
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connectedRes = await (supabase.from('wk_calls' as any) as any)
      .select('id', { count: 'exact', head: true })
      .eq('status', 'in_progress');

    // 4. Spend today (join wk_voice_call_costs to today's call IDs)
    let spendTodayPence = 0;
    const todayCallIds = ((callsTodayRes.data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (todayCallIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const costsRes = await (supabase.from('wk_voice_call_costs' as any) as any)
        .select('total_pence')
        .in('call_id', todayCallIds);
      spendTodayPence = ((costsRes.data ?? []) as Array<{ total_pence: number | null }>).reduce(
        (sum, r) => sum + (r.total_pence ?? 0),
        0
      );
    }

    // 5. Agents (status != 'offline' = active)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agentsRes = await (supabase.from('profiles' as any) as any)
      .select('id, agent_status, workspace_role')
      .in('workspace_role', ['agent', 'admin']);
    const totalAgents = (agentsRes.data ?? []).length;
    const activeAgents = ((agentsRes.data ?? []) as Array<{ agent_status: string | null }>)
      .filter((p) => p.agent_status && p.agent_status !== 'offline').length;

    // Compute answer rate: answered = completed + voicemail (caller engaged), denominator = answered + no_answer/missed/busy/failed
    const calls24 = (calls24Res.data ?? []) as Array<{ status: string }>;
    const answered = calls24.filter((c) =>
      ['completed', 'in_progress', 'voicemail'].includes(c.status)
    ).length;
    const tried = calls24.filter((c) =>
      ['completed', 'in_progress', 'voicemail', 'no_answer', 'missed', 'busy', 'failed'].includes(c.status)
    ).length;
    const answerRatePercent = tried > 0 ? Math.round((answered / tried) * 100) : 0;

    setStats({
      callsToday: (callsTodayRes.data ?? []).length,
      activeAgents,
      totalAgents,
      spendTodayPence,
      answerRatePercent,
      connectedNow: connectedRes.count ?? 0,
      vmDropsToday: countVoicemailDrops(
        (callsTodayRes.data ?? []) as Array<{ voicemail_dropped?: boolean | null }>
      ),
      loading: false,
    });
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 30_000);

    // Realtime: any wk_calls change refreshes stats
    const ch = supabase
      .channel('smsv2-dashboard-stats')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_calls' },
        () => {
          void refresh();
        }
      )
      .subscribe();

    return () => {
      clearInterval(t);
      void supabase.removeChannel(ch);
    };
  }, [refresh]);

  return stats;
}
