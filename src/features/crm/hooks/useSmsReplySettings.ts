// useSmsReplySettings: admin hook for the per-campaign AI text-reply prompt.
//
// Hugo, 2026-07-28: "every campaign should have own reply prompt".
//
// Same cascade as useAiSettings: the workspace default lives in the single
// wk_ai_reply_settings row (id = 'default'), the per-campaign override lives in
// wk_campaign_ai_settings on the sms_reply_* columns. NULL or empty means
// inherit. The server-side twin of this merge is
// api/lib/campaign-reply-settings.ts, which is what actually generates the text.
//
// save() writes ONLY the four sms_reply_* columns. The coach editor
// (useAiSettings) writes only its own four columns on the same row. If either
// side ever upserts the whole row, one Save silently wipes the other feature's
// overrides.
//
// THE RULE for the switches: a campaign may be MORE cautious than the
// workspace, never less. What is stored here is what the operator ASKED for.
// What actually happens is the safer of the two, decided server side in
// api/lib/campaign-reply-settings.ts: auto send needs the workspace AND the
// campaign both on auto, and a workspace on draft holds every campaign on
// draft. Same shape as the off switch, which is an AND and can only ever turn a
// campaign off. Paused campaigns (wk_dialer_campaigns.is_active = false) are
// treated as off too.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type ReplyMode = 'draft' | 'auto';

export interface SmsReplySettings {
  /** The campaign override, or '' when inheriting. */
  prompt: string;
  /** null when inheriting. */
  mode: ReplyMode | null;
  /** '' when inheriting. */
  model: string;
  /** null when inheriting (which means on, subject to the global switch). */
  enabled: boolean | null;
}

export interface GlobalReplyDefaults {
  enabled: boolean;
  mode: ReplyMode;
  model: string;
  system_prompt: string;
}

const EMPTY: SmsReplySettings = { prompt: '', mode: null, model: '', enabled: null };

const GLOBAL_FALLBACK: GlobalReplyDefaults = {
  enabled: true,
  mode: 'draft',
  model: 'claude-sonnet-4-6',
  system_prompt: '',
};

export function useSmsReplySettings(campaignId: string | null): {
  /** The campaign's own values. Empty/null fields inherit. */
  settings: SmsReplySettings;
  /** The workspace defaults, shown greyed out when a field inherits. */
  global: GlobalReplyDefaults;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saved: boolean;
  fieldSource: Record<keyof SmsReplySettings, 'workspace' | 'campaign'>;
  setField: <K extends keyof SmsReplySettings>(k: K, v: SmsReplySettings[K]) => void;
  save: () => Promise<void>;
  resetField: (k: keyof SmsReplySettings) => Promise<void>;
} {
  const [settings, setSettings] = useState<SmsReplySettings>(EMPTY);
  const [global, setGlobal] = useState<GlobalReplyDefaults>(GLOBAL_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: g, error: ge } = await (supabase.from('wk_ai_reply_settings' as any) as any)
      .select('enabled, mode, model, system_prompt')
      .eq('id', 'default')
      .maybeSingle();
    if (ge) throw new Error(ge.message);
    setGlobal({ ...GLOBAL_FALLBACK, ...(g ?? {}) });

    if (!campaignId) {
      setSettings(EMPTY);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: c } = await (supabase.from('wk_campaign_ai_settings' as any) as any)
      .select('sms_reply_prompt, sms_reply_mode, sms_reply_model, sms_reply_enabled')
      .eq('campaign_id', campaignId)
      .maybeSingle();
    setSettings({
      prompt: (c?.sms_reply_prompt as string | null) ?? '',
      mode: (c?.sms_reply_mode as ReplyMode | null) ?? null,
      model: (c?.sms_reply_model as string | null) ?? '',
      enabled: (c?.sms_reply_enabled as boolean | null) ?? null,
    });
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const fieldSource: Record<keyof SmsReplySettings, 'workspace' | 'campaign'> = {
    prompt: settings.prompt.trim() ? 'campaign' : 'workspace',
    mode: settings.mode ? 'campaign' : 'workspace',
    model: settings.model.trim() ? 'campaign' : 'workspace',
    enabled: settings.enabled === null ? 'workspace' : 'campaign',
  };

  const setField = useCallback(
    <K extends keyof SmsReplySettings>(k: K, v: SmsReplySettings[K]) => {
      setSettings((s) => ({ ...s, [k]: v }));
      setSaved(false);
    },
    [],
  );

  const save = useCallback(async () => {
    if (!campaignId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // ONLY the sms_reply_* columns. See the header note.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from('wk_campaign_ai_settings' as any) as any)
        .upsert(
          {
            campaign_id: campaignId,
            sms_reply_prompt: settings.prompt.trim() || null,
            sms_reply_mode: settings.mode,
            sms_reply_model: settings.model.trim() || null,
            sms_reply_enabled: settings.enabled,
          },
          { onConflict: 'campaign_id' },
        );
      if (e) setError(e.message);
      else setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }, [campaignId, settings]);

  const resetField = useCallback(
    async (k: keyof SmsReplySettings) => {
      if (!campaignId) return;
      const col = {
        prompt: 'sms_reply_prompt',
        mode: 'sms_reply_mode',
        model: 'sms_reply_model',
        enabled: 'sms_reply_enabled',
      }[k];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from('wk_campaign_ai_settings' as any) as any)
        .update({ [col]: null })
        .eq('campaign_id', campaignId);
      if (e) {
        setError(e.message);
        return;
      }
      setSettings((s) => ({ ...s, [k]: k === 'prompt' || k === 'model' ? '' : null }));
      setSaved(false);
    },
    [campaignId],
  );

  return { settings, global, loading, saving, error, saved, fieldSource, setField, save, resetField };
}
