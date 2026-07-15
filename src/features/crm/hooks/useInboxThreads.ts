// useInboxThreads — list of conversations for the /crm inbox.
// PR 50 (Hugo 2026-04-27).
//
// Returns one row per contact who has at least one wk_sms_messages
// entry, summarising the latest message + direction + timestamp.
// Sorted by latest activity descending. Realtime-subscribed:
// any INSERT into wk_sms_messages re-runs the load.
//
// PR 119 (Hugo 2026-04-28): per-agent inbox isolation.
// Migration 20260430000018 (PR 52) deliberately opened up
// wk_sms_messages SELECT to any CRM-eligible role with the comment
// "per-contact filtering is done by the application — the sidebar
// shows contacts the user owns; admins see all". That app-side
// filter never landed, so logging in as an agent showed every
// other agent's inbox. We now do that filter here:
//   - Admins (hardcoded email OR profiles.workspace_role = 'admin')
//     keep the whole-workspace view.
//   - Agents see only contacts they own (wk_contacts.owner_agent_id)
//     OR are actively assigned to (wk_lead_assignments status
//     IN ('assigned','in_progress')) — the same predicate used by
//     the wk_contacts RLS policy.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';

export type ChannelKind = 'sms' | 'whatsapp' | 'email';

export interface InboxThread {
  contactId: string;
  contactName: string;
  contactPhone: string;
  lastMessageBody: string;
  lastMessageAt: string;
  lastDirection: 'inbound' | 'outbound';
  /** PR 78: channel of the latest message. Used by inbox filter
   *  pills + thread-row icon. */
  lastChannel: ChannelKind;
  /** Per-channel count of messages on this thread (helps the agent
   *  see "this contact has 4 SMS + 1 WA + 2 email" at a glance). */
  channelCounts: Record<ChannelKind, number>;
  /** Inbound-only count of messages newer than the contact's
   *  last_read_at (not yet implemented — placeholder = 0). */
  unreadCount: number;
}

interface MessageRow {
  id: string;
  contact_id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  created_at: string;
  channel: ChannelKind | null;
}

interface ContactRow {
  id: string;
  name: string;
  phone: string;
}

export function useInboxThreads(): { threads: InboxThread[]; loading: boolean; refetch: () => void } {
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useAuth();

  const load = useCallback(async () => {
    // PR 119: resolve current user + admin status before querying so
    // we can scope the inbox per-user. RLS on wk_sms_messages is open
    // to any CRM role (PR 52); ownership filtering is the app's job.
    // Admin status comes from the CRM auth shim (admin_users allow-list).
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id ?? null;

    // Build the contact-id allow-list for non-admins. Mirrors the
    // wk_contacts RLS predicate: owner OR active lead-assignment.
    let allowedContactIds: string[] | null = null;
    if (!isAdmin && uid) {
      const [ownedRes, assignedRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_contacts' as any) as any)
          .select('id')
          .eq('owner_agent_id', uid),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_lead_assignments' as any) as any)
          .select('contact_id')
          .eq('agent_id', uid)
          .in('status', ['assigned', 'in_progress']),
      ]);
      const ids = new Set<string>();
      for (const r of (ownedRes.data ?? []) as Array<{ id: string }>) ids.add(r.id);
      for (const r of (assignedRes.data ?? []) as Array<{ contact_id: string }>) {
        ids.add(r.contact_id);
      }
      allowedContactIds = Array.from(ids);

      // Agent owns nothing → empty inbox. Skip the round-trip.
      if (allowedContactIds.length === 0) {
        setThreads([]);
        setLoading(false);
        return;
      }
    }

    // Strategy: pull the last 500 messages, group client-side. Then
    // fetch only the contacts referenced by those messages (not all
    // 17k+ contacts). This keeps the query small and fast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let msgsQuery = (supabase.from('wk_sms_messages' as any) as any)
      .select('id, contact_id, direction, body, created_at, channel')
      .order('created_at', { ascending: false })
      .limit(500);
    if (allowedContactIds !== null) {
      msgsQuery = msgsQuery.in('contact_id', allowedContactIds);
    }
    const msgsRes = await msgsQuery;
    const msgs = (msgsRes.data ?? []) as MessageRow[];

    // Collect unique contact IDs from messages, then fetch just those.
    const neededIds = Array.from(new Set(msgs.map((m) => m.contact_id)));
    const contactById = new Map<string, ContactRow>();
    if (neededIds.length > 0) {
      // Supabase .in() has a practical limit; batch in chunks of 200.
      for (let i = 0; i < neededIds.length; i += 200) {
        const chunk = neededIds.slice(i, i + 200);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase.from('wk_contacts' as any) as any)
          .select('id, name, phone')
          .in('id', chunk);
        for (const c of (data ?? []) as ContactRow[]) {
          contactById.set(c.id, c);
        }
      }
    }

    // Per-contact channel counts (walk all 500 once).
    const counts = new Map<string, Record<ChannelKind, number>>();
    for (const m of msgs) {
      const cur = counts.get(m.contact_id) ?? { sms: 0, whatsapp: 0, email: 0 };
      const ch: ChannelKind = (m.channel ?? 'sms') as ChannelKind;
      cur[ch] = (cur[ch] ?? 0) + 1;
      counts.set(m.contact_id, cur);
    }

    // Walk newest → oldest, take the first message we see per contact.
    const seen = new Set<string>();
    const out: InboxThread[] = [];
    for (const m of msgs) {
      if (seen.has(m.contact_id)) continue;
      seen.add(m.contact_id);
      const c = contactById.get(m.contact_id);
      out.push({
        contactId: m.contact_id,
        contactName: c?.name || c?.phone || 'Unknown',
        contactPhone: c?.phone ?? '',
        lastMessageBody: m.body,
        lastMessageAt: m.created_at,
        lastDirection: m.direction,
        lastChannel: (m.channel ?? 'sms') as ChannelKind,
        channelCounts: counts.get(m.contact_id) ?? { sms: 0, whatsapp: 0, email: 0 },
        unreadCount: 0,
      });
    }
    setThreads(out);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void load();

    const channel = supabase
      .channel('wk_sms_messages-inbox')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'wk_sms_messages' },
        () => { void load(); },
      )
      .subscribe();

    // PR 89 (Hugo 2026-04-27): "WhatsApp messages don't appear without
    // refresh." Realtime IS subscribed above, but in practice some
    // inserts (especially those done via service-role from edge fns or
    // pg_cron) can silently fail to push to the client. Belt-and-braces:
    // also poll every 30s. Cheap (one query, sub-100ms) and bounds the
    // worst-case staleness.
    const pollId = window.setInterval(() => { void load(); }, 30_000);

    // Re-fetch on tab focus too — when Hugo flips back to the tab after
    // chatting on WhatsApp, the inbox should be fresh by the time the
    // page paints.
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);

    return () => {
      try { void supabase.removeChannel(channel); } catch { /* ignore */ }
      window.clearInterval(pollId);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  return { threads, loading, refetch: load };
}
