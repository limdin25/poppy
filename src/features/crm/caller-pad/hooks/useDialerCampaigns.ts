// Caller — useDialerCampaigns hook.
// Ported from src/features/smsv2/hooks/useDialerCampaigns.ts. Loads
// wk_dialer_campaigns + queue rollups (pending / dialing / connected /
// voicemail / missed / done / skipped) for the dialer left rail and KPIs.
// Falls back to an empty array silently on RLS denial. Realtime
// subscription on wk_dialer_queue + wk_dialer_campaigns + 10s poll
// backup so counters stay accurate.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { Campaign } from '../types';

interface WkCampaignRow {
  id: string;
  name: string;
  pipeline_id: string | null;
  parallel_lines: number;
  auto_advance_seconds: number;
  ai_coach_enabled: boolean;
  ai_coach_prompt_id: string | null;
  script_md: string | null;
  created_by: string | null;
  is_active: boolean;
}

interface QueueRollup {
  campaign_id: string;
  totalRows: number;
  pending: number;
  dialing: number;
  connected: number;
  voicemail: number;
  missed: number;
  done: number;
  skipped: number;
  lost: number;
}

export function rowToCampaign(row: WkCampaignRow, queue: QueueRollup | undefined): Campaign {
  const pending = queue?.pending ?? 0;
  const dialing = queue?.dialing ?? 0;
  const connected = queue?.connected ?? 0;
  const voicemail = queue?.voicemail ?? 0;
  const missed = queue?.missed ?? 0;
  const done = queue?.done ?? 0;
  const skipped = queue?.skipped ?? 0;
  return {
    id: row.id,
    name: row.name,
    pipelineId: row.pipeline_id ?? '',
    ownerAgentId: row.created_by ?? '',
    // Each KPI card now shows its literal status count. Previously
    // doneLeads aggregated connected+voicemail+missed+skipped+done
    // which double-counted live calls into Done. 'lost' (added by the
    // three-strikes migration) was silently dropped from totalLeads.
    totalLeads: queue?.totalRows ?? 0,
    doneLeads: done,
    connectedLeads: connected,
    voicemailLeads: voicemail,
    pendingLeads: pending,
    dialingLeads: dialing,
    missedLeads: missed,
    skippedLeads: skipped,
    mode: 'parallel',
    parallelLines: row.parallel_lines,
    aiCoachEnabled: row.ai_coach_enabled,
    aiCoachPromptId: row.ai_coach_prompt_id ?? undefined,
    scriptMd: row.script_md ?? undefined,
    autoAdvanceSeconds: row.auto_advance_seconds,
  };
}

export interface UseDialerCampaignsResult {
  campaigns: Campaign[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface UseDialerCampaignsOpts {
  /** When true, include `is_active=false` campaigns. Settings page uses
   *  this; Dialer page passes `false`. */
  includeInactive?: boolean;
  /** When set, only return campaigns where this agent has a row in
   *  wk_campaign_agents. Used by /caller/dialer when an agent (non-admin)
   *  is signed in. Pass null/undefined to skip the filter (admin view). */
  scopedToAgentId?: string | null;
}

export function useDialerCampaigns(
  opts: UseDialerCampaignsOpts = {}
): UseDialerCampaignsResult {
  const { includeInactive = false, scopedToAgentId = null } = opts;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      let allowedCampaignIds: string[] | null = null;
      if (scopedToAgentId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: assignments } = await (supabase.from('wk_campaign_agents' as any) as any)
          .select('campaign_id')
          .eq('agent_id', scopedToAgentId);
        allowedCampaignIds = ((assignments ?? []) as { campaign_id: string }[]).map(
          (r) => r.campaign_id
        );
        if (allowedCampaignIds.length === 0) {
          if (!cancelled) {
            setCampaigns([]);
            setLoading(false);
          }
          return;
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let campaignsQuery = (supabase.from('wk_dialer_campaigns' as any) as any)
        .select(
          'id, name, pipeline_id, parallel_lines, auto_advance_seconds, ai_coach_enabled, ai_coach_prompt_id, script_md, created_by, is_active'
        )
        .order('name', { ascending: true });
      if (!includeInactive) {
        campaignsQuery = campaignsQuery.eq('is_active', true);
      }
      if (allowedCampaignIds) {
        campaignsQuery = campaignsQuery.in('id', allowedCampaignIds);
      }
      const nowIso = new Date().toISOString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let queueQuery = (supabase.from('wk_dialer_queue' as any) as any).select('campaign_id, status');
      if (allowedCampaignIds) {
        queueQuery = queueQuery.in('campaign_id', allowedCampaignIds);
      }
      if (scopedToAgentId) {
        queueQuery = queueQuery.or(`agent_id.eq.${scopedToAgentId},agent_id.is.null`);
      }
      // Separate query for "ready pending" — same filters as the panel
      // so the KPI Pending matches the Upcoming Queue count exactly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pendingQuery = (supabase.from('wk_dialer_queue' as any) as any)
        .select('campaign_id')
        .eq('status', 'pending')
        .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`);
      if (allowedCampaignIds) {
        pendingQuery = pendingQuery.in('campaign_id', allowedCampaignIds);
      }
      if (scopedToAgentId) {
        pendingQuery = pendingQuery.or(`agent_id.eq.${scopedToAgentId},agent_id.is.null`);
      }

      const [campaignsRes, queueRes, pendingRes] = await Promise.all([
        campaignsQuery,
        queueQuery,
        pendingQuery,
      ]);

      if (cancelled) return;

      if (campaignsRes.error) {
        setError(campaignsRes.error.message);
        setLoading(false);
        return;
      }

      // Count ready-pending per campaign from the DB query (same filter
      // as the panel so numbers match exactly).
      const pendingByCampaign = new Map<string, number>();
      for (const row of (pendingRes.data ?? []) as Array<{ campaign_id: string }>) {
        pendingByCampaign.set(row.campaign_id, (pendingByCampaign.get(row.campaign_id) ?? 0) + 1);
      }

      const rollups = new Map<string, QueueRollup>();
      for (const row of (queueRes.data ?? []) as Array<{ campaign_id: string; status: string }>) {
        const r = rollups.get(row.campaign_id) ?? {
          campaign_id: row.campaign_id,
          totalRows: 0,
          pending: 0,
          dialing: 0,
          connected: 0,
          voicemail: 0,
          missed: 0,
          done: 0,
          skipped: 0,
          lost: 0,
        };
        r.totalRows += 1;
        if (row.status === 'dialing') r.dialing += 1;
        else if (row.status === 'connected') r.connected += 1;
        else if (row.status === 'voicemail') r.voicemail += 1;
        else if (row.status === 'missed') r.missed += 1;
        else if (row.status === 'done') r.done += 1;
        else if (row.status === 'skipped') r.skipped += 1;
        else if (row.status === 'lost') r.lost += 1;
        rollups.set(row.campaign_id, r);
      }
      // Overwrite pending from the DB-filtered query so it matches
      // the panel's totalCount exactly (same scheduled_for filter).
      for (const [cid, count] of pendingByCampaign) {
        const r = rollups.get(cid);
        if (r) r.pending = count;
      }

      const mapped = (campaignsRes.data ?? []).map((row: WkCampaignRow) =>
        rowToCampaign(row, rollups.get(row.id))
      );
      setCampaigns(mapped);
      setLoading(false);
    }

    void load();

    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        if (!cancelled) void load();
      }, 500);
    };
    const channelSuffix = `${seq}-${Math.random().toString(36).slice(2, 8)}`;
    const queueChan = supabase
      .channel(`caller-dialer-campaigns-queue-${channelSuffix}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_dialer_queue' },
        refresh
      )
      .subscribe();
    const campaignsChan = supabase
      .channel(`caller-dialer-campaigns-meta-${channelSuffix}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_dialer_campaigns' },
        refresh
      )
      .subscribe();

    const pollId = window.setInterval(() => {
      if (!cancelled) void load();
    }, 10_000);

    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      window.clearInterval(pollId);
      try { void supabase.removeChannel(queueChan); } catch { /* ignore */ }
      try { void supabase.removeChannel(campaignsChan); } catch { /* ignore */ }
    };
  }, [seq, includeInactive, scopedToAgentId]);

  return {
    campaigns,
    loading,
    error,
    refetch: () => setSeq((s) => s + 1),
  };
}
