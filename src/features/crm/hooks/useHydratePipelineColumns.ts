// useHydratePipelineColumns — pumps real wk_pipeline_columns into the
// SmsV2Store so every page (Pipelines, ContactDetail, EditContactModal,
// PostCallPanel) sees real UUIDs instead of mock ids like "col-interested".
//
// Without this, the store stays seeded from MOCK_PIPELINES and any save
// that includes pipeline_column_id sends a synthetic id into a uuid FK,
// crashing the INSERT/UPDATE.
//
// Side-effect-only — replaces the `columns` array on first successful load.

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsV2 } from '../store/SmsV2Store';
import type { PipelineColumn } from '../types';

interface WkColumnRow {
  id: string;
  pipeline_id: string;
  name: string;
  colour: string | null;
  icon: string | null;
  position: number;
  is_default_on_timeout: boolean | null;
  requires_followup: boolean | null;
  call_script_id: string | null;
  coach_profile_id: string | null;
}

interface WkAutomationRow {
  column_id: string;
  send_sms: boolean;
  sms_template_id: string | null;
  create_task: boolean;
  task_title: string | null;
  task_due_in_hours: number | null;
  retry_dial: boolean;
  retry_in_hours: number | null;
  add_tag: boolean;
  tag: string | null;
  move_to_pipeline_id: string | null;
}

export function rowToPipelineColumn(
  row: WkColumnRow,
  automation: WkAutomationRow | undefined
): PipelineColumn {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    name: row.name,
    colour: row.colour ?? '#3C5A87',
    icon: row.icon ?? 'Sparkles',
    position: row.position,
    isDefaultOnTimeout: row.is_default_on_timeout ?? false,
    requiresFollowup: row.requires_followup ?? false,
    callScriptId: row.call_script_id ?? undefined,
    coachProfileId: row.coach_profile_id ?? undefined,
    automation: {
      sendSms: automation?.send_sms ?? false,
      smsTemplateId: automation?.sms_template_id ?? undefined,
      createTask: automation?.create_task ?? false,
      taskTitle: automation?.task_title ?? undefined,
      taskDueInHours: automation?.task_due_in_hours ?? undefined,
      retryDial: automation?.retry_dial ?? false,
      retryInHours: automation?.retry_in_hours ?? undefined,
      addTag: automation?.add_tag ?? false,
      tag: automation?.tag ?? undefined,
      moveToPipelineId: automation?.move_to_pipeline_id ?? undefined,
    },
  };
}

export function useHydratePipelineColumns(): void {
  const { setColumns } = useSmsV2();

  // SmsV2Store builds its api inside useMemo([state, ...]), so `setColumns`
  // gets a fresh reference every dispatch. Putting it in the effect deps
  // re-runs the effect on every store change, and since the effect itself
  // ends with setColumns(real) — which dispatches — that produced an infinite
  // fetch/render loop in production: the columns never settled, PostCallPanel
  // saw `columns: []`, and Hugo got the "No pipeline columns yet" empty
  // state even though the DB had 6 rows. Pin via a ref instead.
  const setColumnsRef = useRef(setColumns);
  setColumnsRef.current = setColumns;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [colsRes, autoRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_pipeline_columns' as any) as any)
          .select(
            'id, pipeline_id, name, colour, icon, position, is_default_on_timeout, requires_followup, call_script_id, coach_profile_id'
          )
          // Archived columns are hidden from the board AND from every stage
          // picker. The eight video-funnel columns were archived on 2026-07-27
          // — the funnel has its own board and no longer overwrites the call
          // outcome (20260727000009_unhijack_pipeline.sql).
          .eq('archived', false)
          .order('position', { ascending: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_pipeline_automations' as any) as any).select(
          'column_id, send_sms, sms_template_id, create_task, task_title, task_due_in_hours, retry_dial, retry_in_hours, add_tag, tag, move_to_pipeline_id'
        ),
      ]);

      if (cancelled) return;

      if (colsRes.error) {
        console.warn('[hydrate-columns] load failed:', colsRes.error.message);
        return;
      }

      const automationByCol = new Map<string, WkAutomationRow>();
      for (const a of (autoRes.data ?? []) as WkAutomationRow[]) {
        automationByCol.set(a.column_id, a);
      }

      const real: PipelineColumn[] = ((colsRes.data ?? []) as WkColumnRow[]).map(
        (row) => rowToPipelineColumn(row, automationByCol.get(row.id))
      );

      console.info('[hydrate-columns] loaded', real.length, 'columns');

      if (real.length > 0) {
        setColumnsRef.current(real);
      }
    }

    void load();

    // PR 96 (Hugo 2026-04-28): cross-page consistency \u2014 when admin
    // renames a pipeline column on /crm/settings, /crm/contacts must
    // reflect the new name without a refresh. Subscribe to changes
    // on wk_pipeline_columns + wk_pipeline_automations and re-load.
    const colsCh = supabase
      .channel('wk_pipeline_columns-hydrate')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_pipeline_columns' },
        () => { if (!cancelled) void load(); }
      )
      .subscribe();
    const autoCh = supabase
      .channel('wk_pipeline_automations-hydrate')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_pipeline_automations' },
        () => { if (!cancelled) void load(); }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { void supabase.removeChannel(colsCh); } catch { /* ignore */ }
      try { void supabase.removeChannel(autoCh); } catch { /* ignore */ }
    };
  }, []);
}
