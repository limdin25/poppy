// useAiSettings — admin hook for AI coach config.
//
// PR 56 (Hugo 2026-04-27): now campaign-aware. When campaignId is
// passed, the hook merges the workspace singleton (wk_ai_settings,
// name='default') with the per-campaign override row
// (wk_campaign_ai_settings WHERE campaign_id = X). Save then writes
// to the per-campaign row only — NULL fields fall through to the
// workspace value at coach generation time (cascade fallback).
//
// When campaignId is null/undefined, behaviour is unchanged: the
// hook reads + writes the workspace singleton (legacy admin path).

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AiSettings {
  openai_api_key: string;
  postcall_model: string;
  live_coach_model: string;
  whisper_model: string;
  ai_enabled: boolean;
  live_coach_enabled: boolean;
  postcall_system_prompt: string;
  /** @deprecated 2026-04-29 — replaced by coach_style_prompt + coach_script_prompt + wk_coach_facts. Kept as fallback only. */
  live_coach_system_prompt: string;
  /** Voice / tone / bans layer. Hugo 2026-04-29 three-layer split. */
  coach_style_prompt: string;
  /** Call stages + decision rules + retrieval instruction layer. */
  coach_script_prompt: string;
}

/** PR 56: which fields a campaign may override. The rest (api keys,
 *  feature flags, whisper model) are workspace-only. */
const CAMPAIGN_OVERRIDABLE_FIELDS: ReadonlyArray<keyof AiSettings> = [
  'coach_style_prompt',
  'coach_script_prompt',
  'live_coach_model',
  'postcall_model',
];

const DEFAULTS: AiSettings = {
  openai_api_key: '',
  postcall_model: 'gpt-4o-mini',
  live_coach_model: 'gpt-5.4-mini',
  whisper_model: 'whisper-1',
  ai_enabled: true,
  live_coach_enabled: true,
  postcall_system_prompt:
    'You are a sales-call analyst. Summarise the call, score sentiment 0-100, list next steps.',
  live_coach_system_prompt: '', // legacy, deprecated
  coach_style_prompt: '',
  coach_script_prompt: '',
};

interface UseAiSettingsOpts {
  /** PR 56: when set, the hook reads + writes wk_campaign_ai_settings
   *  for this campaign, with cascade fallback to the workspace
   *  singleton. */
  campaignId?: string | null;
}

export function useAiSettings(opts: UseAiSettingsOpts = {}): {
  settings: AiSettings;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saved: boolean;
  /** PR 56: per-field source map — 'workspace' for inherited values,
   *  'campaign' for overridden ones. Undefined for fields outside the
   *  CAMPAIGN_OVERRIDABLE_FIELDS list. */
  fieldSource: Partial<Record<keyof AiSettings, 'workspace' | 'campaign'>>;
  setField: <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => void;
  save: () => Promise<void>;
  /** PR 56: clear a campaign-specific override so the field falls
   *  back to workspace. No-op when not in campaign mode. */
  resetField: (k: keyof AiSettings) => Promise<void>;
} {
  const { campaignId = null } = opts;
  const [settings, setSettings] = useState<AiSettings>(DEFAULTS);
  const [fieldSource, setFieldSource] = useState<
    Partial<Record<keyof AiSettings, 'workspace' | 'campaign'>>
  >({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Workspace singleton (always read).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: ws, error: e } = await (supabase.from('wk_ai_settings' as any) as any)
          .select(
            'openai_api_key, postcall_model, live_coach_model, whisper_model, ai_enabled, live_coach_enabled, postcall_system_prompt, live_coach_system_prompt, coach_style_prompt, coach_script_prompt'
          )
          .eq('name', 'default')
          .maybeSingle();
        if (cancelled) return;

        if (e) {
          setError(e.message);
          return;
        }

        let merged: AiSettings = { ...DEFAULTS, ...(ws ?? {}) };
        const sourceMap: Partial<Record<keyof AiSettings, 'workspace' | 'campaign'>> = {};
        for (const k of CAMPAIGN_OVERRIDABLE_FIELDS) sourceMap[k] = 'workspace';

        if (campaignId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: camp } = await (supabase.from('wk_campaign_ai_settings' as any) as any)
            .select('coach_style_prompt, coach_script_prompt, live_coach_model, postcall_model')
            .eq('campaign_id', campaignId)
            .maybeSingle();
          if (cancelled) return;
          if (camp) {
            for (const k of CAMPAIGN_OVERRIDABLE_FIELDS) {
              const v = (camp as Record<string, unknown>)[k];
              if (v !== null && v !== undefined && v !== '') {
                (merged as unknown as Record<string, unknown>)[k] = v;
                sourceMap[k] = 'campaign';
              }
            }
          }
        }

        setSettings(merged);
        setFieldSource(sourceMap);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const setField = useCallback(
    <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => {
      setSettings((s) => ({ ...s, [k]: v }));
      setSaved(false);
      // Optimistically flip source to 'campaign' when in campaign
      // mode + the field is overridable. The actual save() persists.
      if (campaignId && CAMPAIGN_OVERRIDABLE_FIELDS.includes(k)) {
        setFieldSource((m) => ({ ...m, [k]: 'campaign' }));
      }
    },
    [campaignId]
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (campaignId) {
        // PR 56: write only the overridable fields to the per-
        // campaign table. NULL/empty values mean "fall back to
        // workspace" — but a user clicking Save with an empty box
        // probably means "clear the override", so we send "" which
        // the edge fn fallback ladder treats as absent.
        const payload: Record<string, unknown> = { campaign_id: campaignId };
        for (const k of CAMPAIGN_OVERRIDABLE_FIELDS) {
          payload[k] = settings[k] ?? null;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: e } = await (supabase.from('wk_campaign_ai_settings' as any) as any)
          .upsert(payload, { onConflict: 'campaign_id' });
        if (e) {
          setError(e.message);
        } else {
          setSaved(true);
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: e } = await (supabase.from('wk_ai_settings' as any) as any)
          .upsert({ name: 'default', ...settings }, { onConflict: 'name' });
        if (e) {
          setError(e.message);
        } else {
          setSaved(true);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }, [settings, campaignId]);

  const resetField = useCallback(
    async (k: keyof AiSettings) => {
      if (!campaignId) return;
      if (!CAMPAIGN_OVERRIDABLE_FIELDS.includes(k)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from('wk_campaign_ai_settings' as any) as any)
        .update({ [k]: null })
        .eq('campaign_id', campaignId);
      if (e) {
        setError(e.message);
        return;
      }
      // Re-load to pick up the workspace fallback.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: ws } = await (supabase.from('wk_ai_settings' as any) as any)
        .select(`${String(k)}`)
        .eq('name', 'default')
        .maybeSingle();
      const wsValue = (ws ?? {})[k as string];
      setSettings((s) => ({ ...s, [k]: wsValue ?? DEFAULTS[k] }));
      setFieldSource((m) => ({ ...m, [k]: 'workspace' }));
      setSaved(false);
    },
    [campaignId]
  );

  return { settings, loading, saving, error, saved, fieldSource, setField, save, resetField };
}
