// useAgentScript — per-agent call script with priority resolution.
//
// Hugo 2026-04-30: each agent should be able to edit their own script
// and have it saved to Supabase. New rows in wk_call_scripts use the
// owner_agent_id column added in 20260430000000_smsv2_workspace_state.
//
// PR 56 (Hugo 2026-04-27): campaign-aware resolution. When the live
// call's campaign has a pinned script (wk_dialer_campaigns.call_script_id),
// it sits above the workspace default in the chain.
//
// Resolution priority on read:
//   1. Row WHERE owner_agent_id = auth.uid()       (agent's own)
//   2. Column-pinned via wk_pipeline_columns.call_script_id  (v16)
//   3. Campaign-pinned via wk_dialer_campaigns.call_script_id  (PR 56)
//   4. Row WHERE is_default = true                  (workspace default)
//   5. Empty (CallScriptPane shows hardcoded fallback)
//
// On save:
//   - If the agent already has a row, UPDATE it.
//   - Else INSERT a new row with owner_agent_id = auth.uid().
//   - Never touches the default. Admins editing the default use a
//     separate flow (Settings → AI coach → "Default script (admin)").

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AgentScript {
  id: string | null;
  source: 'own' | 'column' | 'campaign' | 'default' | 'empty';
  name: string;
  body_md: string;
}

const EMPTY: AgentScript = {
  id: null,
  source: 'empty',
  name: 'My script',
  body_md: '',
};

interface ScriptRow {
  id: string;
  name: string;
  body_md: string;
  owner_agent_id: string | null;
  is_default: boolean;
}

interface ScriptsTable {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string | boolean) => {
        order?: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{
            data: ScriptRow[] | null;
            error: { message: string } | null;
          }>;
        };
        limit: (n: number) => Promise<{
          data: ScriptRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
    insert: (v: Record<string, unknown>) => {
      select: (c: string) => {
        single: () => Promise<{
          data: ScriptRow | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (v: Record<string, unknown>) => {
      eq: (c: string, v: string) => Promise<{
        error: { message: string } | null;
      }>;
    };
  };
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
}

export function useAgentScript(opts: { campaignId?: string | null; pipelineColumnId?: string | null } = {}) {
  const { campaignId = null, pipelineColumnId = null } = opts;
  const [script, setScript] = useState<AgentScript>(EMPTY);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = supabase as unknown as ScriptsTable;
        const { data: userData } = await client.auth.getUser();
        const uid = userData.user?.id ?? null;
        if (cancelled) return;
        setAgentId(uid);

        // 1. Try the agent's own row.
        if (uid) {
          const { data: own } = await client
            .from('wk_call_scripts')
            .select('id, name, body_md, owner_agent_id, is_default')
            .eq('owner_agent_id', uid)
            .limit(1);
          if (cancelled) return;
          if (own && own.length > 0) {
            setScript({
              id: own[0].id,
              source: 'own',
              name: own[0].name,
              body_md: own[0].body_md,
            });
            return;
          }
        }

        // v17: 2. Column — check direct call_script_id, then coach_profile_id.
        if (pipelineColumnId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: colRow } = await (supabase.from('wk_pipeline_columns' as any) as any)
            .select('call_script_id, coach_profile_id')
            .eq('id', pipelineColumnId)
            .maybeSingle();
          const colScriptId = colRow?.call_script_id as string | null | undefined;
          const colProfileId = colRow?.coach_profile_id as string | null | undefined;

          // 2a. Direct call_script_id (legacy v16)
          if (colScriptId) {
            const { data: pinned } = await client
              .from('wk_call_scripts')
              .select('id, name, body_md, owner_agent_id, is_default')
              .eq('id', colScriptId)
              .limit(1);
            if (cancelled) return;
            if (pinned && pinned.length > 0) {
              setScript({
                id: pinned[0].id,
                source: 'column',
                name: pinned[0].name,
                body_md: pinned[0].body_md,
              });
              return;
            }
          }

          // 2b. Coach profile → profile's call_script_id (v17)
          if (colProfileId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: profile } = await (supabase.from('wk_coach_profiles' as any) as any)
              .select('call_script_id')
              .eq('id', colProfileId)
              .maybeSingle();
            const profileScriptId = profile?.call_script_id as string | null | undefined;
            if (profileScriptId) {
              const { data: pinned } = await client
                .from('wk_call_scripts')
                .select('id, name, body_md, owner_agent_id, is_default')
                .eq('id', profileScriptId)
                .limit(1);
              if (cancelled) return;
              if (pinned && pinned.length > 0) {
                setScript({
                  id: pinned[0].id,
                  source: 'column',
                  name: pinned[0].name,
                  body_md: pinned[0].body_md,
                });
                return;
              }
            }
          }
        }

        // v17: 3. Campaign — check direct call_script_id, then coach_profile_id.
        if (campaignId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: campRow } = await (supabase.from('wk_dialer_campaigns' as any) as any)
            .select('call_script_id, coach_profile_id')
            .eq('id', campaignId)
            .maybeSingle();
          const pinnedId = campRow?.call_script_id as string | null | undefined;
          const campProfileId = campRow?.coach_profile_id as string | null | undefined;

          // 3a. Direct call_script_id
          if (pinnedId) {
            const { data: pinned } = await client
              .from('wk_call_scripts')
              .select('id, name, body_md, owner_agent_id, is_default')
              .eq('id', pinnedId)
              .limit(1);
            if (cancelled) return;
            if (pinned && pinned.length > 0) {
              setScript({
                id: pinned[0].id,
                source: 'campaign',
                name: pinned[0].name,
                body_md: pinned[0].body_md,
              });
              return;
            }
          }

          // 3b. Coach profile → profile's call_script_id (v17)
          if (campProfileId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: profile } = await (supabase.from('wk_coach_profiles' as any) as any)
              .select('call_script_id')
              .eq('id', campProfileId)
              .maybeSingle();
            const profileScriptId = profile?.call_script_id as string | null | undefined;
            if (profileScriptId) {
              const { data: pinned } = await client
                .from('wk_call_scripts')
                .select('id, name, body_md, owner_agent_id, is_default')
                .eq('id', profileScriptId)
                .limit(1);
              if (cancelled) return;
              if (pinned && pinned.length > 0) {
                setScript({
                  id: pinned[0].id,
                  source: 'campaign',
                  name: pinned[0].name,
                  body_md: pinned[0].body_md,
                });
                return;
              }
            }
          }
        }

        // 3. Fall back to the workspace default.
        const { data: def } = await client
          .from('wk_call_scripts')
          .select('id, name, body_md, owner_agent_id, is_default')
          .eq('is_default', true)
          .limit(1);
        if (cancelled) return;
        if (def && def.length > 0) {
          setScript({
            id: def[0].id,
            source: 'default',
            name: def[0].name,
            body_md: def[0].body_md,
          });
          return;
        }

        // 4. Empty.
        setScript(EMPTY);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, pipelineColumnId]);

  const setField = useCallback(
    <K extends keyof AgentScript>(k: K, v: AgentScript[K]) => {
      setScript((s) => ({ ...s, [k]: v }));
      setSaved(false);
    },
    []
  );

  // Save the agent's own row. Always creates / updates the OWN row,
  // even if the agent is currently viewing the default (i.e. clicking
  // Save creates a personal copy that diverges from the default).
  //
  // Accepts an optional `override` so callers (like the inline edit
  // modal) can pass the latest form values directly without racing
  // setField — calling setField + save back-to-back would otherwise
  // hit the stale closure of `script`.
  const save = useCallback(
    async (override?: { name?: string; body_md?: string }) => {
      if (!agentId) {
        setError('Not signed in');
        return;
      }
      const draft = {
        ...script,
        ...(override?.name !== undefined ? { name: override.name } : {}),
        ...(override?.body_md !== undefined
          ? { body_md: override.body_md }
          : {}),
      };
      setSaving(true);
      setError(null);
      setSaved(false);
      try {
        const client = supabase as unknown as ScriptsTable;
        // If we're currently viewing the agent's own row, UPDATE it.
        // Otherwise INSERT a new row owned by the agent.
        if (draft.source === 'own' && draft.id) {
          const { error: e } = await client
            .from('wk_call_scripts')
            .update({ name: draft.name, body_md: draft.body_md })
            .eq('id', draft.id);
          if (e) {
            setError(e.message);
            return;
          }
          setScript(draft);
          setSaved(true);
          return;
        }
        const { data, error: e } = await client
          .from('wk_call_scripts')
          .insert({
            name: draft.name || 'My script',
            body_md: draft.body_md,
            owner_agent_id: agentId,
            is_default: false,
          })
          .select('id, name, body_md, owner_agent_id, is_default')
          .single();
        if (e) {
          setError(e.message);
          return;
        }
        if (data) {
          setScript({
            id: data.id,
            source: 'own',
            name: data.name,
            body_md: data.body_md,
          });
          setSaved(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'save failed');
      } finally {
        setSaving(false);
      }
    },
    [agentId, script]
  );

  // Reset agent's own row back to the default — DELETE the own row
  // (if any) and re-fetch the default for display.
  const resetToDefault = useCallback(async () => {
    if (!agentId) return;
    setSaving(true);
    try {
      // Use the same UPDATE-not-DELETE pattern as the rest of the
      // codebase to keep the row history; flip is_default=false and
      // null out owner_agent_id is risky (would orphan it). Cleaner:
      // just DELETE and re-resolve.
      const client = supabase as unknown as {
        from: (t: string) => {
          delete: () => {
            eq: (c: string, v: string) => Promise<{
              error: { message: string } | null;
            }>;
          };
        };
      };
      if (script.source === 'own' && script.id) {
        await client.from('wk_call_scripts').delete().eq('id', script.id);
      }
      // Reload the default
      const sc = supabase as unknown as ScriptsTable;
      const { data: def } = await sc
        .from('wk_call_scripts')
        .select('id, name, body_md, owner_agent_id, is_default')
        .eq('is_default', true)
        .limit(1);
      if (def && def.length > 0) {
        setScript({
          id: def[0].id,
          source: 'default',
          name: def[0].name,
          body_md: def[0].body_md,
        });
      } else {
        setScript(EMPTY);
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reset failed');
    } finally {
      setSaving(false);
    }
  }, [agentId, script]);

  return { script, loading, saving, saved, error, setField, save, resetToDefault };
}
