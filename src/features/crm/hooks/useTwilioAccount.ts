// useTwilioAccount — fetches Twilio connection state + manages connect/disconnect.
//
// Reads/writes via the wk-twilio-connect edge function. Admin-only.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface TwilioNumberRow {
  id: string;
  e164: string;
  twilio_sid: string | null;
  voice_enabled: boolean;
  sms_enabled: boolean;
  recording_enabled: boolean;
  max_calls_per_minute: number;
  cooldown_seconds_after_call: number;
}

export interface TwilioAccountState {
  connected: boolean;
  account_sid: string | null;
  friendly_name: string | null;
  connected_at: string | null;
  numbers: TwilioNumberRow[];
}

interface TwilioInvoke {
  invoke: (
    name: string,
    options: { body: Record<string, unknown> }
  ) => Promise<{
    data: (Partial<TwilioAccountState> & { error?: string; numbers_synced?: number }) | null;
    error: { message: string } | null;
  }>;
}

const blank: TwilioAccountState = {
  connected: false,
  account_sid: null,
  friendly_name: null,
  connected_at: null,
  numbers: [],
};

export function useTwilioAccount() {
  const [state, setState] = useState<TwilioAccountState>(blank);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'connect' | 'disconnect' | 'sync' | 'toggle'>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invErr } = await (
        supabase.functions as unknown as TwilioInvoke
      ).invoke('wk-twilio-connect', { body: { action: 'state' } });
      if (invErr) {
        setError(invErr.message);
      } else if (data?.error) {
        setError(data.error);
      } else if (data) {
        setState({
          connected: !!data.connected,
          account_sid: data.account_sid ?? null,
          friendly_name: data.friendly_name ?? null,
          connected_at: data.connected_at ?? null,
          numbers: (data.numbers as TwilioNumberRow[]) ?? [],
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(
    async (account_sid: string, auth_token: string) => {
      setBusy('connect');
      setError(null);
      try {
        const { data, error: invErr } = await (
          supabase.functions as unknown as TwilioInvoke
        ).invoke('wk-twilio-connect', {
          body: { action: 'connect', account_sid, auth_token },
        });
        if (invErr) {
          setError(invErr.message);
          return false;
        }
        if (data?.error) {
          setError(data.error);
          return false;
        }
        await refresh();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const disconnect = useCallback(async () => {
    setBusy('disconnect');
    setError(null);
    try {
      const { data, error: invErr } = await (
        supabase.functions as unknown as TwilioInvoke
      ).invoke('wk-twilio-connect', { body: { action: 'disconnect' } });
      if (invErr) {
        setError(invErr.message);
        return false;
      }
      if (data?.error) {
        setError(data.error);
        return false;
      }
      setState(blank);
      return true;
    } finally {
      setBusy(null);
    }
  }, []);

  const sync = useCallback(async () => {
    setBusy('sync');
    setError(null);
    try {
      const { data, error: invErr } = await (
        supabase.functions as unknown as TwilioInvoke
      ).invoke('wk-twilio-connect', { body: { action: 'sync_numbers' } });
      if (invErr) {
        setError(invErr.message);
        return 0;
      }
      if (data?.error) {
        setError(data.error);
        return 0;
      }
      await refresh();
      return data?.numbers_synced ?? 0;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const toggleNumber = useCallback(
    async (e164: string, enabled: boolean) => {
      // optimistic
      setState((s) => ({
        ...s,
        numbers: s.numbers.map((n) =>
          n.e164 === e164 ? { ...n, voice_enabled: enabled } : n
        ),
      }));
      setBusy('toggle');
      try {
        const { data, error: invErr } = await (
          supabase.functions as unknown as TwilioInvoke
        ).invoke('wk-twilio-connect', {
          body: { action: 'toggle_number', e164, enabled },
        });
        if (invErr || data?.error) {
          // rollback
          setState((s) => ({
            ...s,
            numbers: s.numbers.map((n) =>
              n.e164 === e164 ? { ...n, voice_enabled: !enabled } : n
            ),
          }));
          setError(invErr?.message ?? data?.error ?? 'Toggle failed');
          return false;
        }
        return true;
      } finally {
        setBusy(null);
      }
    },
    []
  );

  return { state, loading, busy, error, refresh, connect, disconnect, sync, toggleNumber };
}
