// useLeaderboard — the head-to-head board, readable by agents.
//
// Hugo 2026-07-24: the leaderboard used to be derived client-side from the
// rows useReports pulled out of wk_calls. That table's RLS is
// `wk_is_admin() OR agent_id = auth.uid()`, so an agent's browser only ever
// received their OWN calls — Marr's leaderboard listed Marr, Pedro's listed
// Pedro. No competition, which is the whole point of the board.
//
// The wk_leaderboard RPC (SECURITY DEFINER, staff-gated) aggregates
// server-side and returns names + totals only. It also includes agents with
// no activity yet, so nobody silently drops off the board, and it honours
// the per-agent "compete" tick in Settings → Agents & spend.
//
// Refreshes every 60s, same cadence as useReports.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { AgentLeaderRow } from './useReports';

/** Hugo 2026-07-24: "they called yesterday and the day before, make sure it
 *  shows already." Today-only read empty every morning, so the board takes a
 *  range and defaults to the rolling week. */
export type LeaderboardRange = 'today' | 'yesterday' | 'week' | 'month';

export const RANGE_LABELS: Record<LeaderboardRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'Last 30 days',
};

/** The board opens on this — always has calls in it. */
export const DEFAULT_LEADERBOARD_RANGE: LeaderboardRange = 'week';

interface LeaderboardRow {
  agent_id: string;
  agent_name: string | null;
  calls: number | null;
  answered: number | null;
  avg_duration_sec: number | null;
  messages_sent: number | null;
  voicemail_drops: number | null;
  spend_pence: number | null;
}

export interface LeaderboardData {
  rows: AgentLeaderRow[];
  loading: boolean;
  error: string | null;
}

/** UTC day boundaries, matching the rest of the reporting code.
 *  `until` is exclusive; null means "up to now". */
function rangeBounds(range: LeaderboardRange): { since: Date; until: Date | null } {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  if (range === 'yesterday') {
    const since = new Date(startOfToday);
    since.setUTCDate(since.getUTCDate() - 1);
    return { since, until: startOfToday };
  }

  const since = new Date(startOfToday);
  if (range === 'week') since.setUTCDate(since.getUTCDate() - 6);
  else if (range === 'month') since.setUTCDate(since.getUTCDate() - 29);
  return { since, until: null };
}

export function useLeaderboard(
  range: LeaderboardRange = DEFAULT_LEADERBOARD_RANGE,
): LeaderboardData {
  const [rows, setRows] = useState<AgentLeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { since, until } = rangeBounds(range);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: rpcError } = await (supabase as any).rpc('wk_leaderboard', {
      p_since: since.toISOString(),
      p_until: until ? until.toISOString() : null,
    });
    if (rpcError) {
      console.warn('[leaderboard] wk_leaderboard failed:', rpcError.message);
      setError(rpcError.message);
      setLoading(false);
      return;
    }
    setError(null);
    setRows(
      ((data ?? []) as LeaderboardRow[]).map((r) => ({
        agentId: r.agent_id,
        agentName: r.agent_name ?? 'Agent',
        calls: r.calls ?? 0,
        answered: r.answered ?? 0,
        avgDurationSec: r.avg_duration_sec ?? 0,
        spendPence: r.spend_pence ?? 0,
        messagesSent: r.messages_sent ?? 0,
        voicemailDrops: r.voicemail_drops ?? 0,
      })),
    );
    setLoading(false);
  }, [range]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { rows, loading, error };
}
