// useTerminologies — admin CRUD + agent-read for glossary + objections.
//
// PR 56 (Hugo 2026-04-27): now campaign-aware — same cascade pattern
// as useCoachFacts. Pass a campaign id to merge workspace defaults
// with that campaign's overrides; CRUD routes to the campaign table.
// Pass nothing to edit workspace defaults.
//
// Used by:
//   - Settings → Glossary tab (admin: list, add, edit, delete)
//   - TerminologyPane (col 4 of LiveCallScreen, agent read)

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type TerminologyCategory = 'glossary' | 'objection';

export interface Terminology {
  id: string;
  term: string;
  short_gist: string | null;
  definition_md: string;
  sort_order: number;
  is_active: boolean;
  category: TerminologyCategory;
  updated_at: string;
  /** PR 56: 'workspace' = inherited from wk_terminologies.
   *  'campaign' = campaign-specific override row. */
  source: 'workspace' | 'campaign';
  campaign_id?: string | null;
}

type TermInsert = Omit<Terminology, 'id' | 'updated_at' | 'source' | 'campaign_id'>;
type TermPatch = Partial<TermInsert>;

interface RawRow {
  id: string;
  term: string;
  short_gist: string | null;
  definition_md: string;
  sort_order: number;
  is_active: boolean;
  category: TerminologyCategory;
  updated_at: string;
  campaign_id?: string;
}

interface UseTerminologiesOpts {
  activeOnly?: boolean;
  campaignId?: string | null;
}

export function useTerminologies(opts: UseTerminologiesOpts = {}) {
  const { activeOnly = false, campaignId = null } = opts;
  const [items, setItems] = useState<Terminology[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wsRes = await (supabase.from('wk_terminologies' as any) as any)
        .select('id, term, short_gist, definition_md, sort_order, is_active, category, updated_at')
        .order('sort_order', { ascending: true })
        .order('term', { ascending: true });

      let merged: Terminology[] = ((wsRes.data ?? []) as RawRow[]).map((r) => ({
        id: r.id,
        term: r.term,
        short_gist: r.short_gist,
        definition_md: r.definition_md,
        sort_order: r.sort_order,
        is_active: r.is_active,
        category: r.category,
        updated_at: r.updated_at,
        source: 'workspace' as const,
        campaign_id: null,
      }));

      if (campaignId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cRes = await (supabase.from('wk_campaign_terminologies' as any) as any)
          .select('id, campaign_id, term, short_gist, definition_md, sort_order, is_active, category, updated_at')
          .eq('campaign_id', campaignId)
          .order('sort_order', { ascending: true });
        const campRows = (cRes.data ?? []) as RawRow[];
        const overrideTerms = new Set(campRows.map((r) => r.term));
        merged = [
          ...merged.filter((r) => !overrideTerms.has(r.term)),
          ...campRows.map(
            (r): Terminology => ({
              id: r.id,
              term: r.term,
              short_gist: r.short_gist,
              definition_md: r.definition_md,
              sort_order: r.sort_order,
              is_active: r.is_active,
              category: r.category,
              updated_at: r.updated_at,
              source: 'campaign',
              campaign_id: r.campaign_id ?? campaignId,
            })
          ),
        ];
        merged.sort((a, b) =>
          a.sort_order !== b.sort_order
            ? a.sort_order - b.sort_order
            : a.term.localeCompare(b.term)
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
      .channel('wk_terminologies_changes')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_terminologies' },
        () => { if (!cancelled) void reload(); }
      )
      .subscribe();
    let campChan: ReturnType<typeof supabase.channel> | null = null;
    if (campaignId) {
      campChan = supabase
        .channel(`wk_campaign_terminologies:${campaignId}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          {
            event: '*',
            schema: 'public',
            table: 'wk_campaign_terminologies',
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

  const targetTable = campaignId ? 'wk_campaign_terminologies' : 'wk_terminologies';

  const add = useCallback(
    async (row: TermInsert) => {
      const payload: Record<string, unknown> = { ...row };
      if (campaignId) payload.campaign_id = campaignId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: e } = await (supabase.from(targetTable as any) as any)
        .insert(payload)
        .select('id, term, short_gist, definition_md, sort_order, is_active, category, updated_at')
        .single();
      if (e) throw new Error(e.message);
      if (!data) throw new Error('insert returned no row');
      return data as Terminology;
    },
    [campaignId, targetTable]
  );

  const patch = useCallback(
    async (id: string, p: TermPatch) => {
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
