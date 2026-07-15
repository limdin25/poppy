import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Voicemail,
  Search,
  Phone,
  Play,
  Pencil,
  Send,
  Mail,
  Paperclip,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { MOCK_SMS, MOCK_ACTIVITIES } from '../data/mockCalls';
import { useDemoMode } from '../lib/useDemoMode';
import { formatRelativeTime, formatTimeOnly, formatDuration } from '../data/helpers';
import StageSelector from '../components/shared/StageSelector';
import EditContactModal from '../components/contacts/EditContactModal';
import EditableName from '../components/contacts/EditableName';
import FollowupPromptModal from '../components/followups/FollowupPromptModal';
import { useSmsV2 } from '../store/SmsV2Store';
import { useContactTimeline } from '../hooks/useContactTimeline';
import { useContactMessages } from '../hooks/useContactMessages';
import { useInboxThreads } from '../hooks/useInboxThreads';
import { useContactPersistence } from '../hooks/useContactPersistence';
import { signCallRecording } from '../hooks/useCalls';
import CallTranscriptModal from '../components/calls/CallTranscriptModal';
import { useSmsTemplates } from '../hooks/useSmsTemplates';
import { useCurrentAgent } from '../hooks/useCurrentAgent';
import { interpolateTemplate } from '../lib/interpolateTemplate';
import { supabase } from '@/integrations/supabase/browser';
import { useDialerProModal } from '../layout/DialerProModalContext';
import type { Contact, CallRecord, ActivityEvent } from '../types';

const ACTIVITY_KINDS_FOR_THREAD = new Set(['note', 'outcome_applied', 'stage_moved', 'tag_added', 'task_created']);

interface SmsSendInvoke {
  invoke: (
    name: string,
    options: { body: Record<string, unknown> }
  ) => Promise<{
    // wk-sms-send returns { message_id, twilio_sid, status } on success
    // or { error } on failure. Older sms-send shape kept for compatibility.
    data: {
      message_id?: string;
      twilio_sid?: string;
      sid?: string;
      status?: string;
      error?: string;
    } | null;
    error: { message: string } | null;
  }>;
}

type Filter = 'all' | 'sms' | 'whatsapp' | 'email' | 'calls' | 'voicemail' | 'missed';

type ChannelKindUI = 'sms' | 'whatsapp' | 'email';

/** Tiny channel-icon glyph for inbox rows + message bubbles. PR 78. */
function ChannelGlyph({
  channel,
  size = 12,
  className,
}: {
  channel: ChannelKindUI;
  size?: number;
  className?: string;
}) {
  const cls = cn('flex-shrink-0', className);
  // Lucide icons take size via prop, but cn-cls already injects color.
  if (channel === 'whatsapp') return <MessageSquare style={{ width: size, height: size }} className={cn(cls, 'text-[#25D366]')} aria-label="WhatsApp" />;
  if (channel === 'email') return <Mail style={{ width: size, height: size }} className={cn(cls, 'text-[#3B82F6]')} aria-label="Email" />;
  return <Phone style={{ width: size, height: size }} className={cn(cls, 'text-[#3C5A87]')} aria-label="SMS" />;
}

export default function InboxPage() {
  const { contacts, columns: storeColumns, patchContact, upsertContact, pushToast } = useSmsV2();
  const persist = useContactPersistence();
  const demoMode = useDemoMode();
  const [filter, setFilter] = useState<Filter>('all');
  const [activeContactId, setActiveContactId] = useState<string>('');
  const [editing, setEditing] = useState<Contact | null>(null);
  // PR 107 (Hugo 2026-04-28): every successful send opens the follow-up
  // prompt so the agent always commits to a next-touch time. Skip is
  // still allowed via the modal's close handler — non-blocking nudge.
  const [followupTarget, setFollowupTarget] = useState<{
    contactId: string;
    contactName: string;
    columnId: string;
  } | null>(null);
  const [reply, setReply] = useState('');
  const [replySubject, setReplySubject] = useState('');
  // PR 80 safety: channel starts UNSELECTED. Send is disabled and a
  // tooltip prompts "Pick SMS / WhatsApp / Email first" until the
  // agent consciously chooses. We auto-default to whatever channel the
  // contact's last message used, so the agent isn't pestered when the
  // intent is obvious.
  const [replyChannel, setReplyChannel] = useState<ChannelKindUI | null>(null);
  const [sending, setSending] = useState(false);
  const [replyAttachmentUrl, setReplyAttachmentUrl] = useState<string | null>(null);
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [signedUrls] = useState(() => new Map<string, string>());
  const [transcriptCallId, setTranscriptCallId] = useState<string | null>(null);
  const navigateTo = useNavigate();
  const { openDialerPro } = useDialerProModal();
  const threadScrollRef = useRef<HTMLDivElement>(null);

  // PR 88 (Hugo 2026-04-27): templates dropdown in the inbox composer.
  // Filter by selected channel; universal templates show in every channel.
  const { items: templates } = useSmsTemplates();
  const { firstName: agentFirstName } = useCurrentAgent();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // PR 89 (Hugo 2026-04-27): inbox search bar \u2014 was rendered with no
  // onChange + no state, so typing did nothing. Now filters sidebarRows
  // by name / phone / last message body (case-insensitive).
  const [searchQuery, setSearchQuery] = useState('');

  const renameContact = async (id: string, name: string) => {
    patchContact(id, { name });
    const res = await persist.patchContact(id, { name });
    if (res !== true) pushToast(`Rename failed: ${res}`, 'error');
    return res;
  };

  const signAndPlay = async (callId: string, storagePath: string | undefined) => {
    if (!storagePath) { pushToast('No recording available', 'error'); return; }
    if (playingCallId === callId) { setPlayingCallId(null); return; }
    const cached = signedUrls.get(callId);
    if (cached) { setPlayingCallId(callId); return; }
    const url = storagePath.startsWith('http') ? storagePath : await signCallRecording(storagePath);
    if (!url) { pushToast('Recording not available', 'error'); return; }
    signedUrls.set(callId, url);
    setPlayingCallId(callId);
  };

  const openEditModal = async (fallback: Contact) => {
    // Fetch the full contact from DB so the edit modal always has
    // current data — the store may not have hydrated this contact yet
    // (17k+ contacts exceed the store's load limit).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_contacts' as any) as any)
      .select('id, name, phone, email, owner_agent_id, pipeline_column_id, deal_value_pence, is_hot, custom_fields, last_contact_at, created_at')
      .eq('id', fallback.id)
      .maybeSingle();
    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tagRows } = await (supabase.from('wk_contact_tags' as any) as any)
        .select('tag')
        .eq('contact_id', data.id);
      const tags = ((tagRows ?? []) as Array<{ tag: string }>).map((r) => r.tag);
      const full: Contact = {
        id: data.id,
        name: data.name,
        phone: data.phone,
        email: data.email ?? undefined,
        ownerAgentId: data.owner_agent_id ?? undefined,
        pipelineColumnId: data.pipeline_column_id ?? undefined,
        tags,
        isHot: data.is_hot,
        dealValuePence: data.deal_value_pence ?? undefined,
        customFields: (data.custom_fields ?? {}) as Record<string, string>,
        createdAt: data.created_at,
        lastContactAt: data.last_contact_at ?? undefined,
      };
      upsertContact(full);
      setEditing(full);
    } else {
      setEditing(fallback);
    }
  };

  // PR 52 (war room, Hugo 2026-04-27): the sidebar is now driven by
  // useInboxThreads (latest message per contact, ordered desc) merged
  // with any contact in the local store that doesn't have messages
  // yet. Old behaviour iterated `contacts` which excluded inbound
  // contacts whose wk_contacts row hadn't propagated yet AND ordered
  // by hydration order, not message recency.
  const { threads: inboxThreads } = useInboxThreads();

  // PR 119 (Hugo 2026-04-28): inbox now ONLY shows contacts with at
  // least one message. Bulk-imported contacts no longer pollute the
  // sidebar — they live on /crm/contacts. The previous "empty
  // contacts" fallback was a leftover from PR 52's "start new
  // conversation from the sidebar" idea, which never carried weight
  // once import volume grew. New conversations now begin from
  // /crm/contacts → Call/Send.
  const sidebarRows = useMemo(() => {
    const contactById = new Map(contacts.map((c) => [c.id, c] as const));
    type Row = {
      id: string;
      name: string;
      phone: string;
      email?: string;
      pipelineColumnId: string | undefined;
      lastMessageBody: string | null;
      lastMessageAt: string | null;
      lastDirection: 'inbound' | 'outbound' | null;
      lastChannel: ChannelKindUI | null;
      channelCounts: Record<ChannelKindUI, number>;
      isHot: boolean;
      tags: string[];
    };
    const out: Row[] = [];

    // Threads only (already ordered newest first by useInboxThreads).
    for (const t of inboxThreads) {
      const c = contactById.get(t.contactId);
      out.push({
        id: t.contactId,
        name: c?.name || t.contactName || t.contactPhone || 'Unknown',
        phone: c?.phone ?? t.contactPhone,
        email: c?.email,
        pipelineColumnId: c?.pipelineColumnId,
        lastMessageBody: t.lastMessageBody,
        lastMessageAt: t.lastMessageAt,
        lastDirection: t.lastDirection,
        lastChannel: t.lastChannel,
        channelCounts: t.channelCounts,
        isHot: !!c?.isHot,
        tags: c?.tags ?? [],
      });
    }

    // PR 78: filter by selected channel pill. 'all' / 'calls' / 'voicemail'
    // / 'missed' don't filter messages (calls etc. aren't message rows
    // here — those are timeline events). 'sms' / 'whatsapp' / 'email'
    // restrict to threads whose latest message was on that channel.
    let rows = out;
    if (filter === 'sms' || filter === 'whatsapp' || filter === 'email') {
      rows = rows.filter((r) => r.lastChannel === filter || r.channelCounts[filter] > 0);
    }
    // PR 89: free-text search across name, phone, last message body.
    const q = searchQuery.trim().toLowerCase();
    if (q.length > 0) {
      rows = rows.filter((r) => {
        const hay = `${r.name} ${r.phone} ${r.lastMessageBody ?? ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }, [inboxThreads, contacts, filter, searchQuery]);

  // Auto-select the newest thread on first load (Hugo's spec: newest
  // conversation must be visible without scrolling).
  // PR 107: also honour ?contact=<uuid> deep links from FollowupBanner.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const deepLinked = searchParams.get('contact');
    if (deepLinked) {
      setActiveContactId(deepLinked);
      // Strip the param so a refresh/back doesn't re-pin the selection.
      const next = new URLSearchParams(searchParams);
      next.delete('contact');
      setSearchParams(next, { replace: true });
      return;
    }
    if (!activeContactId && sidebarRows.length > 0) {
      setActiveContactId(sidebarRows[0].id);
    }
    // If the currently-selected contact disappeared from the list
    // entirely, fall back to the newest.
    if (activeContactId && !sidebarRows.some((r) => r.id === activeContactId) && sidebarRows.length > 0) {
      setActiveContactId(sidebarRows[0].id);
    }
  }, [sidebarRows, activeContactId, searchParams, setSearchParams]);

  // Resolve activeContact from the store first (full Contact shape
  // for stage selector / edit modal) — fall back to a synthesized
  // shim from the sidebar row when the store hasn't hydrated yet.
  const activeRow = sidebarRows.find((r) => r.id === activeContactId);
  const activeContact: Contact | undefined =
    contacts.find((c) => c.id === activeContactId) ??
    (activeRow ? {
      id: activeRow.id,
      name: activeRow.name,
      phone: activeRow.phone,
      email: activeRow.email,
      tags: activeRow.tags,
      isHot: activeRow.isHot,
      customFields: {},
      createdAt: new Date().toISOString(),
      pipelineColumnId: activeRow.pipelineColumnId,
    } : undefined);
  const timeline = useContactTimeline(activeContact?.id ?? '', activeContact?.phone);
  // PR 50 (Hugo 2026-04-27): SMS source is wk_sms_messages now.
  // useContactTimeline still loads the legacy sms_messages rows for
  // backward compatibility (so any historical conversations from the
  // old /sms inbox remain visible), but the canonical CRM source
  // going forward is the realtime-subscribed useContactMessages.
  const { messages: crmMessages } = useContactMessages(activeContact?.id ?? '');

  // Convert wk_sms_messages → SmsMessage shape so the existing
  // thread renderer doesn't have to change. PR 78: pass channel +
  // subject through so the thread bubbles can show the channel icon
  // and email subject prefix.
  const crmSms = useMemo(() => crmMessages.map((m) => ({
    id: m.id,
    contactId: m.contactId,
    direction: m.direction,
    body: m.body,
    sentAt: m.createdAt,
    channel: m.channel,
    subject: m.subject,
    attachmentUrl: m.attachmentUrl,
  })), [crmMessages]);

  // PR 105 (Hugo 2026-04-28): channel must be re-picked every time —
  // no auto-default to last-used channel, no carry-over between contacts.
  // Forces the agent to consciously confirm SMS / WhatsApp / Email so
  // we never accidentally send on the wrong channel.
  useEffect(() => {
    setReplyChannel(null);
  }, [activeContactId]);

  // Real data only in production. Mock fallback restricted to ?demo=1.
  // CRM messages are the primary source; legacy timeline SMS shown
  // only when CRM messages are empty so historical /sms threads
  // don't disappear.
  const contactSms = crmSms.length > 0
    ? crmSms
    : timeline.sms.length > 0
      ? timeline.sms
      : demoMode
        ? MOCK_SMS.filter((m) => m.contactId === activeContact?.id)
        : [];
  const contactActivity = timeline.activities.length > 0
    ? timeline.activities
    : demoMode
      ? MOCK_ACTIVITIES.filter((a) => a.contactId === activeContact?.id)
      : [];

  // Auto-scroll the thread to the bottom (newest message visible)
  // whenever new content arrives or the agent switches contacts.
  // PR 52 war-room: Hugo's spec — "The newest message is visible
  // without scrolling."
  // We deliberately scroll instantly (not smooth) on contact switch
  // and smoothly when a new message lands while the same contact is
  // open. Using setTimeout(0) so the DOM has flushed before we
  // measure scrollHeight.
  // (Hook depends on contactSms below, so declared after that block.)

  // Sort the unified thread by timestamp so SMS interleave with calls if present
  const threadItems = useMemo(() => {
    const items: { kind: 'sms' | 'call' | 'activity'; ts: string; payload: unknown }[] = contactSms.map((m) => ({
      kind: 'sms' as const,
      ts: m.sentAt,
      payload: m,
    }));
    for (const c of timeline.calls) {
      items.push({ kind: 'call' as const, ts: c.startedAt, payload: c });
    }
    for (const a of contactActivity) {
      if (ACTIVITY_KINDS_FOR_THREAD.has(a.kind)) {
        items.push({ kind: 'activity' as const, ts: a.ts, payload: a });
      }
    }
    items.sort((a, b) => +new Date(a.ts) - +new Date(b.ts));
    return items;
  }, [contactSms, timeline.calls, contactActivity]);

  // Auto-scroll on thread change OR new message append.
  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    // Use rAF + setTimeout to wait for layout flush before measuring.
    const id = setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 0);
    return () => clearTimeout(id);
  }, [activeContactId, threadItems.length]);

  const setStage = (col: string) => {
    if (!activeContact) return;
    patchContact(activeContact.id, { pipelineColumnId: col });
    void persist.moveToColumn(activeContact.id, col);
  };

  // PR 88: filter templates by reply channel (universal templates always show).
  const visibleTemplates = useMemo(
    () =>
      templates.filter(
        (t) => t.channel == null || t.channel === replyChannel
      ),
    [templates, replyChannel]
  );

  const contactFirstName = useMemo(() => {
    if (!activeContact) return '';
    return (activeContact.name ?? '').trim().split(/\s+/)[0] ?? '';
  }, [activeContact]);

  const applyTemplate = (id: string) => {
    setSelectedTemplateId(id);
    if (!id) return;
    const tpl = visibleTemplates.find((t) => t.id === id);
    if (!tpl) return;
    const expandedBody = interpolateTemplate(tpl.body_md, {
      firstName: contactFirstName,
      agentFirstName,
    });
    setReply(expandedBody);
    if (replyChannel === 'email' && tpl.subject) {
      const expandedSubject = interpolateTemplate(tpl.subject, {
        firstName: contactFirstName,
        agentFirstName,
      });
      setReplySubject(expandedSubject);
    }
    setReplyAttachmentUrl(tpl.attachment_url ?? null);
  };

  // Reset template selection when channel changes (different template list).
  useEffect(() => {
    setSelectedTemplateId('');
  }, [replyChannel, activeContactId]);

  const send = async () => {
    if (!reply.trim() || !activeContact || sending) return;
    if (!replyChannel) {
      pushToast('Pick a channel first — SMS, WhatsApp or Email.', 'error');
      return;
    }
    if (replyChannel === 'email' && !replySubject.trim()) {
      pushToast('Email subject required', 'error');
      return;
    }
    setSending(true);
    try {
      // PR 79 (Hugo 2026-04-27): inbox reply routes by selected channel.
      // sms      → wk-sms-send  (Twilio)
      // whatsapp → unipile-send (Unipile)
      // email    → wk-email-send (Resend)
      const fn = supabase.functions as unknown as SmsSendInvoke;
      const trimmedBody = reply.trim();
      let resp: Awaited<ReturnType<SmsSendInvoke['invoke']>>;
      const attach = replyAttachmentUrl || undefined;
      if (replyChannel === 'whatsapp') {
        resp = await fn.invoke('unipile-send', {
          body: { contact_id: activeContact.id, body: trimmedBody, attachment_url: attach },
        });
      } else if (replyChannel === 'email') {
        resp = await fn.invoke('wk-email-send', {
          body: {
            contact_id: activeContact.id,
            subject: replySubject.trim(),
            body: trimmedBody,
            attachment_url: attach,
          },
        });
      } else {
        resp = await fn.invoke('wk-sms-send', {
          body: { contact_id: activeContact.id, body: trimmedBody, attachment_url: attach },
        });
      }
      const { data, error } = resp;
      const channelLabel =
        replyChannel === 'whatsapp' ? 'WhatsApp' :
        replyChannel === 'email' ? 'Email' :
        'SMS';
      if (error || data?.error) {
        pushToast(
          `${channelLabel} send failed: ${error?.message ?? data?.error ?? 'unknown'}`,
          'error'
        );
      } else {
        pushToast(`${channelLabel} sent`, 'success');
        setReply('');
        if (replyChannel === 'email') setReplySubject('');
        setReplyAttachmentUrl(null);
        // PR 105: force re-pick of channel after every successful send.
        setReplyChannel(null);
        // PR 107: prompt the agent for a follow-up time. Skipped silently
        // when the contact has no pipeline column yet (nothing to anchor).
        if (activeContact.pipelineColumnId) {
          setFollowupTarget({
            contactId: activeContact.id,
            contactName: activeContact.name,
            columnId: activeContact.pipelineColumnId,
          });
        }
      }
    } catch (e) {
      pushToast(`Send crashed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
    } finally {
      setSending(false);
    }
  };

  if (!activeContact) {
    return (
      <div className="p-12 text-center text-[14px] text-[#9CA3AF] italic">
        No contacts yet. Import a CSV or add one in Contacts.
      </div>
    );
  }

  return (
    <>
    <div className="h-full flex">
      {/* Pane 1 — list */}
      <aside className="w-[280px] bg-white border-r border-[#E5E7EB] flex flex-col">
        <div className="px-3 py-2.5 border-b border-[#E5E7EB] space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search inbox…"
              data-testid="inbox-search"
              className="w-full pl-7 pr-2 py-1.5 text-[12px] bg-[#F3F3EE] border-0 rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30"
            />
          </div>
          {/* PR 78: channel filter pills — agent can scope the inbox to
              SMS / WhatsApp / Email at a glance. Industry-standard
              pattern (HubSpot Conversations, Front, Intercom). */}
          <div className="flex gap-1 flex-wrap">
            {(['all', 'sms', 'whatsapp', 'email', 'calls', 'voicemail', 'missed'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                data-testid={`inbox-filter-${f}`}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors uppercase tracking-wide',
                  filter === f
                    ? 'bg-[#3C5A87] text-white'
                    : 'bg-[#F3F3EE] text-[#6B7280] hover:bg-black/[0.05]'
                )}
              >
                {(f === 'sms' || f === 'whatsapp' || f === 'email') && (
                  <ChannelGlyph
                    channel={f}
                    size={9}
                    className={filter === f ? 'text-white' : ''}
                  />
                )}
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[#E5E7EB]">
          {/* PR 52 war-room: sidebarRows is the union of (a) thread
              rows ordered newest-first by latest wk_sms_messages,
              and (b) contacts with no messages yet. Newest message
              ALWAYS sits at the top — Hugo's spec. */}
          {sidebarRows.map((r) => {
            const initials = (r.name || r.phone)
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2);
            return (
              <button
                key={r.id}
                data-testid={`inbox-row-${r.id}`}
                onClick={() => setActiveContactId(r.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 hover:bg-[#F3F3EE]/50',
                  activeContactId === r.id && 'bg-[#EEF2F8]'
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[#3C5A87]/15 text-[#3C5A87] text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[#1A1A1A] truncate flex items-center gap-1">
                      <EditableName value={r.name} onSave={(n) => renameContact(r.id, n)} className="text-[13px] font-semibold" />
                    </div>
                    <div className="text-[11px] text-[#6B7280] truncate flex items-center gap-1">
                      {r.lastChannel && <ChannelGlyph channel={r.lastChannel} size={10} />}
                      <span className="truncate">
                        {r.lastMessageBody
                          ? `${r.lastDirection === 'outbound' ? '↗' : '💬'} ${r.lastMessageBody.slice(0, 36)}`
                          : '—'}
                      </span>
                    </div>
                  </div>
                  {r.lastMessageAt && (
                    <div className="text-[10px] text-[#9CA3AF] tabular-nums">
                      {formatRelativeTime(r.lastMessageAt)}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Pane 2 — thread */}
      <section className="flex-1 bg-[#F3F3EE]/30 flex flex-col min-w-0">
        <div className="px-5 py-3 bg-white border-b border-[#E5E7EB] flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#3C5A87]/15 text-[#3C5A87] text-[13px] font-bold flex items-center justify-center">
            {activeContact.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)}
          </div>
          <div className="flex-1">
            <div className="text-[14px] font-semibold text-[#1A1A1A]">
              <EditableName value={activeContact.name} onSave={(n) => renameContact(activeContact.id, n)} className="text-[14px] font-semibold" />
            </div>
            <div className="text-[11px] text-[#6B7280] tabular-nums">
              {activeContact.phone}
            </div>
          </div>
          {/* Stage selector — change stage from inbox */}
          <StageSelector
            value={activeContact.pipelineColumnId}
            onChange={setStage}
            size="md"
          />
          <button
            onClick={() => void openEditModal(activeContact)}
            className="flex items-center gap-1.5 border border-[#E5E7EB] text-[#1A1A1A] text-[12px] font-medium px-3 py-1.5 rounded-[10px] hover:bg-[#F3F3EE]"
            title="Edit lead"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          {/* Two-button stack: tiny "Call room" link above, primary
              "Call" button below. Hugo 2026-04-26 (PR 10): the agent
              wants to be able to OPEN the call-room layout (script +
              coach + glossary + SMS sender) for a lead without
              dialling — just to look at context. The room itself has a
              "Call now" button if they decide to dial after all. */}
          <div className="flex flex-col items-end gap-0.5">
            <button
              onClick={() => navigateTo('/admin/crm/dialer-pro')}
              className="text-[10px] text-[#3C5A87] hover:text-[#3C5A87]/80 font-medium underline-offset-2 hover:underline"
              title="Open the call room without dialling"
            >
              Open call room
            </button>
            <button
              onClick={() => openDialerPro(activeContact.id)}
              className="flex items-center gap-1.5 bg-[#3C5A87] hover:bg-[#3C5A87]/90 text-white text-[12px] font-semibold px-3 py-1.5 rounded-[10px] shadow-[0_4px_12px_rgba(30,154,128,0.35)]"
            >
              <Phone className="w-3.5 h-3.5" /> Call
            </button>
          </div>
        </div>

        <div ref={threadScrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-2" data-testid="inbox-thread-scroll">
          {threadItems.map((item) => {
            if (item.kind === 'sms') {
              const m = item.payload as {
                id: string;
                direction: 'inbound' | 'outbound';
                body: string;
                sentAt: string;
                channel?: ChannelKindUI;
                subject?: string | null;
                attachmentUrl?: string | null;
              };
              const ch = (m.channel || 'sms') as ChannelKindUI;
              const subj = m.subject ?? null;
              return (
                <div
                  key={`sms-${m.id}`}
                  className={cn(
                    'rounded-2xl px-3 py-2 max-w-[60%] text-[13px] leading-snug',
                    m.direction === 'outbound'
                      ? 'bg-[#3C5A87]/15 text-[#1A1A1A] ml-auto'
                      : 'bg-white border border-[#E5E7EB] text-[#1A1A1A]'
                  )}
                >
                  {/* PR 78: channel + subject prefix on each bubble */}
                  <div className="flex items-center gap-1 text-[10px] text-[#6B7280] uppercase tracking-wide mb-1 font-bold">
                    <ChannelGlyph channel={ch} size={10} />
                    {ch === 'whatsapp' ? 'WhatsApp' : ch === 'email' ? 'Email' : 'SMS'}
                  </div>
                  {subj && (
                    <div className="text-[12px] font-semibold text-[#1A1A1A] mb-1">
                      {subj}
                    </div>
                  )}
                  {m.body}
                  {'attachmentUrl' in m && m.attachmentUrl && (
                    <a
                      href={m.attachmentUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 flex items-center gap-1 text-[11px] text-[#3C5A87] hover:underline"
                    >
                      <Paperclip className="w-3 h-3" />
                      {(m.attachmentUrl as string).split('/').pop() ?? 'Attachment'}
                    </a>
                  )}
                  <div className="text-[10px] text-[#9CA3AF] mt-0.5 tabular-nums">
                    {formatTimeOnly(m.sentAt)}
                  </div>
                </div>
              );
            }
            if (item.kind === 'call') {
              const c = item.payload as CallRecord;
              return (
                <div
                  key={`call-${c.id}`}
                  className="rounded-2xl px-3 py-2 max-w-[60%] mx-auto bg-white border border-[#E5E7EB] text-[#1A1A1A] text-[12px]"
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    {c.direction === 'outbound' ? (
                      <PhoneOutgoing className="w-3 h-3 text-[#3B82F6]" />
                    ) : (
                      <PhoneIncoming className="w-3 h-3 text-[#3C5A87]" />
                    )}
                    {c.direction} call · {c.status}
                    {c.durationSec > 0 && ` · ${formatDuration(c.durationSec)}`}
                  </div>
                  {c.aiSummary && (
                    <div className="text-[11px] text-[#6B7280] italic mt-1">
                      &ldquo;{c.aiSummary}&rdquo;
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    {c.recordingUrl && (
                      <button
                        onClick={() => void signAndPlay(c.id, c.recordingUrl)}
                        className="text-[10px] flex items-center gap-1 text-[#3C5A87] hover:underline"
                      >
                        <Play className="w-3 h-3" />
                        {playingCallId === c.id ? 'Hide recording' : 'Play recording'}
                      </button>
                    )}
                    <button
                      onClick={() => setTranscriptCallId(c.id)}
                      className="text-[10px] flex items-center gap-1 text-[#3C5A87] hover:underline"
                    >
                      <MessageSquare className="w-3 h-3" /> Transcript
                    </button>
                  </div>
                  {playingCallId === c.id && signedUrls.get(c.id) && (
                    <audio src={signedUrls.get(c.id)} controls autoPlay className="w-full mt-1.5 h-8" />
                  )}
                  <div className="text-[10px] text-[#9CA3AF] mt-1 tabular-nums">
                    {formatTimeOnly(c.startedAt)}
                  </div>
                </div>
              );
            }
            const a = item.payload as ActivityEvent;
            return (
              <div
                key={`act-${a.id}`}
                className="mx-auto max-w-[80%] px-3 py-1.5 rounded-xl bg-[#F3F3EE] border border-[#E5E7EB] text-[11px] text-[#6B7280] flex items-center gap-2"
              >
                <ActivityIcon kind={a.kind} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-[#1A1A1A]">{a.title}</span>
                  {a.body && <span className="ml-1 truncate">{a.body}</span>}
                </div>
                <span className="text-[10px] text-[#9CA3AF] tabular-nums flex-shrink-0">{formatTimeOnly(a.ts)}</span>
              </div>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="px-5 py-3 bg-white border-t border-[#E5E7EB] flex flex-col gap-2"
        >
          {/* PR 79: channel picker on the reply box. Reply routes through
              wk-sms-send / unipile-send / wk-email-send accordingly. */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                role="radiogroup"
                aria-label="Reply channel"
                className={cn(
                  'inline-flex p-0.5 bg-[#F3F3EE] rounded-[8px] gap-0.5 border',
                  replyChannel === null
                    ? 'border-[#F59E0B] ring-1 ring-[#F59E0B]/30'
                    : 'border-[#E5E5E5]'
                )}
              >
                {(['sms', 'whatsapp', 'email'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={replyChannel === c}
                    onClick={() => setReplyChannel(c)}
                    data-testid={`inbox-reply-channel-${c}`}
                    className={cn(
                      'inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-[6px] transition-colors',
                      replyChannel === c
                        ? 'bg-white text-[#3C5A87] shadow-sm'
                        : 'text-[#6B7280] hover:text-[#1A1A1A]'
                    )}
                  >
                    <ChannelGlyph
                      channel={c}
                      size={10}
                      className={replyChannel === c ? '' : 'opacity-70'}
                    />
                    {c === 'sms' ? 'SMS' : c === 'whatsapp' ? 'WhatsApp' : 'Email'}
                  </button>
                ))}
              </div>
              {replyChannel === null && (
                <span className="text-[10px] font-semibold text-[#B45309] uppercase tracking-wide">
                  Pick a channel ↑
                </span>
              )}
            </div>
            {/* PR 88: templates dropdown — filtered by selected channel.
                Picking a template fills body (and subject for email),
                substituting {first_name}/{agent_first_name}. */}
            {replyChannel !== null && visibleTemplates.length > 0 && (
              <select
                value={selectedTemplateId}
                onChange={(e) => applyTemplate(e.target.value)}
                disabled={sending}
                data-testid="inbox-reply-template"
                className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded-[8px] disabled:opacity-60 max-w-[200px]"
                title="Insert a template"
              >
                <option value="">Templates ({visibleTemplates.length})…</option>
                {visibleTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.channel ? ` · ${t.channel}` : ' · universal'}
                  </option>
                ))}
              </select>
            )}
            {replyChannel === 'email' && (
              <input
                value={replySubject}
                onChange={(e) => setReplySubject(e.target.value)}
                placeholder="Email subject"
                disabled={sending}
                data-testid="inbox-reply-subject"
                className="flex-1 max-w-[360px] px-3 py-1.5 text-[12px] bg-[#F3F3EE] border-0 rounded-[8px] focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30 disabled:opacity-60"
              />
            )}
          </div>
          {replyAttachmentUrl && (
            <div className="flex items-center gap-1 text-[11px] text-[#3C5A87] bg-[#EEF2F8] px-2 py-1 rounded-lg">
              <Paperclip className="w-3 h-3" />
              <span className="truncate max-w-[300px]">{replyAttachmentUrl.split('/').pop()}</span>
              <button onClick={() => setReplyAttachmentUrl(null)} className="ml-1 text-[#9CA3AF] hover:text-[#EF4444]">&times;</button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={
                replyChannel === null
                  ? 'Pick a channel above to start typing…'
                  : replyChannel === 'whatsapp'
                    ? 'Type a WhatsApp reply…'
                    : replyChannel === 'email'
                      ? 'Type the email body…'
                      : 'Type a reply…'
              }
              disabled={sending}
              data-testid="inbox-reply-body"
              className="flex-1 px-3 py-2 text-[13px] bg-[#F3F3EE] border-0 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={
                !reply.trim() ||
                sending ||
                !replyChannel ||
                (replyChannel === 'email' && !replySubject.trim())
              }
              data-testid="inbox-reply-send"
              title={!replyChannel ? 'Pick SMS, WhatsApp or Email first' : undefined}
              className="flex items-center gap-1.5 bg-[#3C5A87] text-white text-[13px] font-semibold px-4 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </section>

      {/* Pane 3 — timeline */}
      <aside className="w-[320px] bg-white border-l border-[#E5E7EB] flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#E5E7EB]">
          <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
            Contact timeline
          </div>
          <div className="text-[14px] font-semibold text-[#1A1A1A] mt-0.5">
            {activeContact.name}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {contactActivity.map((a) => (
            <div key={a.id} className="flex gap-2.5 text-[12px]">
              <ActivityIcon kind={a.kind} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#1A1A1A]">{a.title}</div>
                {a.body && (
                  <div className="text-[11px] text-[#6B7280] truncate">{a.body}</div>
                )}
                <div className="text-[10px] text-[#9CA3AF] mt-0.5">
                  {formatRelativeTime(a.ts)}
                </div>
                {a.kind === 'call_inbound' && (
                  <button className="mt-1 text-[10px] flex items-center gap-1 text-[#3C5A87] hover:underline">
                    <Play className="w-3 h-3" /> Play recording (4:21)
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
    {followupTarget && (() => {
      const col = storeColumns.find((c) => c.id === followupTarget.columnId);
      const lc = col?.name.toLowerCase();
      const suggestedHours =
        lc === 'callback' ? 2 : lc === 'interested' ? 24 : 24 * 3;
      return (
        <FollowupPromptModal
          open
          onOpenChange={(o) => { if (!o) setFollowupTarget(null); }}
          contactId={followupTarget.contactId}
          contactName={followupTarget.contactName}
          columnId={followupTarget.columnId}
          columnName={col?.name ?? 'Stage'}
          suggestedHoursAhead={suggestedHours}
          callId={null}
          onSaved={() => setFollowupTarget(null)}
        />
      );
    })()}
    <EditContactModal
      contact={editing}
      onClose={() => setEditing(null)}
      onSave={(updated) => {
        // PR 105: optimistic local + write-through to wk_contacts so
        // the saved name / email / stage survives a reload.
        const prev = contacts.find((c) => c.id === updated.id);
        upsertContact(updated);
        void persist
          .patchContact(updated.id, {
            name: updated.name,
            phone: updated.phone,
            email: updated.email ?? null,
            pipeline_column_id: updated.pipelineColumnId ?? null,
            owner_agent_id: updated.ownerAgentId ?? null,
            deal_value_pence: updated.dealValuePence ?? null,
            is_hot: updated.isHot,
            custom_fields: updated.customFields,
          })
          .then((result) => {
            if (result === true) {
              pushToast('Saved ✓', 'success');
            } else {
              if (prev) upsertContact(prev);
              pushToast(result ?? 'Save failed — reverted', 'error');
            }
          });
      }}
    />
    {transcriptCallId && (
      <CallTranscriptModal
        callId={transcriptCallId}
        callerLabel={activeContact?.name ?? 'Caller'}
        onClose={() => setTranscriptCallId(null)}
      />
    )}
    </>
  );
}

function ActivityIcon({ kind }: { kind: string }) {
  const map: Record<string, { icon: React.ReactNode; bg: string; fg: string }> = {
    call_inbound: {
      icon: <PhoneIncoming className="w-3.5 h-3.5" />,
      bg: '#EEF2F8',
      fg: '#3C5A87',
    },
    call_outbound: {
      icon: <PhoneOutgoing className="w-3.5 h-3.5" />,
      bg: '#DBEAFE',
      fg: '#3B82F6',
    },
    call_missed: {
      icon: <PhoneMissed className="w-3.5 h-3.5" />,
      bg: '#FEF2F2',
      fg: '#EF4444',
    },
    sms_inbound: {
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      bg: '#F3F3EE',
      fg: '#6B7280',
    },
    sms_outbound: {
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      bg: '#EEF2F8',
      fg: '#3C5A87',
    },
    voicemail: {
      icon: <Voicemail className="w-3.5 h-3.5" />,
      bg: '#F3F3EE',
      fg: '#9CA3AF',
    },
    stage_moved: { icon: <span>↗</span>, bg: '#EEF2F8', fg: '#3C5A87' },
    tag_added: { icon: <span>#</span>, bg: '#F3F3EE', fg: '#6B7280' },
  };
  const m = map[kind] ?? map.sms_inbound;
  return (
    <div
      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
      style={{ background: m.bg, color: m.fg }}
    >
      {m.icon}
    </div>
  );
}

// satisfy unused-import lint when build pruning occurs
void formatDuration;
