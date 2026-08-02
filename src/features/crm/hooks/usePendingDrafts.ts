// usePendingDrafts — which leads have an AI reply waiting for a human.
//
// Hugo 2026-07-27: the inbox row must show "waiting approval". Until now a
// pending AI draft was visible ONLY once you opened the thread, which is how 15
// inbound replies sat unanswered in July — nothing on the list said so.
//
// Deliberately NOT folded into useInboxThreads: that hook's message select is
// limit(1000) newest-first, so a draft older than that window would be
// invisible — silently wrong on exactly the stale drafts that matter most.
// Keyed by contact id, so the calls branch of the inbox list gets it too.
//
// The whole pending set is tiny and RLS already scopes it, so no `.in()` filter.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export function usePendingDrafts(): {
  contactIds: Set<string>;
  /** Newest pending draft body per contact, so the inbox row can show
   *  "AI draft: ..." as its preview (Hugo 2026-08-02: drafts must be
   *  visible without opening the DRAFTS filter). */
  draftByContact: Map<string, string>;
  refetch: () => void;
} {
  const [contactIds, setContactIds] = useState<Set<string>>(new Set());
  const [draftByContact, setDraftByContact] = useState<Map<string, string>>(new Map());
  // Stale-load guard, same shape as useInboxThreads (2026-08-02): realtime +
  // poll + focus can overlap, and an older result must never overwrite a
  // newer one.
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('wk_sms_messages' as any) as any)
      .select('contact_id, body, created_at')
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.warn('[usePendingDrafts] load failed:', error.message);
      return;
    }
    if (seq !== loadSeqRef.current) return; // superseded by a newer load
    const next = new Set<string>();
    const bodies = new Map<string, string>();
    for (const r of (data ?? []) as Array<{ contact_id: string | null; body: string | null }>) {
      if (!r.contact_id) continue;
      next.add(r.contact_id);
      // Rows arrive newest-first; the first body we meet per contact wins.
      if (!bodies.has(r.contact_id)) bodies.set(r.contact_id, r.body ?? '');
    }
    setContactIds(next);
    setDraftByContact(bodies);
  }, []);

  useEffect(() => {
    void load();

    // INSERT *and* UPDATE: wk-draft-action flips status draft -> sent/discarded,
    // it never inserts, so an INSERT-only subscription would leave the badge up
    // after the agent approved.
    const ch = supabase
      .channel('wk_sms_messages-pending-drafts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wk_sms_messages' },
        () => void load(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wk_sms_messages' },
        () => void load(),
      )
      .subscribe();

    // Realtime doesn't always replicate service-role writes — poll and refetch
    // on focus too, the house pattern.
    const timer = window.setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);

    return () => {
      void supabase.removeChannel(ch);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  return { contactIds, draftByContact, refetch: () => void load() };
}
