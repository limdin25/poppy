import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { Campaign } from '../types';

export interface DialerKpis {
  pending: number;
  total: number;
  msgSent: number;
  dials24h: number;
}

const EMPTY: DialerKpis = { pending: 0, total: 0, msgSent: 0, dials24h: 0 };

export function useDialerKpis(camp: Campaign | null, userId: string | null): DialerKpis {
  const [msgSent, setMsgSent] = useState(0);
  const [dials24h, setDials24h] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function load() {
      const todayMidnight = new Date();
      todayMidnight.setUTCHours(0, 0, 0, 0);
      const todayIso = todayMidnight.toISOString();
      const cutoff24h = new Date(Date.now() - 86_400_000).toISOString();

      const [smsRes, callsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_sms_messages' as any) as any)
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayIso)
          .eq('direction', 'outbound')
          .eq('created_by', userId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_calls' as any) as any)
          .select('id', { count: 'exact', head: true })
          .gte('started_at', cutoff24h)
          .eq('agent_id', userId),
      ]);
      if (cancelled) return;
      setMsgSent((smsRes?.count ?? 0) as number);
      setDials24h((callsRes?.count ?? 0) as number);
    }

    void load();

    const channelSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const smsChan = supabase
      .channel(`dialer-kpis-sms-${channelSuffix}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'wk_sms_messages' },
        () => { if (!cancelled) void load(); }
      )
      .subscribe();

    const callsChan = supabase
      .channel(`dialer-kpis-calls-${channelSuffix}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'wk_calls' },
        () => { if (!cancelled) void load(); }
      )
      .subscribe();

    const pollId = window.setInterval(() => {
      if (!cancelled) void load();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      try { void supabase.removeChannel(smsChan); } catch { /* ignore */ }
      try { void supabase.removeChannel(callsChan); } catch { /* ignore */ }
    };
  }, [userId]);

  if (!camp) return EMPTY;

  return {
    pending: camp.pendingLeads,
    total: camp.pendingLeads + camp.doneLeads,
    msgSent,
    dials24h,
  };
}
