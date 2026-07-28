// useContactTimeline — loads everything that should appear on
// ContactDetailPage's timeline for a single contact:
//
//   - wk_calls + wk_recordings + wk_call_intelligence  (real calls)
//   - wk_activities                                    (stage moves, notes, etc.)
//   - wk_tasks                                         (open + done tasks)
//   - sms_messages (read-only)                         (existing SMS history)
//
// Hugo's decision (2026-04-25): /smsv2 reads existing sms_messages
// read-only — the original /sms/inbox keeps writing it. Per-agent
// filtering happens at the page level (only show messages for the
// current agent's contacts).
//
// All queries skip if contactId is not a real UUID.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { isRealContactId } from './useContactPersistence';
import { rowToCall } from './useCalls';
import type { CallRecord, SmsMessage, ActivityEvent, Task } from '../types';

// phoneVariants() lived here to match the legacy sms_messages table's
// inconsistent number formats. That table is gone and both its query and its
// realtime subscription were removed with it (2026-07-26), so the helper had
// no remaining caller.

interface WkActivityRow {
  id: string;
  contact_id: string;
  agent_id: string | null;
  call_id: string | null;
  kind: ActivityEvent['kind'];
  title: string;
  body: string | null;
  ts: string;
}

interface WkTaskRow {
  id: string;
  contact_id: string;
  assignee_id: string | null;
  title: string;
  due_at: string | null;
  status: 'open' | 'done' | 'cancelled';
}

interface SmsMessageRow {
  id: string;
  body: string;
  direction: 'inbound' | 'outbound';
  created_at: string;
  from_number: string;
  to_number: string;
}

/** A video-funnel event on this lead's page — link tapped, page opened, video
 *  played, coverage milestone, £1 button, checkout, paid. Hugo 2026-07-26: this
 *  activity was previously invisible on the lead itself. */
export interface FunnelEvent {
  id: string;
  type: string;
  /** Coverage % for a `progress` row. */
  pct: number | null;
  label: string;
  ts: string;
}

const FUNNEL_LABELS: Record<string, string> = {
  link_click: 'Tapped the video link',
  open: 'Opened the video page',
  play: 'Started the video',
  progress: 'Watched',
  cta_click: 'Clicked "Start £1 Trial"',
  tier_pick: 'Picked a plan',
  calc: 'Used the value calculator',
  checkout_start: 'Started checkout',
  paid: 'Paid 🎉',
  auto_sms: 'Follow-up text sent',
};

/** A website-funnel event on this lead's demo site: opened, tapped the phone,
 *  used the chat, rang the AI, or got a follow-up. Same shape as FunnelEvent so
 *  the render branches stay simple. */
export interface SiteEvent {
  id: string;
  type: string;
  label: string;
  ts: string;
}

const SITE_LABELS: Record<string, string> = {
  sent: 'Website link texted',
  link_click: 'Tapped the website link',
  open: 'Opened their website',
  phone_tap: 'Tapped the phone number',
  chat_message: 'Used the chat on their site',
  call_started: 'Rang the AI receptionist',
  call_ended: 'Finished the AI call',
  followup_sent: 'Follow-up text sent',
  outbound_call: 'The AI rang them',
  checkout_start: 'Started checkout',
  converted: 'Paid',
};

export interface ContactTimeline {
  calls: CallRecord[];
  sms: SmsMessage[];
  activities: ActivityEvent[];
  tasks: Task[];
  funnel: FunnelEvent[];
  site: SiteEvent[];
  loading: boolean;
}

export function useContactTimeline(contactId: string, contactPhone?: string): ContactTimeline {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [sms, setSms] = useState<SmsMessage[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [funnel, setFunnel] = useState<FunnelEvent[]>([]);
  const [site, setSite] = useState<SiteEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!isRealContactId(contactId)) {
      // Mock contact — leave empty so the page falls back to MOCK_*
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);

      const queries: Promise<unknown>[] = [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_calls' as any) as any)
          .select(
            'id, contact_id, agent_id, direction, status, started_at, duration_sec, disposition_column_id, agent_note'
          )
          .eq('contact_id', contactId)
          .order('started_at', { ascending: false }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_recordings' as any) as any).select('call_id, storage_path, status'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_call_intelligence' as any) as any).select('call_id, summary'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_voice_call_costs' as any) as any).select('call_id, total_pence'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_activities' as any) as any)
          .select('id, contact_id, agent_id, call_id, kind, title, body, ts')
          .eq('contact_id', contactId)
          .order('ts', { ascending: false })
          .limit(100),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_tasks' as any) as any)
          .select('id, contact_id, assignee_id, title, due_at, status')
          .eq('contact_id', contactId)
          .order('due_at', { ascending: true, nullsFirst: false }),
        // Video-funnel events. wk_vsl_events has no contact_id — it hangs off
        // the page — so filter through an inner-joined wk_vsl_pages (one page
        // per contact, enforced by wk_vsl_pages_contact_idx).
        //
        // results[] is read positionally, so anything added here must keep its
        // fixed index (index 6).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_vsl_events' as any) as any)
          .select('id, type, meta, created_at, wk_vsl_pages!inner(contact_id)')
          .eq('wk_vsl_pages.contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(100),
        // Website-funnel events (index 7). Same shape of problem as the video
        // events above: wk_site_events hangs off the page, not the contact, so
        // it joins through wk_site_pages (one page per contact, enforced by
        // wk_site_pages_contact_idx).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_site_events' as any) as any)
          .select('id, type, meta, created_at, wk_site_pages!inner(contact_id)')
          .eq('wk_site_pages.contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(100),
      ];

      // The legacy `sms_messages` table was queried here for every contact
      // with a phone number. That table NO LONGER EXISTS — the CRM's messages
      // live in wk_sms_messages, read by useContactMessages — so the request
      // 404'd on every single contact open and was swallowed silently (this
      // hook checks no errors). Removed 2026-07-26 after the audit; `sms`
      // stays on the return type as an empty array so no caller breaks.

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = await Promise.all(queries);
      if (cancelled) return;

      const callsRes = results[0];
      const recRes = results[1];
      const intelRes = results[2];
      const costRes = results[3];
      const actRes = results[4];
      const tasksRes = results[5];
      const funnelRes = results[6];
      const siteRes = results[7];
      // Legacy source removed — see the note above. Kept as an empty result so
      // the mapping below and the `sms` field on the return type still hold.
      const smsRes: { data: SmsMessageRow[] } = { data: [] };

      // This hook checks no other errors, which is how a wrong embed would
      // become a permanently empty funnel with no diagnostic anywhere.
      if (funnelRes?.error) {
        console.warn('[useContactTimeline] funnel events query failed:', funnelRes.error);
      }
      setFunnel(
        ((funnelRes?.data ?? []) as Array<{
          id: string; type: string; meta: { pct?: number } | null; created_at: string;
        }>).map((e) => {
          const pct = typeof e.meta?.pct === 'number' ? e.meta.pct : null;
          const base = FUNNEL_LABELS[e.type] ?? e.type;
          return {
            id: e.id,
            type: e.type,
            pct,
            label: e.type === 'progress' && pct !== null ? `Watched ${pct}% of the video` : base,
            ts: e.created_at,
          };
        })
      );

      if (siteRes?.error) {
        console.warn('[useContactTimeline] site events query failed:', siteRes.error);
      }
      setSite(
        ((siteRes?.data ?? []) as Array<{
          id: string; type: string; meta: Record<string, unknown> | null; created_at: string;
        }>).map((e) => {
          const base = SITE_LABELS[e.type] ?? e.type;
          const dir = (e.meta as { direction?: string } | null)?.direction;
          return {
            id: e.id,
            type: e.type,
            // An inbound call is the lead ringing us, an outbound one is us
            // ringing them. Showing both as "call" would hide the difference
            // that actually matters to an agent.
            label:
              e.type === 'call_started' && dir === 'outbound' ? 'The AI rang them' : base,
            ts: e.created_at,
          };
        })
      );

      // Build call list with joined metadata
      const recById = new Map<string, { call_id: string; storage_path: string | null; twilio_media_url: string | null; status: string }>();
      for (const r of (recRes.data ?? []) as Array<{ call_id: string; storage_path: string | null; status: string }>) {
        recById.set(r.call_id, { ...r, twilio_media_url: null });
      }
      const intelById = new Map<string, { call_id: string; summary: string | null }>();
      for (const i of (intelRes.data ?? []) as Array<{ call_id: string; summary: string | null }>) {
        intelById.set(i.call_id, i);
      }
      const costById = new Map<string, { call_id: string; total_pence: number | null }>();
      for (const c of (costRes.data ?? []) as Array<{ call_id: string; total_pence: number | null }>) {
        costById.set(c.call_id, c);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCalls(((callsRes.data ?? []) as any[]).map((row) =>
        rowToCall(row, recById.get(row.id), intelById.get(row.id), costById.get(row.id))
      ));

      setActivities(
        ((actRes.data ?? []) as WkActivityRow[]).map((row): ActivityEvent => ({
          id: row.id,
          contactId: row.contact_id,
          kind: row.kind,
          title: row.title,
          body: row.body ?? undefined,
          ts: row.ts,
          agentId: row.agent_id ?? undefined,
          refId: row.call_id ?? undefined,
        }))
      );

      setTasks(
        ((tasksRes.data ?? []) as WkTaskRow[])
          .filter((row) => row.status !== 'cancelled')
          .map((row): Task => ({
            id: row.id,
            contactId: row.contact_id,
            title: row.title,
            dueAt: row.due_at ?? new Date().toISOString(),
            assignedAgentId: row.assignee_id ?? '',
            done: row.status === 'done',
          }))
      );

      setSms(
        ((smsRes.data ?? []) as SmsMessageRow[]).map((row): SmsMessage => ({
          id: row.id,
          contactId,
          direction: row.direction,
          body: row.body,
          sentAt: row.created_at,
        }))
      );

      setLoading(false);
    }

    void load();

    // The realtime subscription that used to live here watched `sms_messages`
    // INSERTs — the same dropped table as the query above, so it could never
    // fire. Inbound replies already arrive live via useContactMessages, which
    // listens on wk_sms_messages. Removed 2026-07-26 after the audit.

    return () => {
      cancelled = true;
    };
  }, [contactId, contactPhone]);

  return { calls, sms, activities, tasks, funnel, site, loading };
}
