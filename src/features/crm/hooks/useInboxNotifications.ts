// useInboxNotifications — top-nav bell feed.
//
// Hugo 2026-04-28 (PR 109): "I want a bell on the top nav with a
// counter when new inbound messages arrive." This hook subscribes to
// wk_sms_messages INSERTs (direction='inbound') and tracks the unread
// count since the user opened the page. Cap at 20 most-recent for the
// drawer.
//
// Source: realtime channel on wk_sms_messages, mirroring the pattern
// in useInboxThreads (subscribe + 30s poll + focus refetch as belts
// and braces; some service-role inserts don't always replicate).

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type ChannelKind = 'sms' | 'whatsapp' | 'email';

export interface InboxNotification {
  id: string;
  contactId: string;
  contactName: string;
  channel: ChannelKind;
  body: string;
  createdAt: string;
}

interface MessageRow {
  id: string;
  contact_id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  channel: ChannelKind | null;
  created_at: string;
}

interface ContactRow {
  id: string;
  name: string | null;
}

const RECENT_LIMIT = 20;

export function useInboxNotifications(): {
  unread: number;
  recent: InboxNotification[];
  markAllRead: () => void;
} {
  const [recent, setRecent] = useState<InboxNotification[]>([]);
  const [unread, setUnread] = useState(0);
  // Cutoff = the time the user first mounted this hook. Anything older
  // is treated as already-seen so we don't surface the entire history.
  const cutoffRef = useRef<string>(new Date().toISOString());

  const load = useMemo(
    () => async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msgsRes = await (supabase.from('wk_sms_messages' as any) as any)
          .select('id, contact_id, direction, body, channel, created_at')
          .eq('direction', 'inbound')
          .gte('created_at', cutoffRef.current)
          .order('created_at', { ascending: false })
          .limit(RECENT_LIMIT);
        const msgs = ((msgsRes.data ?? []) as MessageRow[]).filter(
          (m) => m.direction === 'inbound'
        );
        if (msgs.length === 0) {
          setRecent([]);
          return;
        }
        const ids = Array.from(new Set(msgs.map((m) => m.contact_id)));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contactsRes = await (supabase.from('wk_contacts' as any) as any)
          .select('id, name')
          .in('id', ids);
        const nameById = new Map<string, string>();
        for (const c of (contactsRes.data ?? []) as ContactRow[]) {
          nameById.set(c.id, c.name ?? 'Unknown');
        }
        const next: InboxNotification[] = msgs.map((m) => ({
          id: m.id,
          contactId: m.contact_id,
          contactName: nameById.get(m.contact_id) ?? 'Unknown',
          channel: (m.channel ?? 'sms') as ChannelKind,
          body: m.body,
          createdAt: m.created_at,
        }));
        setRecent((prev) => {
          // Bump unread by the number of NEW message ids we haven't seen.
          const prevIds = new Set(prev.map((p) => p.id));
          const fresh = next.filter((n) => !prevIds.has(n.id));
          if (fresh.length > 0) {
            setUnread((u) => u + fresh.length);
          }
          return next;
        });
      } catch {
        /* RLS / table missing — bell stays at 0, doesn't crash. */
      }
    },
    []
  );

  useEffect(() => {
    void load();

    const channel = supabase
      .channel('wk_sms_messages-bell')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'wk_sms_messages' },
        () => {
          void load();
        }
      )
      .subscribe();

    // Belt-and-braces: same 30s poll + focus refetch as useInboxThreads.
    const pollId = window.setInterval(() => {
      void load();
    }, 30_000);
    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      try {
        void supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
      window.clearInterval(pollId);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const markAllRead = () => setUnread(0);

  return { unread, recent, markAllRead };
}
