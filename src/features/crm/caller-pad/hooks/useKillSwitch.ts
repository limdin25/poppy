// Caller — useKillSwitch hook.
// Ported from src/features/smsv2/hooks/useKillSwitch.ts. Reads + toggles
// wk_killswitches via the wk-killswitch-check edge function. Polls
// every 15s. Camel-cased keys map onto the snake_cased `kind` enum.

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
        setState((s) => ({ ...s, [k]: !next }));
        console.error('killswitch toggle failed', e);
      }
    },
    [state]
  );

  return { ...state, toggle, loading };
}
