// useAgentsToday — agent list + per-agent stats for today.
//
// Joins:
//   profiles.id, name, agent_status, workspace_role
//   wk_voice_agent_limits.daily_limit_pence + daily_spend_pence + is_admin
//   wk_calls aggregations (calls today, answered today, avg duration today)
//
// Used by the admin dashboard's Agents table.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { Agent } from '../types';

interface ProfileRow {
  id: string;
  email: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

interface LimitRow {
  agent_id: string;
  daily_limit_pence: number | null;
  daily_spend_pence: number;
  is_admin: boolean;
  /** PR 109: per-agent leaderboard visibility. Defaults to true. */
  show_on_leaderboard?: boolean | null;
}

interface CallStatRow {
  agent_id: string | null;
  status: string;
  duration_sec: number | null;
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useAgentsToday(): {
  agents: Agent[];
  loading: boolean;
  /** PR 121 (Hugo 2026-04-28): expose a manual refresh so the
   *  Settings → Agents tab can re-pull immediately after invite /
   *  remove without waiting for the 30s poll. */
  refresh: () => Promise<void>;
} {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const todayIso = startOfTodayIso();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profilesRes = await (supabase.from('profiles' as any) as any)
      .select('id, email, name, agent_status, agent_extension, workspace_role')
      .in('workspace_role', ['agent', 'admin']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const limitsRes = await (supabase.from('wk_voice_agent_limits' as any) as any)
      .select('agent_id, daily_limit_pence, daily_spend_pence, is_admin, show_on_leaderboard');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callsRes = await (supabase.from('wk_calls' as any) as any)
      .select('agent_id, status, duration_sec')
      .gte('started_at', todayIso);

    // PR 54 (Hugo 2026-04-27): SMS sent today per agent.
    // wk_sms_messages.created_by = agent_id for outbound rows.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const smsRes = await (supabase.from('wk_sms_messages' as any) as any)
      .select('created_by')
      .eq('direction', 'outbound')
      .gte('created_at', todayIso);

    const limitByAgent = new Map<string, LimitRow>();
    for (const l of (limitsRes.data ?? []) as LimitRow[]) limitByAgent.set(l.agent_id, l);

    const callsByAgent = new Map<string, CallStatRow[]>();
    for (const c of (callsRes.data ?? []) as CallStatRow[]) {
      const aid = c.agent_id ?? 'unknown';
      const list = callsByAgent.get(aid) ?? [];
      list.push(c);
      callsByAgent.set(aid, list);
    }

    const smsCountByAgent = new Map<string, number>();
    for (const s of (smsRes.data ?? []) as Array<{ created_by: string | null }>) {
      const aid = s.created_by ?? 'unknown';
      smsCountByAgent.set(aid, (smsCountByAgent.get(aid) ?? 0) + 1);
    }

    const out: Agent[] = ((profilesRes.data ?? []) as ProfileRow[]).map((p) => {
      const calls = callsByAgent.get(p.id) ?? [];
      const answered = calls.filter((c) =>
        ['completed', 'in_progress', 'voicemail'].includes(c.status)
      );
      const totalDur = answered.reduce((s, c) => s + (c.duration_sec ?? 0), 0);
      const avgDur = answered.length > 0 ? Math.round(totalDur / answered.length) : 0;
      const limit = limitByAgent.get(p.id);
      const answerRatePct =
        calls.length > 0 ? Math.round((answered.length / calls.length) * 100) : 0;

      return {
        id: p.id,
        name: (p.name as string | null) ?? (p.email as string | null) ?? 'Agent',
        email: (p.email as string | null) ?? '',
        extension: (p.agent_extension as string | null) ?? '',
        role: (p.workspace_role as 'admin' | 'agent' | 'viewer' | null) ?? 'agent',
        status: ((p.agent_status as Agent['status'] | null) ?? 'offline'),
        callsToday: calls.length,
        answeredToday: answered.length,
        avgDurationSec: avgDur,
        spendPence: limit?.daily_spend_pence ?? 0,
        limitPence: limit?.daily_limit_pence ?? 0,
        isAdmin: limit?.is_admin ?? p.workspace_role === 'admin',
        // PR 109: leaderboard visibility surfaced on the Agent record so
        // SettingsPage can read/write it without re-querying.
        showOnLeaderboard: limit?.show_on_leaderboard !== false,
        answerRatePct,
        smsSentToday: smsCountByAgent.get(p.id) ?? 0,
      };
    });

    setAgents(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { agents, loading, refresh };
}
