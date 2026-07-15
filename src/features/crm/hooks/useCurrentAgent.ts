// useCurrentAgent — current signed-in agent's identity, presence, daily call
// counts, and spend. Replaces the mock CURRENT_AGENT export. Used by the
// status bar, softphone header, live-call screen agent stats, and the call
// script greeting.
//
// Joins:
//   profiles (id, name, email, agent_status, agent_extension, workspace_role)
//   wk_voice_agent_limits (daily_limit_pence, daily_spend_pence, is_admin)
//   wk_calls (today's rows for callsToday + answeredToday + talkRatioPercent)
//
// Refresh: poll every 30s + realtime UPDATE on wk_voice_agent_limits for the
// signed-in user (so spend reflects the moment a call ends).

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { Agent, AgentStatus } from '../types';

interface ProfileRow {
  id: string;
  name: string | null;
  email: string | null;
  agent_status: AgentStatus | null;
  agent_extension: string | null;
  workspace_role: 'admin' | 'agent' | 'viewer' | null;
}

interface LimitRow {
  agent_id: string;
  daily_limit_pence: number | null;
  daily_spend_pence: number;
  is_admin: boolean;
  /** PR 109: per-agent leaderboard visibility. Defaults to true. */
  show_on_leaderboard?: boolean | null;
}

interface CallStatusRow {
  status: string;
}

export interface RowToCurrentAgentInput {
  profile: ProfileRow;
  limit: LimitRow | undefined;
  callsToday: number;
  answeredToday: number;
}

const ANSWERED_STATUSES = new Set(['completed', 'in_progress', 'voicemail']);

export function rowToCurrentAgent(input: RowToCurrentAgentInput): Agent {
  const { profile, limit, callsToday, answeredToday } = input;
  const role = profile.workspace_role ?? 'agent';
  return {
    id: profile.id,
    name: profile.name ?? profile.email ?? 'Agent',
    email: profile.email ?? '',
    extension: profile.agent_extension ?? '',
    role: role === 'viewer' ? 'viewer' : role === 'admin' ? 'admin' : 'agent',
    status: profile.agent_status ?? 'offline',
    callsToday,
    answeredToday,
    avgDurationSec: 0,
    spendPence: limit?.daily_spend_pence ?? 0,
    limitPence: limit?.daily_limit_pence ?? 0,
    isAdmin: limit?.is_admin ?? role === 'admin',
  };
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export interface UseCurrentAgentResult {
  agent: Agent | null;
  firstName: string;
  talkRatioPercent: number;
  loading: boolean;
}

export function useCurrentAgent(): UseCurrentAgentResult {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (uid: string) => {
    const todayIso = startOfTodayIso();

    const [profileRes, limitRes, callsRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('profiles' as any) as any)
        .select('id, name, email, agent_status, agent_extension, workspace_role')
        .eq('id', uid)
        .maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('wk_voice_agent_limits' as any) as any)
        .select('agent_id, daily_limit_pence, daily_spend_pence, is_admin, show_on_leaderboard')
        .eq('agent_id', uid)
        .maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('wk_calls' as any) as any)
        .select('status')
        .eq('agent_id', uid)
        .gte('started_at', todayIso),
    ]);

    if (profileRes.error || !profileRes.data) {
      setLoading(false);
      return;
    }

    const calls = (callsRes.data ?? []) as CallStatusRow[];
    const callsToday = calls.length;
    const answeredToday = calls.filter((c) => ANSWERED_STATUSES.has(c.status)).length;

    setAgent(
      rowToCurrentAgent({
        profile: profileRes.data as ProfileRow,
        limit: (limitRes.data as LimitRow | null) ?? undefined,
        callsToday,
        answeredToday,
      })
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let limitChannel: ReturnType<typeof supabase.channel> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (cancelled || !uid) {
        if (!cancelled) setLoading(false);
        return;
      }
      await refresh(uid);
      if (cancelled) return;

      // Slow poll keeps callsToday fresh between calls.
      pollTimer = setInterval(() => void refresh(uid), 30_000);

      // Realtime: spend bumps refresh immediately.
      limitChannel = supabase
        .channel(`smsv2-current-agent-${uid}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'wk_voice_agent_limits',
            filter: `agent_id=eq.${uid}`,
          },
          () => void refresh(uid)
        )
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${uid}`,
          },
          () => void refresh(uid)
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (limitChannel) void supabase.removeChannel(limitChannel);
    };
  }, [refresh]);

  const firstName = agent?.name?.split(' ')[0] ?? '';
  const talkRatioPercent =
    agent && agent.callsToday > 0
      ? Math.round((agent.answeredToday / agent.callsToday) * 100)
      : 0;

  return { agent, firstName, talkRatioPercent, loading };
}
