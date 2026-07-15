// Caller — usePipelineColumns.
// Reads wk_pipeline_columns for a given pipeline_id.
//
// Pre-2026-05-22 a null pipelineId returned EVERY column from EVERY
// pipeline (the "no filter" path). That broke the wrap-up disposition
// grid for any campaign without pipeline_id set — agents saw all
// pipelines' columns flattened. Now a null pipelineId returns an empty
// array so call sites can render a "Link a pipeline to this campaign"
// empty state instead of misleading buttons.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface PipelineColumnRow {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  colour: string | null;
  icon: string | null;
  requires_followup: boolean | null;
}

export function usePipelineColumns(pipelineId: string | null) {
  const [columns, setColumns] = useState<PipelineColumnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      // 2026-05-22: short-circuit when no pipeline is selected so we
      // don't accidentally surface a cross-pipeline column dump.
      if (!pipelineId) {
        setColumns([]);
        setLoading(false);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = (supabase.from('wk_pipeline_columns' as any) as any)
        .select('id, pipeline_id, name, position, colour, icon, requires_followup')
        .eq('pipeline_id', pipelineId)
        .order('position', { ascending: true });

      const { data, error: e } = await q;
      if (cancelled) return;

      if (e) {
        setError(e.message);
        setColumns([]);
        setLoading(false);
        return;
      }
      setColumns((data ?? []) as PipelineColumnRow[]);
      setLoading(false);
    }

    void load();

    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        if (!cancelled) void load();
      }, 400);
    };

    const ch = supabase
      .channel(`caller-pipeline-columns-${pipelineId ?? 'all'}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_pipeline_columns' },
        refresh
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      try { void supabase.removeChannel(ch); } catch { /* ignore */ }
    };
  }, [pipelineId]);

  return { columns, loading, error };
}
