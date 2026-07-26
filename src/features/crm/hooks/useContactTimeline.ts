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

// PR 32 (Hugo 2026-04-27): Twilio + sms_messages don't always store
// phone numbers in the same format. Build the common variants for the
// .or filter so inbound messages don't miss when from_number arrives
// without the leading '+'.
function phoneVariants(e164: string): string[] {
  const trimmed = e164.trim();
  if (!trimmed) return [];
  const digits = trimmed.replace(/[^0-9]/g, '');
  const out = new Set<string>();
  out.add(trimmed);                  // raw, e.g. '+447863992555'
  if (digits) {
    out.add(digits);                  // '447863992555'
    out.add(`+${digits}`);            // ensures leading +
  }
  return Array.from(out);
}

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

export interface ContactTimeline {
  calls: CallRecord[];
  sms: SmsMessage[];
  activities: ActivityEvent[];
  tasks: Task[];
  funnel: FunnelEvent[];
  loading: boolean;
}

export function useContactTimeline(contactId: string, contactPhone?: string): ContactTimeline {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [sms, setSms] = useState<SmsMessage[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [funnel, setFunnel] = useState<FunnelEvent[]>([]);
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
        // MUST stay inside this FIXED block: the sms query below is pushed
        // conditionally, and results[] is read positionally. Appended after it,
        // this would land at index 6 or 7 depending on whether the contact has
        // a phone, and every phoneless contact would render funnel rows as SMS.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_vsl_events' as any) as any)
          .select('id, type, meta, created_at, wk_vsl_pages!inner(contact_id)')
          .eq('wk_vsl_pages.contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(100),
      ];

      // sms_messages — only if we have the contact's phone to filter on.
      // Existing /sms/inbox owns this table; we only READ. Match either
      // direction so inbound + outbound show up.
      //
      // PR 32 (Hugo 2026-04-27): Twilio sometimes sends from_number with
      // the leading '+' and sometimes without; sms_messages stores the
      // raw value. Build all phone variants the contact's E.164 might
      // appear as so the .or() filter doesn't miss inbound messages.
      if (contactPhone) {
        const variants = phoneVariants(contactPhone);
        const orClause = variants
          .flatMap((v) => [`from_number.eq.${v}`, `to_number.eq.${v}`])
          .join(',');
        queries.push(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.from('sms_messages' as any) as any)
            .select('id, body, direction, created_at, from_number, to_number')
            .or(orClause)
            .order('created_at', { ascending: false })
            .limit(100)
        );
      }

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
      const smsRes = contactPhone ? results[7] : { data: [] };

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

    // PR 32 (Hugo 2026-04-27): subscribe to realtime sms_messages
    // INSERT so inbound replies appear in the inbox without having to
    // refresh the page. Filter is best-effort — the supabase realtime
    // filter syntax is exact-match only, so we listen on ALL inserts
    // and re-load if a row's from_number / to_number matches one of
    // the contact's phone variants.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (contactPhone) {
      const variantSet = new Set(phoneVariants(contactPhone));
      channel = supabase
        .channel(`sms_messages:${contactId}`)
        .on(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'postgres_changes' as any,
          { event: 'INSERT', schema: 'public', table: 'sms_messages' },
          (payload: { new?: { from_number?: string; to_number?: string } }) => {
            const row = payload.new ?? {};
            if (
              (row.from_number && variantSet.has(row.from_number)) ||
              (row.to_number && variantSet.has(row.to_number))
            ) {
              void load();
            }
          }
        )
        .subscribe();
    }

    return () => {
      cancelled = true;
      if (channel) {
        try {
          void supabase.removeChannel(channel);
        } catch {
          /* ignore */
        }
      }
    };
  }, [contactId, contactPhone]);

  return { calls, sms, activities, tasks, funnel, loading };
}
