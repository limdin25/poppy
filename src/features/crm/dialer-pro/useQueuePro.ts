// useQueuePro — pending leads for the dialer-pro queue panel.
//
// 2026-05-22 (Hugo): converted from a bare useEffect+useState fetch to
// TanStack Query so the dialer queue stops "freezing at 0 leads" when
// the agent tabs away and back. The old hook ran ONE supabase.from(...)
// at mount; if that query hung (which it did intermittently — same
// transport/auth race that broke usePipelines), the React state stayed
// `queue=[]` forever and Start Dialer disabled with no recovery.
//
// New behaviour:
//   • Shared TanStack Query cache — every consumer of the same
//     campaignId reads the same data.
//   • Auto-retry on failure (3 attempts via TanStack defaults).
//   • Refetch on window focus + on reconnect — covers the tab-switch
//     freeze that left Elijah staring at an empty queue with 63 rows
//     actually present.
//   • Aggressive staleTime=0 so DB writes propagate fast; the realtime
//     channel below invalidates the cache on any change so the queue
//     is essentially live.
//   • removeLocal() still does optimistic UI removal — used when the
//     dialer pops a contact off the queue locally.

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';
import type { QueueLead } from './types';

interface QueueRow {
  id: string;
  contact_id: string;
  campaign_id: string;
  priority: number;
  attempts: number;
  scheduled_for: string | null;
  status: string;
  wk_contacts: {
    id: string;
    name: string | null;
    phone: string | null;
    pipeline_column_id: string | null;
    custom_fields: Record<string, string> | null;
  } | null;
}

function rowToLead(row: QueueRow): QueueLead | null {
  const contact = row.wk_contacts;
  if (!contact || !contact.phone) return null;
  const cf = contact.custom_fields || {};
  return {
    id: contact.id,
    contactId: contact.id,
    phone: contact.phone,
    name: contact.name ?? contact.phone,
    ownerName: (cf.owner_name || '').trim() || null,
    website: (cf.website || '').trim() || null,
    priority: row.priority ?? 0,
    attempts: row.attempts ?? 0,
    scheduledFor: row.scheduled_for,
    status: row.status as QueueLead['status'],
    campaignId: row.campaign_id,
    pipelineColumnId: contact.pipeline_column_id ?? null,
    queueRowId: row.id,
  };
}

async function fetchQueueRows(campaignId: string | null): Promise<QueueLead[]> {
  const nowIso = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase.from('wk_dialer_queue' as any) as any)
    .select(
      'id, contact_id, campaign_id, priority, attempts, scheduled_for, status, ' +
        'wk_contacts:contact_id!inner ( id, name, phone, pipeline_column_id, custom_fields, do_not_call )',
    )
    .eq('status', 'pending')
    // Never surface a suppressed lead. A trigger also skips their pending queue
    // rows the moment they're flagged, but this is the guard that matters: it
    // holds even if a row was queued before the flag was set (PECR reg 21 —
    // once they've said don't call, we don't call).
    .eq('wk_contacts.do_not_call', false)
    .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
    .order('priority', { ascending: false, nullsFirst: false })
    .order('scheduled_for', { ascending: true, nullsFirst: true })
    .order('attempts', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(200);

  // The queue is per-CAMPAIGN. "See as: <agent>" scopes the dialer by
  // restricting the CAMPAIGN LIST to the agent's campaigns (via
  // wk_campaign_agents in useDialerCampaigns) — pending queue rows carry no
  // agent_id until dialed, so filtering the queue by agent_id is wrong.
  if (campaignId && campaignId.trim() !== '') {
    q = q.eq('campaign_id', campaignId);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as QueueRow[])
    .map(rowToLead)
    .filter((l): l is QueueLead => l !== null);
}

export function useQueuePro(campaignId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['dialer-queue', campaignId ?? 'all'], [campaignId]);

  const query = useQuery<QueueLead[]>({
    queryKey,
    queryFn: () => fetchQueueRows(campaignId),
    // The realtime channel below invalidates on every DB change — we
    // explicitly opt into focus + reconnect refetch so a stale tab
    // (e.g. agent switched away during a token refresh) self-heals.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
    retry: 3,
  });

  // Realtime invalidation — any change to wk_dialer_queue triggers a
  // cache invalidation, which re-runs the query.
  useEffect(() => {
    const channelName = campaignId ? `dialer-pro-queue-${campaignId}` : 'dialer-pro-queue-all';
    const channel = supabase
      .channel(channelName)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'wk_dialer_queue',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, () => {
        void queryClient.invalidateQueries({ queryKey });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [campaignId, queryClient, queryKey]);

  const queue = query.data ?? [];

  // Optimistic local removal — same semantics as before. We mutate the
  // cached array directly so the UI updates instantly without waiting
  // for the realtime/refetch cycle.
  const removeLocal = useCallback(
    (contactId: string) => {
      queryClient.setQueryData<QueueLead[]>(queryKey, (prev) =>
        prev ? prev.filter((l) => l.contactId !== contactId) : prev,
      );
    },
    [queryClient, queryKey],
  );

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  return {
    queue,
    totalCount: queue.length,
    nextLead: queue[0] ?? null,
    refresh,
    removeLocal,
    loading: query.isLoading,
  };
}
