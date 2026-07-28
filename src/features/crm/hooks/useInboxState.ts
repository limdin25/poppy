// useInboxState — per-agent read / pinned / archived state for the CRM inbox.
//
// Hugo 2026-07-28: unread on top, a different colour when unread, a pin button
// and an archive button. The pin and the archive are PERSONAL (table
// wk_inbox_state, primary key (agent_id, contact_id)) so one agent tidying
// their sidebar never hides a lead from another agent.
//
// Unread is not stored here — it is derived in lib/inboxOrder.ts from the
// message timestamps the inbox already has. This hook only supplies
// last_read_at. Anything stored would eventually get stuck on.
//
// Writes are optimistic: the row flips in the UI immediately and the upsert
// follows. A failed write reports back so the caller can toast and reload,
// rather than leaving a lie on screen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface InboxFlags {
  lastReadAt: string | null;
  pinnedAt: string | null;
  archivedAt: string | null;
}

interface StateRow {
  contact_id: string;
  last_read_at: string | null;
  pinned_at: string | null;
  archived_at: string | null;
}

const EMPTY: InboxFlags = { lastReadAt: null, pinnedAt: null, archivedAt: null };

export interface InboxStateApi {
  flags: Map<string, InboxFlags>;
  /** Deliberate open of a thread. Fire and forget, no toast. */
  markRead: (contactId: string) => void;
  /** Returns null on success, an error message otherwise. */
  togglePin: (contactId: string) => Promise<string | null>;
  toggleArchive: (contactId: string) => Promise<string | null>;
  refetch: () => void;
}

export function useInboxState(): InboxStateApi {
  const [flags, setFlags] = useState<Map<string, InboxFlags>>(new Map());
  const uidRef = useRef<string | null>(null);
  // Clicking the same thread twice in a row must not fire two writes.
  const lastReadWriteRef = useRef<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    uidRef.current = authData.user?.id ?? null;
    if (!uidRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('wk_inbox_state' as any) as any)
      .select('contact_id, last_read_at, pinned_at, archived_at')
      .eq('agent_id', uidRef.current);
    if (error) {
      console.warn('[useInboxState] load failed:', error.message);
      return;
    }
    const next = new Map<string, InboxFlags>();
    for (const r of (data ?? []) as StateRow[]) {
      next.set(r.contact_id, {
        lastReadAt: r.last_read_at,
        pinnedAt: r.pinned_at,
        archivedAt: r.archived_at,
      });
    }
    setFlags(next);
  }, []);

  useEffect(() => {
    void load();
    // Same window open on a laptop and a desktop: pick the other one's pins up
    // on focus. No realtime subscription — this table is written by one human
    // at a time and a stale pin costs nothing.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const write = useCallback(
    async (contactId: string, patch: Partial<InboxFlags>): Promise<string | null> => {
      const uid = uidRef.current;
      if (!uid) return 'Not signed in';
      const prev = flags.get(contactId) ?? EMPTY;
      const next: InboxFlags = { ...prev, ...patch };
      setFlags((m) => new Map(m).set(contactId, next));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('wk_inbox_state' as any) as any).upsert(
        {
          agent_id: uid,
          contact_id: contactId,
          last_read_at: next.lastReadAt,
          pinned_at: next.pinnedAt,
          archived_at: next.archivedAt,
        },
        { onConflict: 'agent_id,contact_id' },
      );
      if (error) {
        setFlags((m) => new Map(m).set(contactId, prev)); // put it back
        return error.message;
      }
      return null;
    },
    [flags],
  );

  const markRead = useCallback(
    (contactId: string) => {
      const now = Date.now();
      const last = lastReadWriteRef.current.get(contactId) ?? 0;
      if (now - last < 3000) return;
      lastReadWriteRef.current.set(contactId, now);
      void write(contactId, { lastReadAt: new Date(now).toISOString() });
    },
    [write],
  );

  const togglePin = useCallback(
    (contactId: string) => {
      const cur = flags.get(contactId)?.pinnedAt ?? null;
      return write(contactId, { pinnedAt: cur ? null : new Date().toISOString() });
    },
    [flags, write],
  );

  const toggleArchive = useCallback(
    (contactId: string) => {
      const cur = flags.get(contactId)?.archivedAt ?? null;
      // Archiving also drops the pin: a thread cannot be both put away and
      // held at the top, and un-archiving into a pinned slot is a surprise.
      return write(contactId, {
        archivedAt: cur ? null : new Date().toISOString(),
        pinnedAt: cur ? (flags.get(contactId)?.pinnedAt ?? null) : null,
      });
    },
    [flags, write],
  );

  return { flags, markRead, togglePin, toggleArchive, refetch: () => void load() };
}
