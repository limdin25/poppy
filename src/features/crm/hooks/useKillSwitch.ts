// useKillSwitch — backed by wk_killswitches via wk-killswitch-check.
//
// Reads the current state on mount + every 15s, and writes via the
// edge function (admin-only on the server side).
//
// Camel-cased keys here map onto the snake_cased `kind` enum:
//   allDialers → all_dialers
//   aiCoach    → ai_coach
//   outbound   → outbound

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface KillSwitchState {
  allDialers: boolean;
  aiCoach: boolean;
  outbound: boolean;
}

const DEFAULT: KillSwitchState = {
  allDialers: false,
  aiCoach: false,
  outbound: false,
};

const KEY_TO_KIND: Record<keyof KillSwitchState, string> = {
  allDialers: 'all_dialers',
  aiCoach: 'ai_coach',
  outbound: 'outbound',
};

interface InvokeFn {
  invoke: (
    name: string,
    options: { body: Record<string, unknown> }
  ) => Promise<{
    data: Record<string, boolean> | null;
    error: { message: string } | null;
  }>;
}

export function useKillSwitch(): KillSwitchState & {
  toggle: (k: keyof KillSwitchState) => Promise<void>;
  loading: boolean;
} {
  const [state, setState] = useState<KillSwitchState>(DEFAULT);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await (
        supabase.functions as unknown as InvokeFn
      ).invoke('wk-killswitch-check', { body: { action: 'state' } });
      if (error) {
        console.warn('killswitch-check', error.message);
      } else if (data) {
        setState({
          allDialers: !!data.all_dialers,
          aiCoach: !!data.ai_coach,
          outbound: !!data.outbound,
        });
      }
    } catch (e) {
      console.warn('killswitch-check', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggle = useCallback(
    async (k: keyof KillSwitchState) => {
      const next = !state[k];
      // Optimistic
      setState((s) => ({ ...s, [k]: next }));
      try {
        await (supabase.functions as unknown as InvokeFn).invoke(
          'wk-killswitch-check',
          {
            body: {
              action: 'set',
              kind: KEY_TO_KIND[k],
              active: next,
              reason: 'admin toggle',
            },
          }
        );
      } catch (e) {
        // Roll back on failure
        setState((s) => ({ ...s, [k]: !next }));
        console.error('killswitch toggle failed', e);
      }
    },
    [state]
  );

  return { ...state, toggle, loading };
}
