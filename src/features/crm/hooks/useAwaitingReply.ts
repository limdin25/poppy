// Who is waiting on us, straight from the database rather than from whatever
// the inbox happened to load.
//
// 2026-08-19 is why this exists: a builder asked a question, nobody answered for
// forty-one hours, and he cancelled the viewing. The rule to spot it lived in
// the client and was ANDed with a read stamp that a CLICK writes. See
// src/features/crm/lib/inboxOrder.ts and the migration
// 20260822000001_reply_sla_attention.sql.
//
// WHY IT CANNOT JUST READ THE INBOX'S OWN ROWS. useInboxThreads pulls
// `.limit(1000)` newest-first ACROSS THE WHOLE WORKSPACE and groups client-side.
// A thread waiting since 8 August whose newest message is row 1001 is not in the
// sidebar at all, so a pill computed from those rows would be a second, quieter
// version of the same bug. The RPC sees every row; the UI unions the two.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface WaitingRow {
  contactId: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastOutboundCallAt: string | null;
  channel: string | null;
  preview: string;
  waitingHours: number;
  handledAt: string | null;
  snoozedUntil: string | null;
}

interface RpcRow {
  contact_id: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_outbound_call_at: string | null;
  last_inbound_channel: string | null;
  last_inbound_body: string | null;
  waiting_hours: number | string | null;
  handled_at: string | null;
  snoozed_until: string | null;
}

const POLL_MS = 60_000;

export function useAwaitingReply(enabled = true): {
  waiting: Map<string, WaitingRow>;
  total: number;
  loading: boolean;
  error: string | null;
  markAnswered: (contactId: string, note?: string) => Promise<string | null>;
  snooze: (contactId: string, untilIso: string) => Promise<string | null>;
  refetch: () => void;
} {
  const [waiting, setWaiting] = useState<Map<string, WaitingRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .rpc('wk_threads_awaiting_reply', { p_min_hours: 0, p_require_outbound: true });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setError(null);
    const next = new Map<string, WaitingRow>();
    for (const r of ((data ?? []) as RpcRow[])) {
      next.set(r.contact_id, {
        contactId: r.contact_id,
        lastInboundAt: r.last_inbound_at,
        lastOutboundAt: r.last_outbound_at,
        lastOutboundCallAt: r.last_outbound_call_at,
        channel: r.last_inbound_channel,
        preview: String(r.last_inbound_body ?? ''),
        waitingHours: Number(r.waiting_hours) || 0,
        handledAt: r.handled_at,
        snoozedUntil: r.snoozed_until,
      });
    }
    setWaiting(next);
  }, [enabled]);

  useEffect(() => { void load(); }, [load]);

  // Realtime is best effort everywhere in this codebase (service-role inserts do
  // not always reach a subscriber), so the poll is the belt and the channel is
  // the braces, exactly as useNotifications does it.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => { void load(); }, POLL_MS);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [enabled, load]);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then((res: { data: { user: { id: string } | null } }) => {
      if (!cancelled) uid.current = res.data.user?.id ?? null;
    });
    return () => { cancelled = true; };
  }, []);

  /** Optimistic, and it returns an error string rather than throwing, matching
   *  useInboxState.write. A failed press must say so, not vanish. */
  const write = useCallback(async (
    contactId: string,
    patch: Record<string, unknown>,
  ): Promise<string | null> => {
    const before = waiting;
    setWaiting((m) => { const n = new Map(m); n.delete(contactId); return n; });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase.from('wk_thread_attention') as any)
      .upsert({ contact_id: contactId, updated_at: new Date().toISOString(), ...patch },
        { onConflict: 'contact_id' });
    if (err) { setWaiting(before); return err.message; }
    return null;
  }, [waiting]);

  const markAnswered = useCallback((contactId: string, note?: string) => write(contactId, {
    handled_at: new Date().toISOString(),
    handled_by: uid.current,
    handled_note: note ?? null,
    // Answering clears any snooze: the thread is done, not put off.
    snoozed_until: null,
  }), [write]);

  const snooze = useCallback((contactId: string, untilIso: string) => write(contactId, {
    snoozed_until: untilIso,
    snoozed_by: uid.current,
  }), [write]);

  return { waiting, total: waiting.size, loading, error, markAnswered, snooze, refetch: load };
}
