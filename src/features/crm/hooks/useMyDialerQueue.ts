// useMyDialerQueue — the agent's REAL "next 5" from wk_dialer_queue.
//
// Previously DialerPage rendered `contacts.slice(0, 5)` for the
// "MY QUEUE — Next 5" panel, which had nothing to do with the actual
// queue: it showed the first 5 hydrated contacts (random — could be a
// contact Tajul has never been assigned, or even from a different
// campaign). Hugo flagged this on 2026-04-28: the panel was telling
// agents they had leads to dial when the real queue was empty, and
// vice-versa.
//
// This hook fetches the real picker order an `agent_id` would receive
// from wk-leads-next: pending rows for the active campaign, scheduled
// in the past or unscheduled, ordered by priority then scheduled_for
// then attempts, limit 5. Includes a realtime subscription so the
// panel ticks down as the dialer transitions rows out of pending.
//
// Scope rules:
//   • admin (or no agentId given): sees every pending row in the
//     campaign — useful for /crm/dialer when an admin previews what
//     Tajul would dial next.
//   • agent (agentId set): sees rows assigned to them OR unassigned
//     rows (agent_id IS NULL) that the lead-picker would hand out.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface MyQueueLead {
  /** wk_contacts.id — used by the click-to-call action */
  id: string;
  /** wk_contacts.name — display */
  name: string;
  /** wk_contacts.phone — display */
  phone: string;
  /** wk_contacts.pipeline_column_id — feeds <StageSelector> */
  pipelineColumnId: string | null;
  /** wk_dialer_queue.id — useful if the caller wants to skip/cancel */
  queueId: string;
  /** wk_dialer_queue.priority — surfaced for the 🔥 hot-lead badge */
  priority: number;
  /** wk_dialer_queue.attempts — debug / future "tried 2x" badge */
  attempts: number;
}

interface QueueRow {
  id: string;
  contact_id: string;
  agent_id: string | null;
  status: string;
  priority: number;
  attempts: number;
  scheduled_for: string | null;
  // From the embedded select on wk_contacts:
  wk_contacts: {
    id: string;
    name: string | null;
    phone: string | null;
    pipeline_column_id: string | null;
  } | null;
}

export function useMyDialerQueue(
  campaignId: string | null,
  /** When set, restrict to rows assigned to this agent OR unassigned.
   *  Pass null/undefined for admin view (no scoping). */
  agentId: string | null,
  limit = 5
): { items: MyQueueLead[]; loading: boolean; error: string | null } {
  const [items, setItems] = useState<MyQueueLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!campaignId) {
      setItems([]);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);

      const nowIso = new Date().toISOString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase.from('wk_dialer_queue' as any) as any)
        .select(
          'id, contact_id, agent_id, status, priority, attempts, scheduled_for, ' +
            'wk_contacts:contact_id ( id, name, phone, pipeline_column_id )'
        )
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
        .order('priority', { ascending: false, nullsFirst: false })
        .order('scheduled_for', { ascending: true, nullsFirst: true })
        .order('attempts', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(limit);

      if (agentId) {
        // Either assigned to this agent OR unassigned (the picker would
        // claim those for them next).
        q = q.or(`agent_id.eq.${agentId},agent_id.is.null`);
      }

      const { data, error: err } = await q;

      if (cancelled) return;

      if (err) {
        // RLS denial returns an error; show empty state, surface the
        // message for debugging but don't crash the page.
        console.warn('[useMyDialerQueue] load failed:', err.message);
        setError(err.message);
        setItems([]);
        setLoading(false);
        return;
      }

      const mapped: MyQueueLead[] = ((data ?? []) as QueueRow[])
        .filter((r) => r.wk_contacts) // skip orphan queue rows
        .map((r) => ({
          id: r.wk_contacts!.id,
          name: r.wk_contacts!.name ?? r.wk_contacts!.phone ?? 'Unknown',
          phone: r.wk_contacts!.phone ?? '',
          pipelineColumnId: r.wk_contacts!.pipeline_column_id,
          queueId: r.id,
          priority: r.priority,
          attempts: r.attempts,
        }));

      setItems(mapped);
      setLoading(false);
    }

    void load();

    // Realtime — debounce inserts/updates so a CSV upload bulk-insert or
    // a rapid wk-dialer-tick burst doesn't slam the panel with 50 reloads.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        if (!cancelled) void load();
      }, 400);
    };

    const suffix = `${campaignId}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase
      .channel(`my-dialer-queue-${suffix}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_dialer_queue', filter: `campaign_id=eq.${campaignId}` },
        refresh
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      try { void supabase.removeChannel(ch); } catch { /* ignore */ }
    };
  }, [campaignId, agentId, limit]);

  return { items, loading, error };
}
