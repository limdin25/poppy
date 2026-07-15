// useCallerId — the "Calling from" number selector for the softphone + dialer.
//
// The outbound TwiML (wk-voice-twiml-outgoing) resolves the caller ID from
// profiles.default_caller_id_number_id, falling back to the first voice-enabled
// number. So the picker just reads the active numbers + the agent's current
// default, and writing a choice persists it to that column — no per-call param
// plumbing, and the power dialer inherits the same caller ID.
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';

export interface CallerNumber {
  id: string;
  e164: string;
  label: string | null;
  voice_enabled: boolean;
}

export function useCallerId() {
  const { user } = useAuth();
  const [numbers, setNumbers] = useState<CallerNumber[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: nums } = await (supabase.from('wk_numbers') as any)
      .select('id, e164, label, voice_enabled')
      .eq('is_active', true)
      .order('e164', { ascending: true });
    setNumbers((nums ?? []) as CallerNumber[]);
    if (user) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: prof } = await (supabase.from('profiles') as any)
        .select('default_caller_id_number_id')
        .eq('id', user.id)
        .maybeSingle();
      setDefaultId((prof?.default_caller_id_number_id as string | null) ?? null);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // null = "Auto (default number)" — clears the column so the server picks.
  const setCallerId = useCallback(
    async (numberId: string | null) => {
      if (!user) return;
      setDefaultId(numberId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('profiles') as any)
        .update({ default_caller_id_number_id: numberId })
        .eq('id', user.id);
    },
    [user],
  );

  return { numbers, defaultId, setCallerId, loading };
}
