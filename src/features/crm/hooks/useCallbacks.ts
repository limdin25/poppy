// useCallbacks — who came back to us and has not been answered.
//
// Reads wk_callbacks_open (migration 20260826000001). The rule about WHO may
// appear lives in that function, not here: something of ours must have gone to
// them before they came back, which is what keeps marketing off the strip.
//
// Hostunico replies use the same RPC and strip, refreshed by realtime with a
// five-second fallback. Other desks retain their existing 45-second polling.
// The database records a reply before classification, so scheduling stops
// immediately even when AI classification is delayed or unavailable.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { Callback, CallbackKind } from '../lib/callbackList';
import { useDesk } from '../lib/DeskContext';
import { followupAction } from './useHostunicoFollowups';

interface RpcRow {
  contact_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  lead_type: string | null;
  kind: string | null;
  came_back_at: string;
  missed: boolean | null;
  preview: string | null;
}

const POLL_MS = 45_000;
const WINDOW_HOURS = 48;

export function useCallbacks(enabled = true): {
  items: Callback[];
  /** False until the first answer is back. The strip says "checking" rather
   *  than "nothing to call back" until then, because those are different
   *  things and only one of them is reassuring. */
  ready: boolean;
  error: string | null;
  dismiss: (contactId: string) => Promise<string | null>;
  refetch: () => void;
} {
  const [items, setItems] = useState<Callback[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useRef<string | null>(null);
  // A builder who rings back while Pedro is on Auction waits on the Houses strip.
  const { desk } = useDesk();

  const load = useCallback(async () => {
    if (!enabled) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: err } = await (supabase as any)
      .rpc('wk_callbacks_open', { p_hours: WINDOW_HOURS, p_desk: desk });
    setReady(true);
    if (err) { setError(err.message); return; }
    setError(null);
    const { data: sequences } = desk === 'sa' ? await (supabase as any).from('sa_report_followups').select('contact_id,intent,reason,confidence').not('replied_at', 'is', null) : { data: [] };
    setItems(((data ?? []) as RpcRow[]).map((r) => ({
      contactId: r.contact_id,
      name: r.contact_name ?? '',
      phone: r.contact_phone ?? '',
      leadType: r.lead_type,
      kind: (r.kind ?? 'sms') as CallbackKind,
      cameBackAt: r.came_back_at,
      missed: Boolean(r.missed),
      preview: String(r.preview ?? ''),
      ...((sequences ?? []).find((s: { contact_id: string }) => s.contact_id === r.contact_id) ?? {}),
    })));
  }, [enabled, desk]);

  // The first fetch. The rule below cannot see that every setState in `load`
  // happens after an await, so it reads this as a synchronous cascade. Same
  // shape, same suppression, as useAwaitingReply.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => { void load(); }, desk === 'sa' ? 5000 : POLL_MS);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [enabled, load, desk]);

  useEffect(() => {
    if (!enabled || desk !== 'sa') return;
    let classifying = false;
    const refresh = async () => {
      void load();
      if (classifying) return;
      classifying = true;
      try { await followupAction('classify'); await load(); } catch { /* The recorded neutral flag remains visible. */ }
      finally { classifying = false; }
    };
    void refresh();
    const channel = supabase.channel('hostunico-priority-replies').on('postgres_changes', { event: '*', schema: 'public', table: 'sa_report_followups' }, () => void refresh()).subscribe();
    const retry = window.setInterval(() => void refresh(), 30000);
    return () => { void supabase.removeChannel(channel); window.clearInterval(retry); };
  }, [enabled, desk, load]);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then((res: { data: { user: { id: string } | null } }) => {
      if (!cancelled) uid.current = res.data.user?.id ?? null;
    });
    return () => { cancelled = true; };
  }, []);

  // Same table the inbox writes, so "Answered" in either place clears both.
  // Optimistic, and it returns the error rather than throwing: a press that
  // failed must say so instead of quietly springing back on the next poll.
  const dismiss = useCallback(async (contactId: string): Promise<string | null> => {
    const before = items;
    setItems((rows) => rows.filter((r) => r.contactId !== contactId));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase.from('wk_thread_attention') as any)
      .upsert({
        contact_id: contactId,
        handled_at: new Date().toISOString(),
        handled_by: uid.current,
        snoozed_until: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'contact_id' });
    if (err) { setItems(before); return err.message; }
    return null;
  }, [items]);

  return { items, ready, error, dismiss, refetch: load };
}
