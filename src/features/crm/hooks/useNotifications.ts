// useNotifications — the persistent half of the top-nav bell.
//
// Hugo 2026-07-26: every funnel action (link tapped, page opened, video played,
// 50/90/100% watched, £1 button clicked, checkout, paid) must raise a bell
// entry, a desktop pop-up and an email. This hook owns the first two.
//
// Unlike useInboxNotifications (whose cutoff is page-mount time, so a reload
// wipes it), these rows live in wk_notifications and survive. Unread = rows
// with read_at null, counted server-side.
//
// RLS does the scoping: agent_id = auth.uid() OR wk_is_admin(). Hugo sees every
// agent's leads; an agent sees only their own. So the subscription is
// deliberately UNfiltered — a filter would need the uid, which resolves async,
// and admins need no filter at all.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface FunnelNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  contactId: string | null;
  createdAt: string;
  readAt: string | null;
}

interface Row {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  contact_id: string | null;
  created_at: string;
  read_at: string | null;
}

const RECENT_LIMIT = 20;

export function useNotifications(): {
  items: FunnelNotification[];
  unread: number;
  markAllRead: () => void;
  /** Newest unread row since mount — what the desktop pop-up should announce. */
  latest: FunnelNotification | null;
} {
  const [items, setItems] = useState<FunnelNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<FunnelNotification | null>(null);
  // Rows already announced. A ref, not state, because the pop-up fires from the
  // realtime callback — firing from inside a setState updater would double-fire
  // under StrictMode (which is on in main.tsx), exactly as the legacy bell does.
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const load = useCallback(async () => {
    try {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const res = await (supabase.from('wk_notifications' as any) as any)
        .select('id, kind, title, body, link, contact_id, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT);
      const rows = (res.data ?? []) as Row[];
      const mapped: FunnelNotification[] = rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body ?? '',
        link: r.link,
        contactId: r.contact_id,
        createdAt: r.created_at,
        readAt: r.read_at,
      }));
      setItems(mapped);

      // A true count — a 20-row page cannot produce one.
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const countRes = await (supabase.from('wk_notifications' as any) as any)
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      setUnread(countRes.count ?? 0);

      // The first load is history, not news — prime `seen` so opening the CRM
      // doesn't pop up everything that happened overnight.
      if (!primed.current) {
        primed.current = true;
        mapped.forEach((m) => seen.current.add(m.id));
        return;
      }
      const fresh = mapped.find((m) => !m.readAt && !seen.current.has(m.id));
      if (fresh) {
        mapped.forEach((m) => seen.current.add(m.id));
        setLatest(fresh);
      }
    } catch {
      /* RLS / table missing — the bell stays quiet rather than crashing. */
    }
  }, []);

  useEffect(() => {
    void load();

    // Debounced: a single watch session lands 5-6 rows in 90 seconds and each
    // one should not cost a refetch (same reasoning as the funnel board).
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel('wk_notifications-bell')
      .on(
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'wk_notifications' },
        () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => void load(), 800);
        }
      )
      .subscribe();

    // Belt and braces, as everywhere else here: service-role inserts don't
    // always replicate.
    const pollId = window.setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);

    return () => {
      try {
        void supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
      if (debounce) clearTimeout(debounce);
      window.clearInterval(pollId);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const markAllRead = useCallback(() => {
    // Idempotent: the popover toggles constantly and each write is a round trip.
    if (unread === 0) return;
    setUnread(0);
    setItems((prev) => prev.map((p) => (p.readAt ? p : { ...p, readAt: new Date().toISOString() })));
    void (async () => {
      try {
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        await (supabase.from('wk_notifications' as any) as any)
          .update({ read_at: new Date().toISOString() })
          .is('read_at', null);
      } catch {
        /* ignore — the badge is already cleared locally */
      }
    })();
  }, [unread]);

  return useMemo(
    () => ({ items, unread, markAllRead, latest }),
    [items, unread, markAllRead, latest]
  );
}

/** Is a real desktop notification possible here?
 *  Undefined on iOS Safari outside an installed PWA; the constructor THROWS on
 *  Android Chrome without a service worker. The CRM is desktop-only anyway
 *  (the sidebar is `hidden md:flex` with no mobile nav). */
export function desktopPopupsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Show one, safely. Tagged by ROW id — tagging by contact would make the
 *  second event for a lead silently replace the first, and "they're on the page
 *  NOW" is exactly the one you don't want swallowed. */
export function showDesktopPopup(n: FunnelNotification, onClick?: () => void): void {
  if (!desktopPopupsSupported()) return;
  try {
    if (Notification.permission !== 'granted') return;
    const note = new Notification(n.title, { body: n.body, tag: n.id });
    note.onclick = () => {
      window.focus();
      onClick?.();
      note.close();
    };
  } catch {
    /* Android Chrome throws "Illegal constructor" — never break the bell. */
  }
}
