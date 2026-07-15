// useCoachFacts — admin CRUD + realtime read for coach KB facts.
//
// PR 56 (Hugo 2026-04-27): now campaign-aware. Pass a campaign id to
// scope edits + reads to that campaign's bundle (cascade fallback —
// workspace facts are inherited, campaign facts override on `key`
// collision). Pass nothing to edit the workspace defaults.
//
// The edge function `wk-voice-transcription` reads the merged view
// (workspace ∪ campaign — campaign wins) on every coach generation.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface CoachFact {
  id: string;
  key: string;
  label: string;
  value: string;
  keywords: string[];
  sort_order: number;
  is_active: boolean;
  /** Phase 1 migration 2026-04-30: groups facts in the FactsDrawer UI. */
  category: 'deal' | 'returns' | 'compliance' | 'logistics' | 'objection';
  updated_at: string;
  /** PR 56: which table this row came from. Drives UI ("inherited"
   *  badge for workspace rows in a campaign view; "override" badge
   *  for campaign rows that mask a workspace key). */
  source: 'workspace' | 'campaign';
  /** PR 56: when source='campaign', this is the campaign_id. */
  campaign_id?: string | null;
}

type FactInsert = Omit<CoachFact, 'id' | 'updated_at' | 'source' | 'campaign_id'>;
type FactPatch = Partial<FactInsert>;

interface CoachFactRow {
  id: string;
  key: string;
  label: string;
  value: string;
  keywords: string[];
  sort_order: number;
  is_active: boolean;
  category: CoachFact['category'];
  updated_at: string;
}

interface CampaignFactRow extends CoachFactRow {
  campaign_id: string;
}

interface UseCoachFactsOpts {
  activeOnly?: boolean;
  /** PR 56: when set, the hook returns the merged view of workspace
   *  facts ∪ this campaign's facts. CRUD writes go to the campaign
   *  table. When undefined, edits the workspace singleton (back-
   *  compatible behaviour). */
  campaignId?: string | null;
}

export function useCoachFacts(opts: UseCoachFactsOpts = {}) {
  const { activeOnly = false, campaignId = null } = opts;
  const [items, setItems] = useState<CoachFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // Always read workspace facts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wsRes = await (supabase.from('wk_coach_facts' as any) as any)
        .select('id, key, label, value, keywords, sort_order, is_active, category, updated_at')
        .order('sort_order', { ascending: true })
        .order('key', { ascending: true });

      let merged: CoachFact[] = ((wsRes.data ?? []) as CoachFactRow[]).map((r) => ({
        ...r,
        source: 'workspace' as const,
        campaign_id: null,
      }));

      // Layer campaign facts on top — campaign rows override workspace
      // rows on the same `key`.
      if (campaignId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cRes = await (supabase.from('wk_campaign_facts' as any) as any)
          .select('id, campaign_id, key, label, value, keywords, sort_order, is_active, category, updated_at')
          .eq('campaign_id', campaignId)
          .order('sort_order', { ascending: true });
        const campaignRows = (cRes.data ?? []) as CampaignFactRow[];
        const overrideKeys = new Set(campaignRows.map((r) => r.key));
        merged = [
          ...merged.filter((r) => !overrideKeys.has(r.key)),
          ...campaignRows.map(
            (r): CoachFact => ({
              id: r.id,
              key: r.key,
              label: r.label,
              value: r.value,
              keywords: r.keywords,
              sort_order: r.sort_order,
              is_active: r.is_active,
              category: r.category,
              updated_at: r.updated_at,
              source: 'campaign',
              campaign_id: r.campaign_id,
            })
          ),
        ];
        merged.sort((a, b) =>
          a.sort_order !== b.sort_order
            ? a.sort_order - b.sort_order
            : a.key.localeCompare(b.key)
        );
      }

      if (wsRes.error) {
        setError(wsRes.error.message);
      } else {
        setItems(activeOnly ? merged.filter((r) => r.is_active) : merged);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [activeOnly, campaignId]);

  useEffect(() => {
    let cancelled = false;
    void reload();

    const wsChan = supabase
      .channel('wk_coach_facts_changes')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_coach_facts' },
        () => { if (!cancelled) void reload(); }
      )
      .subscribe();

    let campChan: ReturnType<typeof supabase.channel> | null = null;
    if (campaignId) {
      campChan = supabase
        .channel(`wk_campaign_facts:${campaignId}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          {
            event: '*',
            schema: 'public',
            table: 'wk_campaign_facts',
            filter: `campaign_id=eq.${campaignId}`,
          },
          () => { if (!cancelled) void reload(); }
        )
        .subscribe();
    }

    return () => {
      cancelled = true;
      try { void supabase.removeChannel(wsChan); } catch { /* ignore */ }
      if (campChan) {
        try { void supabase.removeChannel(campChan); } catch { /* ignore */ }
      }
    };
  }, [reload, campaignId]);

  // PR 56: writes go to wk_campaign_facts when campaignId is set,
  // else to the workspace wk_coach_facts. The UI can flip between
  // editing workspace defaults and per-campaign overrides by
  // toggling the campaign picker.
  const targetTable = campaignId ? 'wk_campaign_facts' : 'wk_coach_facts';

  const add = useCallback(
    async (row: FactInsert) => {
      const payload: Record<string, unknown> = { ...row };
      if (campaignId) payload.campaign_id = campaignId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: e } = await (supabase.from(targetTable as any) as any)
        .insert(payload)
        .select(
          campaignId
            ? 'id, campaign_id, key, label, value, keywords, sort_order, is_active, category, updated_at'
            : 'id, key, label, value, keywords, sort_order, is_active, category, updated_at'
        )
        .single();
      if (e) throw new Error(e.message);
      if (!data) throw new Error('insert returned no row');
      return data as CoachFact;
    },
    [campaignId, targetTable]
  );

  const patch = useCallback(
    async (id: string, p: FactPatch) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from(targetTable as any) as any)
        .update(p)
        .eq('id', id);
      if (e) throw new Error(e.message);
    },
    [targetTable]
  );

  const remove = useCallback(
    async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from(targetTable as any) as any)
        .delete()
        .eq('id', id);
      if (e) throw new Error(e.message);
    },
    [targetTable]
  );

  return { items, loading, error, reload, add, patch, remove };
}
