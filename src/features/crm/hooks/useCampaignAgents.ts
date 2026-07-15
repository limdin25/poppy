// useCampaignAgents — CRUD on wk_campaign_agents for /crm/settings.
// PR 56 (Hugo 2026-04-27).
//
// Each row = one (campaign_id, agent_id) tuple. The wk-dialer-start
// RPC will (in a follow-up) check this table to gate which agents
// may dial which campaigns. For now: pure admin UI CRUD + realtime.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface CampaignAgent {
  id: string;
  campaign_id: string;
  agent_id: string;
  role: 'agent' | 'manager';
  created_at: string;
}

export function useCampaignAgents(campaignId: string | null): {
  rows: CampaignAgent[];
  loading: boolean;
  error: string | null;
  add: (agentId: string, role?: 'agent' | 'manager') => Promise<void>;
  remove: (id: string) => Promise<void>;
  setRole: (id: string, role: 'agent' | 'manager') => Promise<void>;
} {
  const [rows, setRows] = useState<CampaignAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!campaignId) {
      setRows([]);
      setLoading(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: e } = await (supabase.from('wk_campaign_agents' as any) as any)
      .select('id, campaign_id, agent_id, role, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });
    if (e) {
      setError(e.message);
    } else {
      setRows((data ?? []) as CampaignAgent[]);
      setError(null);
    }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    void reload();
    if (!campaignId) return;
    const ch = supabase
      .channel(`wk_campaign_agents:${campaignId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'wk_campaign_agents',
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
    async (agentId: string, role: 'agent' | 'manager' = 'agent') => {
      if (!campaignId) throw new Error('No campaign selected');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from('wk_campaign_agents' as any) as any)
        .insert({ campaign_id: campaignId, agent_id: agentId, role });
      if (e) throw new Error(e.message);
    },
    [campaignId]
  );

  const remove = useCallback(async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('wk_campaign_agents' as any) as any)
      .delete()
      .eq('id', id);
    if (e) throw new Error(e.message);
  }, []);

  const setRole = useCallback(async (id: string, role: 'agent' | 'manager') => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('wk_campaign_agents' as any) as any)
      .update({ role })
      .eq('id', id);
    if (e) throw new Error(e.message);
  }, []);

  return { rows, loading, error, add, remove, setRole };
}
