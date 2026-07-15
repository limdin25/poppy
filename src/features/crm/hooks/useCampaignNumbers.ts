// useCampaignNumbers — CRUD on wk_campaign_numbers for /crm/settings.
// PR 56 (Hugo 2026-04-27).
//
// Each row pins one Twilio number (wk_numbers.id) to one campaign
// with a priority for rotation. wk-dialer-start (in a follow-up
// migration) will read this table to pick the from-number for an
// outbound call originated under campaign_id.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface CampaignNumber {
  id: string;
  campaign_id: string;
  number_id: string;
  priority: number;
  created_at: string;
}

export function useCampaignNumbers(campaignId: string | null): {
  rows: CampaignNumber[];
  loading: boolean;
  error: string | null;
  add: (numberId: string, priority?: number) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setPriority: (id: string, priority: number) => Promise<void>;
  /** PR 94 (Hugo 2026-04-28): swap which wk_numbers row is assigned to
   *  this campaign-channel slot. Same priority, different number. */
  swapNumber: (id: string, newNumberId: string) => Promise<void>;
} {
  const [rows, setRows] = useState<CampaignNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!campaignId) {
      setRows([]);
      setLoading(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: e } = await (supabase.from('wk_campaign_numbers' as any) as any)
      .select('id, campaign_id, number_id, priority, created_at')
      .eq('campaign_id', campaignId)
      .order('priority', { ascending: true });
    if (e) {
      setError(e.message);
    } else {
      setRows((data ?? []) as CampaignNumber[]);
      setError(null);
    }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    void reload();
    if (!campaignId) return;
    const ch = supabase
      .channel(`wk_campaign_numbers:${campaignId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'wk_campaign_numbers',
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => { if (!cancelled) void reload(); }
      )
      .subscribe();
    return () => {
      cancelled = true;
      try { void supabase.removeChannel(ch); } catch { /* ignore */ }
    };
  }, [reload, campaignId]);

  const add = useCallback(
    async (numberId: string, priority = 0) => {
      if (!campaignId) throw new Error('No campaign selected');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from('wk_campaign_numbers' as any) as any)
        .insert({ campaign_id: campaignId, number_id: numberId, priority });
      if (e) throw new Error(e.message);
    },
    [campaignId]
  );

  const remove = useCallback(async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('wk_campaign_numbers' as any) as any)
      .delete()
      .eq('id', id);
    if (e) throw new Error(e.message);
  }, []);

  const setPriority = useCallback(async (id: string, priority: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('wk_campaign_numbers' as any) as any)
      .update({ priority })
      .eq('id', id);
    if (e) throw new Error(e.message);
  }, []);

  const swapNumber = useCallback(async (id: string, newNumberId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('wk_campaign_numbers' as any) as any)
      .update({ number_id: newNumberId })
      .eq('id', id);
    if (e) throw new Error(e.message);
  }, []);

  return { rows, loading, error, add, remove, setPriority, swapNumber };
}
