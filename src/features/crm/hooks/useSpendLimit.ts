// useSpendLimit — agent's daily spend ↔ limit, backed by
// wk-spend-check edge function (which calls wk_check_spend RPC).
//
// Polls every 20s. Subscribes to wk_voice_agent_limits realtime so a
// new call's cost write bumps the banner instantly.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

interface SpendState {
  spendPence: number;
  limitPence: number;
  isAdmin: boolean;
  isLimitReached: boolean;
  percentUsed: number;
  blocked: boolean;
  reason: string | null;
  loading: boolean;
}

interface InvokeFn {
  invoke: (
    name: string,
    options?: { body?: Record<string, unknown> }
  ) => Promise<{
    data: {
      allowed?: boolean;
      reason?: string;
      daily_spend_pence?: number;
      daily_limit_pence?: number | null;
      is_admin?: boolean;
    } | null;
    error: { message: string } | null;
  }>;
}

const DEFAULT: SpendState = {
  spendPence: 0,
  limitPence: 1000,
  isAdmin: false,
  isLimitReached: false,
  percentUsed: 0,
  blocked: false,
  reason: null,
  loading: true,
};

export function useSpendLimit(): SpendState {
  const [state, setState] = useState<SpendState>(DEFAULT);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await (
        supabase.functions as unknown as InvokeFn
      ).invoke('wk-spend-check');
      if (error || !data) {
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      const spend = data.daily_spend_pence ?? 0;
      const limit = data.daily_limit_pence ?? 1000;
      const isAdmin = !!data.is_admin;
      setState({
        spendPence: spend,
        limitPence: limit,
        isAdmin,
        isLimitReached: !isAdmin && spend >= limit,
        percentUsed:
          limit > 0 ? Math.min(100, (spend / limit) * 100) : 0,
        blocked: data.allowed === false,
        reason: data.reason ?? null,
        loading: false,
      });
    } catch (e) {
      console.warn('spend-check failed', e);
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Slow poll as a safety net (in case realtime drops or a backend
    // change happened while the tab was backgrounded).
    const t = setInterval(refresh, 20_000);

    // Realtime: any UPDATE on wk_voice_agent_limits (which the AI cost +
    // carrier cost RPCs bump on every call) refreshes immediately so the
    // banner doesn't lag the actual spend by up to 20s.
    let mounted = true;
    let agentId: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      agentId = data.user?.id ?? null;
      if (!agentId) return;
      channel = supabase
        .channel(`smsv2-spend-${agentId}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'wk_voice_agent_limits',
            filter: `agent_id=eq.${agentId}`,
          },
          () => {
            void refresh();
          }
        )
        .subscribe();
    });

    return () => {
      mounted = false;
      clearInterval(t);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refresh]);

  return state;
}
