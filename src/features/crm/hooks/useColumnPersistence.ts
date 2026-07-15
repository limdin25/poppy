// useColumnPersistence — write-through helpers for pipeline-column CRUD.
//
// PR 84 (Hugo 2026-04-27): "make sure pipelines work A to Z. you should
// be able to make pipelines in the settings as well." PipelinesTab in
// Settings already has the local-store CRUD wired (upsertColumn /
// patchColumn / removeColumn), but those are pure dispatches — refresh
// the page and the new column was gone. This hook persists each
// mutation to wk_pipeline_columns + wk_pipeline_automations.
//
// Mock IDs (e.g. "col-new-1729...") are converted to real UUIDs on insert.

import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { PipelineColumn } from '../types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export interface ColumnPersistAPI {
  /** Insert a brand-new column. Returns the real UUID assigned by Postgres,
   *  or null if the insert failed. The caller should swap the temporary
   *  store id for this UUID via patchColumn(tempId, { id: newUuid }) — but
   *  that's not a thing in our reducer, so a re-hydrate is the cleanest
   *  path. PipelinesTab triggers this for new "col-new-..." rows. */
  insertColumn: (col: PipelineColumn) => Promise<string | null>;
  /** Update one column's basic fields (name, colour, position, etc.).
   *  No-op when id is not a real UUID — the column is a draft from the
   *  store, will get persisted on the next insertColumn call. */
  updateColumn: (id: string, patch: Partial<PipelineColumn>) => Promise<boolean>;
  /** Update one column's automation row (sms / task / retry / tag). */
  updateAutomation: (
    columnId: string,
    patch: Partial<PipelineColumn['automation']>
  ) => Promise<boolean>;
  /** Delete a column (cascades to automation row + clears
   *  wk_contacts.pipeline_column_id pointers). */
  deleteColumn: (id: string) => Promise<boolean>;
}

export function useColumnPersistence(): ColumnPersistAPI {
  const insertColumn = useCallback(async (col: PipelineColumn): Promise<string | null> => {
    // pipelineId must be a real UUID. If the store's column was synthesized
    // off ACTIVE_PIPELINE.id (mock), bail with a clear console warning;
    // the caller is responsible for picking a real pipeline first.
    if (!isUuid(col.pipelineId)) {
      console.warn('[col-persist] insertColumn: pipelineId is not a UUID:', col.pipelineId);
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('wk_pipeline_columns' as any) as any)
      .insert({
        pipeline_id: col.pipelineId,
        name: col.name,
        colour: col.colour,
        icon: col.icon,
        position: col.position,
        sort_order: col.position,
        is_default_on_timeout: col.isDefaultOnTimeout ?? false,
        requires_followup: col.requiresFollowup ?? false,
      })
      .select('id')
      .single();
    if (error || !data?.id) {
      console.warn('[col-persist] insertColumn failed:', error?.message);
      return null;
    }
    const newId = data.id as string;

    // Insert the matching automation row so the column has full automation
    // settings from day 1.
    const a = col.automation;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('wk_pipeline_automations' as any) as any).insert({
      column_id: newId,
      send_sms: a.sendSms,
      sms_template_id: a.smsTemplateId ?? null,
      create_task: a.createTask,
      task_title: a.taskTitle ?? null,
      task_due_in_hours: a.taskDueInHours ?? null,
      retry_dial: a.retryDial,
      retry_in_hours: a.retryInHours ?? null,
      add_tag: a.addTag,
      tag: a.tag ?? null,
    });
    return newId;
  }, []);

  const updateColumn = useCallback(
    async (id: string, patch: Partial<PipelineColumn>): Promise<boolean> => {
      if (!isUuid(id)) return true; // local-only draft, no-op
      const dbPatch: Record<string, unknown> = {};
      if ('name' in patch) dbPatch.name = patch.name;
      if ('colour' in patch) dbPatch.colour = patch.colour;
      if ('icon' in patch) dbPatch.icon = patch.icon;
      if ('position' in patch) {
        dbPatch.position = patch.position;
        dbPatch.sort_order = patch.position;
      }
      if ('isDefaultOnTimeout' in patch) {
        dbPatch.is_default_on_timeout = patch.isDefaultOnTimeout;
      }
      if ('requiresFollowup' in patch) {
        dbPatch.requires_followup = patch.requiresFollowup;
      }
      if ('callScriptId' in patch) {
        dbPatch.call_script_id = patch.callScriptId ?? null;
      }
      if ('coachProfileId' in patch) {
        dbPatch.coach_profile_id = patch.coachProfileId ?? null;
      }
      if (Object.keys(dbPatch).length === 0) return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('wk_pipeline_columns' as any) as any)
        .update(dbPatch)
        .eq('id', id);
      if (error) {
        console.warn('[col-persist] updateColumn failed:', error.message);
        return false;
      }
      return true;
    },
    []
  );

  const updateAutomation = useCallback(
    async (columnId: string, patch: Partial<PipelineColumn['automation']>): Promise<boolean> => {
      if (!isUuid(columnId)) return true;
      const dbPatch: Record<string, unknown> = {};
      if ('sendSms' in patch) dbPatch.send_sms = patch.sendSms;
      if ('smsTemplateId' in patch) dbPatch.sms_template_id = patch.smsTemplateId ?? null;
      if ('createTask' in patch) dbPatch.create_task = patch.createTask;
      if ('taskTitle' in patch) dbPatch.task_title = patch.taskTitle ?? null;
      if ('taskDueInHours' in patch) dbPatch.task_due_in_hours = patch.taskDueInHours ?? null;
      if ('retryDial' in patch) dbPatch.retry_dial = patch.retryDial;
      if ('retryInHours' in patch) dbPatch.retry_in_hours = patch.retryInHours ?? null;
      if ('addTag' in patch) dbPatch.add_tag = patch.addTag;
      if ('tag' in patch) dbPatch.tag = patch.tag ?? null;
      if (Object.keys(dbPatch).length === 0) return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('wk_pipeline_automations' as any) as any)
        .upsert({ column_id: columnId, ...dbPatch }, { onConflict: 'column_id' });
      if (error) {
        console.warn('[col-persist] updateAutomation failed:', error.message);
        return false;
      }
      return true;
    },
    []
  );

  const deleteColumn = useCallback(async (id: string): Promise<boolean> => {
    if (!isUuid(id)) return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('wk_pipeline_columns' as any) as any)
      .delete()
      .eq('id', id);
    if (error) {
      console.warn('[col-persist] deleteColumn failed:', error.message);
      return false;
    }
    return true;
  }, []);

  return { insertColumn, updateColumn, updateAutomation, deleteColumn };
}
