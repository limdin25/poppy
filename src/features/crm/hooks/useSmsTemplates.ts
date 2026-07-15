// useSmsTemplates — list + CRUD wk_sms_templates with the new
// stage-coupling field (move_to_stage_id) added in Phase 1 migration.
//
// PR 62 (Hugo 2026-04-27): now campaign-aware. Pass a campaign id to
// merge workspace templates with that campaign's overrides; CRUD
// routes to wk_campaign_sms_templates. Pass nothing to edit
// workspace defaults (legacy behaviour).
//
// Read scope (RLS-gated in 20260430000000_smsv2_workspace_state):
//   - is_global = true (shared)
//   - owner_agent_id = auth.uid() (own)

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type TemplateChannel = 'sms' | 'whatsapp' | 'email';

export interface SmsTemplate {
  id: string;
  name: string;
  body_md: string;
  is_global: boolean;
  owner_agent_id: string | null;
  move_to_stage_id: string | null;
  /** PR 60 / PR 64: which channel this template targets. NULL =
   *  universal (works on any channel). 'email' templates also need
   *  a non-empty subject (UI-validated). */
  channel: TemplateChannel | null;
  /** PR 64: subject line for email templates. */
  subject: string | null;
  attachment_url: string | null;
  created_at: string;
  updated_at: string;
  /** PR 62: 'workspace' (wk_sms_templates) or 'campaign'
   *  (wk_campaign_sms_templates). Drives the inherited / override UI. */
  source: 'workspace' | 'campaign';
  campaign_id?: string | null;
}

type TemplateInsert = Omit<SmsTemplate, 'id' | 'created_at' | 'updated_at' | 'source' | 'campaign_id'>;
type TemplatePatch = Partial<TemplateInsert>;

interface UseSmsTemplatesOpts {
  campaignId?: string | null;
}

interface RawWorkspaceRow {
  id: string;
  name: string;
  body_md: string;
  is_global: boolean;
  owner_agent_id: string | null;
  move_to_stage_id: string | null;
  channel: TemplateChannel | null;
  subject: string | null;
  attachment_url: string | null;
  created_at: string;
  updated_at: string;
}

interface RawCampaignRow {
  id: string;
  campaign_id: string;
  name: string;
  body_md: string;
  merge_fields: unknown;
  channel: TemplateChannel | null;
  subject: string | null;
  attachment_url: string | null;
  created_at: string;
  updated_at: string;
}

export function useSmsTemplates(opts: UseSmsTemplatesOpts = {}) {
  const { campaignId = null } = opts;
  const [items, setItems] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wsRes = await (supabase.from('wk_sms_templates' as any) as any)
        .select('id, name, body_md, is_global, owner_agent_id, move_to_stage_id, channel, subject, attachment_url, created_at, updated_at')
        .order('name', { ascending: true });

      let merged: SmsTemplate[] = ((wsRes.data ?? []) as RawWorkspaceRow[]).map(
        (r) => ({ ...r, source: 'workspace' as const, campaign_id: null })
      );

      if (campaignId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cRes = await (supabase.from('wk_campaign_sms_templates' as any) as any)
          .select('id, campaign_id, name, body_md, merge_fields, channel, subject, attachment_url, created_at, updated_at')
          .eq('campaign_id', campaignId)
          .order('name', { ascending: true });
        const campRows = (cRes.data ?? []) as RawCampaignRow[];
        const overrideNames = new Set(campRows.map((r) => r.name));
        merged = [
          ...merged.filter((r) => !overrideNames.has(r.name)),
          ...campRows.map(
            (r): SmsTemplate => ({
              id: r.id,
              name: r.name,
              body_md: r.body_md,
              is_global: false,
              owner_agent_id: null,
              move_to_stage_id: null,
              channel: r.channel,
              subject: r.subject,
              attachment_url: r.attachment_url ?? null,
              created_at: r.created_at,
              updated_at: r.updated_at,
              source: 'campaign',
              campaign_id: r.campaign_id,
            })
          ),
        ];
        merged.sort((a, b) => a.name.localeCompare(b.name));
      }

      if (wsRes.error) setError(wsRes.error.message);
      else {
        setItems(merged);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    let cancelled = false;
    void reload();

    const wsChan = supabase
      .channel('wk_sms_templates_changes')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_sms_templates' },
        () => { if (!cancelled) void reload(); }
      )
      .subscribe();
    let campChan: ReturnType<typeof supabase.channel> | null = null;
    if (campaignId) {
      campChan = supabase
        .channel(`wk_campaign_sms_templates:${campaignId}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          {
            event: '*',
            schema: 'public',
            table: 'wk_campaign_sms_templates',
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

  const targetTable = campaignId ? 'wk_campaign_sms_templates' : 'wk_sms_templates';

  const add = useCallback(
    async (row: TemplateInsert) => {
      const payload: Record<string, unknown> = { ...row };
      if (campaignId) {
        payload.campaign_id = campaignId;
        delete payload.is_global;
        delete payload.owner_agent_id;
        delete payload.move_to_stage_id;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: e } = await (supabase.from(targetTable as any) as any)
        .insert(payload)
        .select(
          campaignId
            ? 'id, campaign_id, name, body_md, merge_fields, channel, subject, created_at, updated_at'
            : 'id, name, body_md, is_global, owner_agent_id, move_to_stage_id, channel, subject, created_at, updated_at'
        )
        .single();
      if (e) throw new Error(e.message);
      if (!data) throw new Error('insert returned no row');
      await reload();
      return data;
    },
    [campaignId, targetTable, reload]
  );

  const patch = useCallback(
    async (id: string, p: TemplatePatch) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from(targetTable as any) as any)
        .update(p)
        .eq('id', id);
      if (e) throw new Error(e.message);
      await reload();
    },
    [targetTable, reload]
  );

  const remove = useCallback(
    async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from(targetTable as any) as any)
        .delete()
        .eq('id', id);
      if (e) throw new Error(e.message);
      await reload();
    },
    [targetTable, reload]
  );

  return { items, loading, error, reload, add, patch, remove };
}
