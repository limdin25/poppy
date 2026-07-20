// useDialerCampaigns — loads real wk_dialer_campaigns plus their queue stats.
//
// The query joins wk_dialer_queue counts (pending/done/connected/voicemail)
// so the dialer left-rail and KPIs read live numbers without a second round-trip.
//
// Falls back to an empty array silently on RLS denial; the page renders
// "No campaigns yet" instead of crashing.

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
  voicemail_recording_url: string | null;
  voicemail_drop_enabled: boolean;
}

interface QueueRollup {
  campaign_id: string;
  pending: number;
  dialing: number;
  connected: number;
  voicemail: number;
  missed: number;
  done: number;
  skipped: number;
}

export function rowToCampaign(row: WkCampaignRow, queue: QueueRollup | undefined): Campaign {
  // PR (Hugo 2026-04-28): wk_dialer_queue.status has 7 values
  // (pending | dialing | connected | voicemail | missed | done | skipped).
  // The previous rollup only counted 4 (pending/done/connected/voicemail),
  // so any row that ended in `missed` or `skipped` vanished from the UI —
  // Tajul ran a campaign, dialed 9 leads with no answer, and the dashboard
  // still said "0 done · 0 connected" while Queue dropped from 20 → 11.
  // Now every status is bucketed and `totalLeads` is the true row count.
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
    totalLeads: pending + dialing + connected + voicemail + missed + done + skipped,
    // "Done" = call attempt completed without a live conversation
    // (done + missed + skipped). connected/voicemail are kept as
    // their own buckets because they're informative on their own.
    doneLeads: done + missed + skipped,
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
    // PR 60 (Hugo 2026-04-27): expose is_active to the Settings UI
    // so admin can pause/resume without deleting. The Campaign type
    // already has isActive: boolean (was missing from the mapper).
    isActive: row.is_active,
    voicemailRecordingUrl: row.voicemail_recording_url,
    voicemailDropEnabled: row.voicemail_drop_enabled,
  };
}

export interface UseDialerCampaignsResult {
  campaigns: Campaign[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface UseDialerCampaignsOpts {
  /** PR 60 (Hugo 2026-04-27): when true, include `is_active=false`
   *  campaigns. Dialer page wants only running ones (default = false);
   *  Settings page wants ALL campaigns so admins can see what they
   *  just created — even though new campaigns start inactive so a
   *  fresh row doesn't immediately start dialing. */
  includeInactive?: boolean;
  /** PR 62 (Hugo 2026-04-27): when set, only return campaigns where
   *  this agent has a row in wk_campaign_agents. Used by /crm/dialer
   *  + /crm/contacts when an agent (non-admin) is signed in so they
   *  only see their assigned campaigns. Pass null/undefined to skip
   *  the filter (admin view). */
  scopedToAgentId?: string | null;
}

export function useDialerCampaigns(
  opts: UseDialerCampaignsOpts = {},
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

      // PR 62: when scopedToAgentId is set, first resolve the
      // campaign IDs that agent is assigned to. Empty list = no
      // campaigns visible (return early).
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
          'id, name, pipeline_id, parallel_lines, auto_advance_seconds, ai_coach_enabled, ai_coach_prompt_id, script_md, created_by, is_active, voicemail_recording_url, voicemail_drop_enabled'
        )
        .order('name', { ascending: true });
      if (!includeInactive) {
        campaignsQuery = campaignsQuery.eq('is_active', true);
      }
      if (allowedCampaignIds) {
        campaignsQuery = campaignsQuery.in('id', allowedCampaignIds);
      }
      const [campaignsRes, queueRes] = await Promise.all([
        campaignsQuery,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_dialer_queue' as any) as any).select('campaign_id, status'),
      ]);

      if (cancelled) return;

      if (campaignsRes.error) {
        setError(campaignsRes.error.message);
        setLoading(false);
        return;
      }

      const rollups = new Map<string, QueueRollup>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of (queueRes.data ?? []) as Array<{ campaign_id: string; status: string }>) {
        const r = rollups.get(row.campaign_id) ?? {
          campaign_id: row.campaign_id,
          pending: 0,
          dialing: 0,
          connected: 0,
          voicemail: 0,
          missed: 0,
          done: 0,
          skipped: 0,
        };
        // PR (Hugo 2026-04-28): count every wk_dialer_queue status
        // value, not just 4. Was silently dropping missed/skipped/dialing.
        if (row.status === 'pending') r.pending += 1;
        else if (row.status === 'dialing') r.dialing += 1;
        else if (row.status === 'connected') r.connected += 1;
        else if (row.status === 'voicemail') r.voicemail += 1;
        else if (row.status === 'missed') r.missed += 1;
        else if (row.status === 'done') r.done += 1;
        else if (row.status === 'skipped') r.skipped += 1;
        rollups.set(row.campaign_id, r);
      }

      const mapped = (campaignsRes.data ?? []).map((row: WkCampaignRow) =>
        rowToCampaign(row, rollups.get(row.id))
      );
      setCampaigns(mapped);
      setLoading(false);
    }

    void load();

    // PR 54 (Hugo 2026-04-27): subscribe to wk_dialer_queue realtime
    // so Queue / Done / Connected / Voicemail counters refresh as
    // calls progress without the agent having to refresh the page.
    // Debounced via 500ms RAF so a burst of inserts (e.g. CSV upload)
    // doesn't trigger 50 refetches.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        if (!cancelled) void load();
      }, 500);
    };
    // PR 116 (Hugo 2026-04-28): unique channel names per consumer so
    // multiple instances of this hook (sidebar + right panel) don't
    // race on registration. Was 'dialer-campaigns-meta' shared.
    const channelSuffix = `${seq}-${Math.random().toString(36).slice(2, 8)}`;
    const queueChan = supabase
      .channel(`dialer-campaigns-queue-${channelSuffix}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_dialer_queue' },
        refresh
      )
      .subscribe();
    const campaignsChan = supabase
      .channel(`dialer-campaigns-meta-${channelSuffix}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_dialer_campaigns' },
        refresh
      )
      .subscribe();

    // PR 116: 10s polling backup. DELETE events from Supabase realtime
    // sometimes arrive without a payload or are silently dropped when
    // multiple consumers share a channel. Polling guarantees each
    // consumer's view stays accurate without hard refresh. Cheap query.
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
