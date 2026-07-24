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
import type { AgentLeaderRow, ReportRange } from './useReports';

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

function rangeStart(range: ReportRange): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  if (range === 'week') d.setUTCDate(d.getUTCDate() - 6);
  else if (range === 'month') d.setUTCDate(d.getUTCDate() - 29);
  return d;
}

export function useLeaderboard(range: ReportRange = 'today'): LeaderboardData {
  const [rows, setRows] = useState<AgentLeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: rpcError } = await (supabase as any).rpc('wk_leaderboard', {
      p_since: rangeStart(range).toISOString(),
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
