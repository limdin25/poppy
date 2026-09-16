// useInboxThreads — list of conversations for the /crm inbox.
// PR 50 (Hugo 2026-04-27).
//
// Returns one row per contact who has at least one wk_sms_messages
// entry, summarising the latest message + direction + timestamp.
// Sorted by latest activity descending. Realtime-subscribed:
// any INSERT into wk_sms_messages re-runs the load.
//
// PR 119 (Hugo 2026-04-28): per-agent inbox isolation.
// 2026-09-02: that filter is wk_inbox_thread_previews, one latest row
// per contact the caller is allowed to see. The old last-1000 workspace
// slice dropped builder quotes as soon as they aged out of the window.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { useViewAs } from '@/features/crm/lib/ViewAsContext';
import { attachmentSearchToken, inboxListPreview } from '@/features/crm/lib/inboxPreview';

export type ChannelKind = 'sms' | 'whatsapp' | 'email';

export interface InboxThread {
  contactId: string;
  contactName: string;
  contactPhone: string;
  /** Hugo's rule: wherever the business name shows, the owner + website show
   *  too. Named to match CallHistoryPro so there is one vocabulary. */
  contactOwner: string;
  contactWebsite: string;
  /** custom_fields.product, the stamp that says which product's funnel this
   *  lead came from ('heypubli' for a creator). The inbox needs it to know
   *  that owner + website mean nothing for this person. */
  contactProduct: string;
  lastMessageBody: string;
  /** Subject of the latest message, so search can hit "Quote" / the house. */
  lastSubject: string;
  /** File names on the latest message, so search can hit Conway / 1050. */
  lastAttachmentName: string;
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
  /** Which campaign this lead belongs to, via wk_sms_reply_campaign_batch
   *  (the same wk_dialer_queue link the AI reply resolver uses). Null when
   *  the contact was never queued to a campaign — most hand-added contacts. */
  campaignId: string | null;
  campaignName: string | null;
  /** Our mailboxes this thread has used (inbound To / outbound From). */
  mailboxes: string[];
}

interface PreviewRow {
  contact_id: string;
  last_body: string | null;
  last_at: string;
  last_direction: 'inbound' | 'outbound';
  last_channel: ChannelKind | null;
  last_media_urls: string[] | null;
  last_subject: string | null;
  last_attachment_url: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  inbound_since_reply: number;
  sms_count: number;
  whatsapp_count: number;
  email_count: number;
  /** Our mailboxes this thread used, worked out in the RPC. The mailbox filter
   *  (10 Sep) counted them client-side off the last-1000 slice; the list no
   *  longer reads that slice, so the RPC has to say. */
  mailboxes: string[] | null;
}

interface ContactRow {
  id: string;
  name: string;
  phone: string;
  custom_fields?: Record<string, string> | null;
}

/** The "HeyPubli" CRM agent (hello@heypubli.com). Retired-funnel threads are
 *  only visible under "See as" this agent; see the filter in load(). */
const HEYPUBLI_AGENT_ID = '79c01385-a4d7-463d-b0b4-1d348c68a737';

export function useInboxThreads(): { threads: InboxThread[]; loading: boolean; refetch: () => void } {
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useAuth();
  // "See as: <agent>" — when an admin impersonates an agent, scope the inbox to
  // that agent's participation instead of the whole workspace.
  const { viewAsId } = useViewAs();
  // Stale-load guard (2026-08-02). Loads overlap freely here: realtime events,
  // the 30s poll, focus, and the isAdmin flip all call load(), and a SLOW
  // pre-admin load (scoped to the user's own 2 leads) can resolve AFTER the
  // fresh admin load (the whole workspace), flapping the list 74 -> 2 -> 74 on
  // screen and detaching rows mid-click. Only the newest load may write state.
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    // PR 119: resolve current user + admin status before querying so
    // we can scope the inbox per-user. RLS on wk_sms_messages is open
    // to any CRM role (PR 52); ownership filtering is the app's job.
    // Admin status comes from the CRM auth shim (admin_users allow-list).
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id ?? null;

    // Effective scope: a non-admin is always themselves; an admin sees the
    // whole workspace UNLESS they've picked "See as: <agent>", in which case
    // they see exactly that agent's leads. The RPC owns participation
    // (owner / assignment / created_by / called / their line). Do not rebuild
    // that set here and then slice the last 1000 workspace rows: that is how
    // a builder quote dropped off the sidebar.
    const scopeId: string | null = isAdmin ? viewAsId : uid;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: previewData, error: previewErr } = await (supabase.rpc as any)(
      'wk_inbox_thread_previews',
      { p_agent_id: scopeId },
    );
    if (previewErr) {
      console.error('[useInboxThreads] wk_inbox_thread_previews', previewErr.message);
      if (seq !== loadSeqRef.current) return;
      setThreads([]);
      setLoading(false);
      return;
    }
    const previews = (previewData ?? []) as PreviewRow[];

    // Collect unique contact IDs from messages, then fetch just those.
    const neededIds = Array.from(new Set(previews.map((m) => m.contact_id)));
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

    // Which campaign each thread belongs to, so the sidebar can show a label
    // and be filtered by it. wk_sms_reply_campaign_batch (migration
    // 20260729000002) mirrors the SAME wk_dialer_queue link the AI reply
    // resolver uses (api/crm/ai-reply.ts), so the tag on a thread always
    // matches which prompt actually answers it — display and behaviour read
    // from the one place, not two rules that can drift apart.
    const campaignByContact = new Map<string, { id: string; name: string }>();
    if (neededIds.length > 0) {
      for (let i = 0; i < neededIds.length; i += 200) {
        const chunk = neededIds.slice(i, i + 200);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase.rpc as any)('wk_sms_reply_campaign_batch', { p_contacts: chunk });
        for (const row of (data ?? []) as Array<{ contact_id: string; campaign_id: string; campaign_name: string }>) {
          campaignByContact.set(row.contact_id, { id: row.campaign_id, name: row.campaign_name });
        }
      }
    }

    const out: InboxThread[] = [];
    for (const m of previews) {
      const c = contactById.get(m.contact_id);
      // 2026-08-19: the Instagram funnel is retired and its number became the
      // builders and estate agents line, so creator threads are HIDDEN from
      // the working inbox rather than deleted. History stays reachable the
      // one place Hugo ever worked it: "See as: HeyPubli".
      if (
        (c?.custom_fields?.product ?? '') === 'heypubli'
        && viewAsId !== HEYPUBLI_AGENT_ID
      ) continue;
      const campaign = campaignByContact.get(m.contact_id);
      const media = Array.isArray(m.last_media_urls)
        ? m.last_media_urls.filter((u): u is string => typeof u === 'string')
        : [];
      out.push({
        contactId: m.contact_id,
        contactName: c?.name || c?.phone || 'Unknown',
        contactPhone: c?.phone ?? '',
        contactOwner: c?.custom_fields?.owner_name ?? '',
        contactWebsite: c?.custom_fields?.website ?? '',
        contactProduct: c?.custom_fields?.product ?? '',
        lastMessageBody: inboxListPreview({
          body: m.last_body,
          mediaUrls: media,
          subject: m.last_subject,
          attachmentUrl: m.last_attachment_url,
        }),
        lastSubject: (m.last_subject ?? '').trim(),
        lastAttachmentName: attachmentSearchToken(media, m.last_attachment_url),
        lastMessageAt: m.last_at,
        lastDirection: m.last_direction,
        lastChannel: (m.last_channel ?? 'sms') as ChannelKind,
        channelCounts: {
          sms: Number(m.sms_count) || 0,
          whatsapp: Number(m.whatsapp_count) || 0,
          email: Number(m.email_count) || 0,
        },
        lastInboundAt: m.last_inbound_at ?? null,
        lastOutboundAt: m.last_outbound_at ?? null,
        inboundSinceReply: Number(m.inbound_since_reply) || 0,
        campaignId: campaign?.id ?? null,
        campaignName: campaign?.name ?? null,
        mailboxes: Array.isArray(m.mailboxes) ? m.mailboxes : [],
      });
    }
    if (seq !== loadSeqRef.current) return; // superseded by a newer load
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
