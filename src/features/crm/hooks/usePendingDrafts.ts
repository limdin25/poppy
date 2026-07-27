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

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export function usePendingDrafts(): { contactIds: Set<string>; refetch: () => void } {
  const [contactIds, setContactIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('wk_sms_messages' as any) as any)
      .select('contact_id')
      .eq('status', 'draft')
      .limit(500);
    if (error) {
      console.warn('[usePendingDrafts] load failed:', error.message);
      return;
    }
    const next = new Set<string>();
    for (const r of (data ?? []) as Array<{ contact_id: string | null }>) {
      if (r.contact_id) next.add(r.contact_id);
    }
    setContactIds(next);
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

  return { contactIds, refetch: () => void load() };
}
