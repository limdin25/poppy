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
import { useViewAs } from '@/features/crm/lib/ViewAsContext';

export type ChannelKind = 'sms' | 'whatsapp' | 'email';

export interface InboxThread {
  contactId: string;
  contactName: string;
  contactPhone: string;
  /** Hugo's rule: wherever the business name shows, the owner + website show
   *  too. Named to match CallHistoryPro so there is one vocabulary. */
  contactOwner: string;
  contactWebsite: string;
  lastMessageBody: string;
  lastMessageAt: string;
  lastDirection: 'inbound' | 'outbound';
  /** PR 78: channel of the latest message. Used by inbox filter
   *  pills + thread-row icon. */
  lastChannel: ChannelKind;
  /** Per-channel count of messages on this thread (helps the agent
   *  see "this contact has 4 SMS + 1 WA + 2 email" at a glance). */
  channelCounts: Record<ChannelKind, number>;
  /** Newest message FROM the lead, null if they've never replied.
   *  Feeds the unread rule in lib/inboxOrder.ts. */
  lastInboundAt: string | null;
  /** Newest message we actually SENT. Unsent AI drafts are excluded — a
   *  draft is not a reply, and counting it as one would mark the lead's
   *  message read before a human ever saw it. */
  lastOutboundAt: string | null;
  /** Inbound messages newer than our last real reply. Shown as the unread
   *  count badge on the row. */
  inboundSinceReply: number;
}

interface MessageRow {
  id: string;
  contact_id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  created_at: string;
  channel: ChannelKind | null;
  status: string | null;
}

interface ContactRow {
  id: string;
  name: string;
  phone: string;
  custom_fields?: Record<string, string> | null;
}

export function useInboxThreads(): { threads: InboxThread[]; loading: boolean; refetch: () => void } {
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useAuth();
  // "See as: <agent>" — when an admin impersonates an agent, scope the inbox to
  // that agent's participation instead of the whole workspace.
  const { viewAsId } = useViewAs();

  const load = useCallback(async () => {
    // PR 119: resolve current user + admin status before querying so
    // we can scope the inbox per-user. RLS on wk_sms_messages is open
    // to any CRM role (PR 52); ownership filtering is the app's job.
    // Admin status comes from the CRM auth shim (admin_users allow-list).
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id ?? null;

    // Effective scope: a non-admin is always themselves; an admin sees the
    // whole workspace UNLESS they've picked "See as: <agent>", in which case
    // they see exactly that agent's leads.
    const scopeId: string | null = isAdmin ? viewAsId : uid;

    // Build the allowed-contact set for non-admins. An agent sees a
    // conversation for every lead they PARTICIPATED with (Hugo 2026-07-26):
    // owner OR active assignment OR texted (wk_sms_messages.created_by) OR
    // called (wk_calls.agent_id). The wk_contacts participation RLS policy
    // (migration 20260726000002) lets them READ those leads' names.
    let allowedSet: Set<string> | null = null;
    if (scopeId) {
      const [ownedRes, assignedRes, textedRes, calledRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_contacts' as any) as any).select('id').eq('owner_agent_id', scopeId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_lead_assignments' as any) as any)
          .select('contact_id').eq('agent_id', scopeId).in('status', ['assigned', 'in_progress']),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_sms_messages' as any) as any).select('contact_id').eq('created_by', scopeId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_calls' as any) as any).select('contact_id').eq('agent_id', scopeId),
      ]);
      const ids = new Set<string>();
      for (const r of (ownedRes.data ?? []) as Array<{ id: string }>) ids.add(r.id);
      for (const r of (assignedRes.data ?? []) as Array<{ contact_id: string }>) if (r.contact_id) ids.add(r.contact_id);
      for (const r of (textedRes.data ?? []) as Array<{ contact_id: string }>) if (r.contact_id) ids.add(r.contact_id);
      for (const r of (calledRes.data ?? []) as Array<{ contact_id: string | null }>) if (r.contact_id) ids.add(r.contact_id);
      allowedSet = ids;

      // Participated in nothing → empty inbox. Skip the round-trip.
      if (allowedSet.size === 0) {
        setThreads([]);
        setLoading(false);
        return;
      }
    }

    // Pull the last 1000 messages and group client-side, then filter to the
    // agent's set IN MEMORY. We deliberately do NOT pass the set to `.in()` —
    // an agent owning thousands of leads would blow the request URL length
    // (that silent failure was making busy agents' inboxes look empty). At
    // much larger message volumes this should move to a SECURITY DEFINER RPC.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgsRes = await (supabase.from('wk_sms_messages' as any) as any)
      .select('id, contact_id, direction, body, created_at, channel, status')
      .order('created_at', { ascending: false })
      .limit(1000);
    let msgs = (msgsRes.data ?? []) as MessageRow[];
    if (allowedSet) msgs = msgs.filter((m) => allowedSet!.has(m.contact_id));
    // An unsent AI draft is not a message. It used to become the row's preview
    // and its timestamp, so a thread where the lead said "Yeah sure" looked
    // like we had already answered. Discarded rows are hidden in the thread
    // view too, so they must not drive the list either.
    msgs = msgs.filter((m) => m.status !== 'draft' && m.status !== 'discarded');

    // Collect unique contact IDs from messages, then fetch just those.
    const neededIds = Array.from(new Set(msgs.map((m) => m.contact_id)));
    const contactById = new Map<string, ContactRow>();
    if (neededIds.length > 0) {
      // Supabase .in() has a practical limit; batch in chunks of 200.
      for (let i = 0; i < neededIds.length; i += 200) {
        const chunk = neededIds.slice(i, i + 200);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase.from('wk_contacts' as any) as any)
          .select('id, name, phone, custom_fields')
          .in('id', chunk);
        for (const c of (data ?? []) as ContactRow[]) {
          contactById.set(c.id, c);
        }
      }
    }

    // Per-contact channel counts (walk all 500 once).
    const counts = new Map<string, Record<ChannelKind, number>>();
    // Newest inbound / newest outbound per contact — the two timestamps the
    // unread rule compares. msgs is newest-first, so the FIRST one we meet in
    // each direction is the newest.
    const lastIn = new Map<string, string>();
    const lastOut = new Map<string, string>();
    for (const m of msgs) {
      const cur = counts.get(m.contact_id) ?? { sms: 0, whatsapp: 0, email: 0 };
      const ch: ChannelKind = (m.channel ?? 'sms') as ChannelKind;
      cur[ch] = (cur[ch] ?? 0) + 1;
      counts.set(m.contact_id, cur);
      const bucket = m.direction === 'inbound' ? lastIn : lastOut;
      if (!bucket.has(m.contact_id)) bucket.set(m.contact_id, m.created_at);
    }

    // How many of the lead's messages are still unanswered.
    const sinceReply = new Map<string, number>();
    for (const m of msgs) {
      if (m.direction !== 'inbound') continue;
      const ourLast = lastOut.get(m.contact_id);
      if (ourLast && +new Date(ourLast) >= +new Date(m.created_at)) continue;
      sinceReply.set(m.contact_id, (sinceReply.get(m.contact_id) ?? 0) + 1);
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
        contactOwner: c?.custom_fields?.owner_name ?? '',
        contactWebsite: c?.custom_fields?.website ?? '',
        lastMessageBody: m.body,
        lastMessageAt: m.created_at,
        lastDirection: m.direction,
        lastChannel: (m.channel ?? 'sms') as ChannelKind,
        channelCounts: counts.get(m.contact_id) ?? { sms: 0, whatsapp: 0, email: 0 },
        lastInboundAt: lastIn.get(m.contact_id) ?? null,
        lastOutboundAt: lastOut.get(m.contact_id) ?? null,
        inboundSinceReply: sinceReply.get(m.contact_id) ?? 0,
      });
    }
    setThreads(out);
    setLoading(false);
  }, [isAdmin, viewAsId]);

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
      // UPDATE matters now that unsent drafts are excluded: approving a draft
      // flips status draft -> sent, which is the moment it becomes the thread's
      // newest message. An INSERT-only subscription would leave the row showing
      // the lead's question until the 30s poll.
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'wk_sms_messages' },
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
