import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
  Bot,
  Clapperboard,
  Globe,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  Megaphone,
  Loader2,
  Check,
  CheckCheck,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { snippet } from '@/core/lib/format';
import { MOCK_SMS, MOCK_ACTIVITIES } from '../data/mockCalls';
import { useDemoMode } from '../lib/useDemoMode';
import { formatRelativeTime, formatTimeOnly, formatDuration, formatDateTime } from '../data/helpers';
import StageSelector from '../components/shared/StageSelector';
import EditContactModal from '../components/contacts/EditContactModal';
import EditableName from '../components/contacts/EditableName';
import FollowupPromptModal from '../components/followups/FollowupPromptModal';
import { useSmsV2 } from '../store/SmsV2Store';
import { useContactTimeline, type FunnelEvent, type SiteEvent } from '../hooks/useContactTimeline';
import { useContactMessages } from '../hooks/useContactMessages';
import {
  callWaAdmin,
  isApproved,
  renderTemplate,
  waWindowOpen,
  type MetaTemplate,
} from '../lib/waAdmin';
import { useInboxThreads } from '../hooks/useInboxThreads';
import { useContactPersistence } from '../hooks/useContactPersistence';
import { signCallRecording, useCalls } from '../hooks/useCalls';
import CallTranscriptModal from '../components/calls/CallTranscriptModal';
import { useSmsTemplates } from '../hooks/useSmsTemplates';
import { useCurrentAgent } from '../hooks/useCurrentAgent';
import { interpolateTemplate } from '../lib/interpolateTemplate';
import { supabase } from '@/integrations/supabase/browser';
import { useDialerProModal } from '../layout/DialerProModalContext';
import type { Contact, CallRecord, ActivityEvent } from '../types';
import LeadIdentity, { isPropertyLead, askForName } from '../components/shared/LeadIdentity';
import { DEAL_STAGES } from '../components/templates/dealProcessSteps';
import BriefLine from '../components/shared/BriefLine';
import PropertyLinkChips from '../components/shared/PropertyLinkChips';
import { usePropertyLinks, phoneTail, type PropertyLink } from '../hooks/usePropertyLinks';
import InboundMedia from '../components/InboundMedia';
import AgentChip from '../components/shared/AgentChip';
import CalcChip from '../components/shared/CalcChip';
import MessageBody from '../components/shared/MessageBody';
import { CONTACT_COLUMNS } from '../hooks/useHydrateContacts';
import { useContactFunnelStatus } from '../hooks/useContactFunnelStatus';
import { usePendingDrafts } from '../hooks/usePendingDrafts';
import { useInboxState } from '../hooks/useInboxState';
import { useAiReplyStatus } from '../hooks/useAiReplyStatus';
import { useAuth } from '../lib/useCrmAuth';
import { useViewAs } from '../lib/ViewAsContext';
import { isThreadUnread, sortInboxRows, inboxSections } from '../lib/inboxOrder';
import { useHeypubliJourney } from '../hooks/useHeypubliJourney';
import { nextTouch, dueLabel } from '@/core/heypubli/journey';
import { useHeypubliBrain, describeBrainState } from '../hooks/useHeypubliBrain';
import JourneyPanel from '../components/journey/JourneyPanel';

/** Did this lead come through the HeyPubli creator funnel?
 *
 *  ONE stamp, three readers: wk-partner-api writes custom_fields.product on
 *  the way out, wk-sms-incoming reads it to fan inbound replies back to
 *  HeyPubli, and the inbox reads it here. A creator is a person, not a
 *  business, so the owner + website identity line means nothing for them and
 *  is dropped. It stays for every other lead, because the SAME inbox serves
 *  the Reviews product where the website is the entire point. */
const isHeypubliProduct = (cf?: Record<string, string> | null): boolean =>
  (cf?.product ?? '') === 'heypubli';

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
    error: { message: string; context?: Response } | null;
  }>;
}

/** supabase-js hides a non-2xx edge function's JSON body behind
 *  error.context (a Response); error.message is always the fixed string
 *  "Edge Function returned a non-2xx status code". Dig the real reason out,
 *  or the plain-words 24h-window / lead-lock / kill-switch messages the
 *  functions return can never reach a toast. */
async function fnErrorText(
  error: { message?: string; context?: Response } | null,
  data: { error?: string } | null,
): Promise<string | null> {
  if (data?.error) return data.error;
  if (!error) return null;
  try {
    const body = await error.context?.clone().json() as { error?: unknown } | undefined;
    if (body?.error) return String(body.error);
  } catch { /* body was not JSON, fall through to the generic message */ }
  return error.message ?? 'unknown';
}

type Filter =
  | 'all'
  | 'unread'
  | 'drafts'
  | 'onboarded'
  | 'sms'
  | 'whatsapp'
  | 'email'
  | 'calls'
  | 'voicemail'
  | 'missed'
  | 'archived';

/** Hugo 2026-08-02: ten pills in one wrapped row read as noise. Split into
 *  two single-line rows with a fixed meaning each: WHAT STATE a thread is in
 *  (someone waiting on you / put away), then WHERE it happened (channel or
 *  call). Same single-select behaviour, same testids, purely visual grouping.
 *  Each row scrolls sideways instead of wrapping (the WhatsApp chip pattern).
 *  The 280px pane fits about 255px of pills, so display labels are short;
 *  the Filter values and testids stay the long canonical names. */
// 'onboarded' = creator leads with every HeyPubli step done (the 5/5 badge the
// rows already wear). Hugo 2026-08-07: "a filter by people who have fully
// onboarded". Label kept to "5/5" so the state row still fits the 280px pane.
const STATE_FILTERS: Filter[] = ['all', 'unread', 'drafts', 'onboarded', 'archived'];
const SOURCE_FILTERS: Filter[] = ['sms', 'whatsapp', 'email', 'calls', 'voicemail', 'missed'];
const FILTER_LABEL: Record<Filter, string> = {
  all: 'all',
  unread: 'unread',
  drafts: 'drafts',
  onboarded: '5/5',
  archived: 'archived',
  sms: 'sms',
  whatsapp: 'WA',
  email: 'email',
  calls: 'calls',
  voicemail: 'VM',
  missed: 'missed',
};

/** What the empty list should call the current filter, in a human sentence. */
const EMPTY_CHANNEL_LABEL: Partial<Record<Filter, string>> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'email',
};

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
  const [attachmentUploading, setAttachmentUploading] = useState(false);
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

  // Hugo 2026-08-03: Meta-approved WhatsApp templates. The ONLY message that
  // reaches a lead who has not written in the last 24 hours (WhatsApp's rule,
  // enforced by Twilio). Loaded lazily the first time WhatsApp is picked.
  const [metaTemplates, setMetaTemplates] = useState<MetaTemplate[]>([]);
  const [metaTemplatesLoaded, setMetaTemplatesLoaded] = useState(false);
  const [metaTplSid, setMetaTplSid] = useState<string>('');
  const [metaVars, setMetaVars] = useState<Record<string, string>>({});

  // PR 89 (Hugo 2026-04-27): inbox search bar \u2014 was rendered with no
  // onChange + no state, so typing did nothing. Now filters sidebarRows
  // by name / phone / last message body (case-insensitive).
  const [searchQuery, setSearchQuery] = useState('');
  // Hugo, 2026-07-29: "I should be able to see the inbox per campaign."
  // 'all' (default) shows every thread; otherwise restricts to one campaign's.
  const [campaignFilter, setCampaignFilter] = useState<string>('all');

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
      .select(CONTACT_COLUMNS)
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
  const { threads: inboxThreads, loading: threadsLoading } = useInboxThreads();

  // THE HOUSE BEHIND THE BRANCH, in the inbox as well as on the board.
  //
  // Hugo, 2026-08-14: "make sure information we have on the card on the
  // pipeline also accessible in the inbox."
  //
  // Same batched RPC the pipeline board uses, keyed on the last 9 digits of
  // the phone, so a branch reading its own thread shows the same deal, the
  // same instruction and the same person to ask for as its card. Before this
  // the inbox said the red gap marker on the very branch the board was
  // already labelling "Ask for Doug".
  const inboxPhones = useMemo(
    () => contacts.map((c) => c.phone).filter(Boolean),
    [contacts],
  );
  const { byPhone: inboxPropertiesByPhone } = usePropertyLinks(inboxPhones);
  // A branch can hold several houses. The one that speaks for the thread is
  // the one carrying the freshest instruction, exactly as on the board:
  // Hugo's pinned note first, then the most recent brief.
  const dealForPhone = useCallback((phone?: string | null): PropertyLink | null => {
    const links = inboxPropertiesByPhone.get(phoneTail(phone ?? ''));
    if (!links || links.length === 0) return null;
    return [...links].sort((a, b) => {
      const pin = Number(!!b.pinned_note) - Number(!!a.pinned_note);
      if (pin !== 0) return pin;
      return String(b.brief?.written_at ?? '').localeCompare(String(a.brief?.written_at ?? ''));
    })[0];
  }, [inboxPropertiesByPhone]);
  // Calls/Voicemail/Missed pills are sourced from wk_calls, not message
  // threads. Loaded here so those pills show real call rows instead of
  // falling through to the full SMS list.
  const { calls, loading: callsLoading } = useCalls();

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
      kind: 'message' | 'call';
      name: string;
      phone: string;
      email?: string;
      owner: string;
      website: string;
      /** The lead's own fields, so the row can tell a property branch from a
       *  reviews lead and show "Ask for Doug" instead of the red gap marker. */
      customFields?: Record<string, string>;
      /** A HeyPubli creator: an individual, never a business with a website. */
      isCreatorLead: boolean;
      pipelineColumnId: string | undefined;
      ownerAgentId: string | undefined;
      lastMessageBody: string | null;
      lastMessageAt: string | null;
      lastDirection: 'inbound' | 'outbound' | null;
      lastChannel: ChannelKindUI | null;
      channelCounts: Record<ChannelKindUI, number>;
      lastInboundAt: string | null;
      lastOutboundAt: string | null;
      inboundSinceReply: number;
      callStatus?: CallRecord['status'];
      isHot: boolean;
      tags: string[];
      /** Which campaign this thread belongs to (message rows only — see
       *  useInboxThreads). Undefined on call rows, not looked up there. */
      campaignId?: string | null;
      campaignName?: string | null;
    };

    const isCallFilter = filter === 'calls' || filter === 'voicemail' || filter === 'missed';
    let rows: Row[];

    if (isCallFilter) {
      // Calls-family pills: build the sidebar from wk_calls (one row per
      // contact, latest call first), NOT from message threads — otherwise
      // the SMS inbox shows through. 'voicemail'/'missed' scope by status.
      const scoped = calls.filter((call) => {
        if (!call.contactId) return false; // no contact = no thread to open
        if (filter === 'voicemail') return call.status === 'voicemail';
        if (filter === 'missed') return call.status === 'missed';
        return true; // 'calls' = every call
      });
      const seen = new Set<string>();
      const callRows: Row[] = [];
      for (const call of scoped) {
        // calls arrive newest-first from useCalls; keep only the latest per contact
        if (seen.has(call.contactId)) continue;
        seen.add(call.contactId);
        const c = contactById.get(call.contactId);
        const label =
          call.status === 'missed' ? 'Missed call'
          : call.status === 'voicemail' ? 'Voicemail'
          : call.status === 'failed' ? 'Call failed'
          : call.status === 'ringing' ? 'Ringing…'
          : call.durationSec > 0 ? `Call · ${formatDuration(call.durationSec)}`
          : 'Call';
        callRows.push({
          id: call.contactId,
          kind: 'call',
          name: c?.name || call.fromE164 || call.toE164 || 'Unknown',
          owner: c?.customFields?.owner_name ?? '',
          website: c?.customFields?.website ?? '',
          customFields: c?.customFields,
          isCreatorLead: isHeypubliProduct(c?.customFields),
          phone: c?.phone ?? call.fromE164 ?? call.toE164 ?? '',
          email: c?.email,
          pipelineColumnId: c?.pipelineColumnId,
          ownerAgentId: c?.ownerAgentId,
          lastMessageBody: call.aiSummary ? `${label} — ${call.aiSummary}` : label,
          lastMessageAt: call.startedAt,
          lastDirection: call.direction,
          lastChannel: null,
          channelCounts: { sms: 0, whatsapp: 0, email: 0 },
          // Unread is a message concept; a call row is never bolded.
          lastInboundAt: null,
          lastOutboundAt: null,
          inboundSinceReply: 0,
          callStatus: call.status,
          isHot: !!c?.isHot,
          tags: c?.tags ?? [],
        });
      }
      rows = callRows;
    } else {
      // Message threads (already ordered newest first by useInboxThreads).
      const out: Row[] = [];
      for (const t of inboxThreads) {
        const c = contactById.get(t.contactId);
        out.push({
          id: t.contactId,
          kind: 'message',
          name: c?.name || t.contactName || t.contactPhone || 'Unknown',
          phone: c?.phone ?? t.contactPhone,
          email: c?.email,
          owner: c?.customFields?.owner_name || t.contactOwner,
          website: c?.customFields?.website || t.contactWebsite,
          customFields: c?.customFields,
          isCreatorLead: isHeypubliProduct(c?.customFields) || t.contactProduct === 'heypubli',
          pipelineColumnId: c?.pipelineColumnId,
          ownerAgentId: c?.ownerAgentId,
          lastMessageBody: t.lastMessageBody,
          lastMessageAt: t.lastMessageAt,
          lastDirection: t.lastDirection,
          lastChannel: t.lastChannel,
          channelCounts: t.channelCounts,
          lastInboundAt: t.lastInboundAt,
          lastOutboundAt: t.lastOutboundAt,
          inboundSinceReply: t.inboundSinceReply,
          isHot: !!c?.isHot,
          tags: c?.tags ?? [],
          campaignId: t.campaignId,
          campaignName: t.campaignName,
        });
      }
      // 'sms' / 'whatsapp' / 'email' restrict to threads on that channel.
      rows = out;
      if (filter === 'sms' || filter === 'whatsapp' || filter === 'email') {
        rows = rows.filter((r) => r.lastChannel === filter || r.channelCounts[filter] > 0);
      }
    }

    // Campaign filter — 'all' shows everything, otherwise restrict to threads
    // tagged with the picked campaign id.
    if (campaignFilter !== 'all') {
      rows = rows.filter((r) => r.campaignId === campaignFilter);
    }

    // PR 89: free-text search across name, phone, last message body.
    const q = searchQuery.trim().toLowerCase();
    if (q.length > 0) {
      rows = rows.filter((r) => {
        const hay = `${r.name} ${r.phone} ${r.owner} ${r.website} ${r.lastMessageBody ?? ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }, [inboxThreads, calls, contacts, filter, campaignFilter, searchQuery]);

  // Every distinct campaign present in the current thread list, for the
  // filter dropdown. Recomputed from inboxThreads (not sidebarRows, which is
  // already campaign-filtered) so a picked campaign never removes itself
  // from its own dropdown.
  const campaignOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const t of inboxThreads) {
      if (t.campaignId && t.campaignName) byId.set(t.campaignId, t.campaignName);
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [inboxThreads]);

  // Video + "waiting on you" decoration.
  //
  // The id list comes from the UNFILTERED sources, never from sidebarRows:
  // feeding it post-search would re-query wk_vsl_pages on every keystroke. And
  // it is a SECOND memo, not part of sidebarRows — putting it inside while
  // feeding the hook from sidebarRows is circular.
  const allRowIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...inboxThreads.map((t) => t.contactId),
          ...calls.map((c) => c.contactId).filter(Boolean),
        ]),
      ),
    [inboxThreads, calls],
  );
  const funnelByContact = useContactFunnelStatus(allRowIds);
  // Where each creator lead is on the HeyPubli onboarding. Fed from the
  // UNFILTERED threads for the same reason allRowIds is: keying it off the
  // searched list would fire a cross-project lookup on every keystroke.
  //
  // CREATOR LEADS ONLY. This inbox is shared: 125 of its 5,656 contacts are
  // HeyPubli creators and the rest are plumbers, Reviews customers and
  // receptionist customers who will never have a HeyPubli account. Sending all
  // of them was wasted work, it walked straight into the route's cap, and it
  // is what made the cross-project read worth attacking in the first place.
  // The stamp is the same custom_fields.product the row badge reads.
  const journeyContacts = useMemo(() => {
    const cfById = new Map(contacts.map((c) => [c.id, c.customFields] as const));
    return inboxThreads
      .filter((t) => t.contactProduct === 'heypubli' || isHeypubliProduct(cfById.get(t.contactId)))
      .map((t) => ({ id: t.contactId, phone: t.contactPhone }));
  }, [inboxThreads, contacts]);
  const { byContact: journeyByContact, chaseByContact, status: journeyStatus } =
    useHeypubliJourney(journeyContacts);
  // The countdown on the cards has to move. A 30 second beat is enough for a
  // label whose finest unit is a minute. Hugo, 07 Aug 2026: "put a time when
  // you're gonna follow up next... with the countdown."
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // What the HeyPubli reply brain DID about each creator thread: answered,
  // deliberately silent, refused, handed to a human, or (the alarm) never
  // looked at. Same creator-only list as the journey lookup, same reasons.
  const { byContact: brainByContact, status: brainStatus } =
    useHeypubliBrain(journeyContacts);
  const { contactIds: pendingDraftIds, draftByContact, refetch: refetchDrafts } = usePendingDrafts();
  const { flags: inboxFlags, markRead, togglePin, toggleArchive } = useInboxState();
  // Hugo 2026-08-02: "show if the AI of the inbox is on and off". Workspace
  // stance from wk_ai_reply_settings; admins get a link to change it.
  const aiStatus = useAiReplyStatus();
  const { isAdmin } = useAuth();
  // For the empty state only: an admin impersonating an agent needs to be
  // TOLD the view is scoped, or an empty filter reads as a bug, and given a
  // one-click way OUT (hunting for the top-bar control cost Hugo ten minutes).
  const { viewAsId, viewAsName, setViewAs } = useViewAs();

  // One pass: decorate, drop what this filter hides, then order.
  //
  // Hugo 2026-08-06: a normal inbox, pinned then pure recency. Unread keeps
  // its badge and its pill; it no longer jumps the queue (that superseded the
  // 2026-07-28 unread-on-top rule).
  const decoratedRows = useMemo(() => {
    const nowMs = Date.now();
    const decorated = sidebarRows.map((r) => {
      const f = inboxFlags.get(r.id);
      const waitingOnUs = r.kind === 'message' && r.lastDirection === 'inbound';
      const brainBadge = r.isCreatorLead
        ? describeBrainState(brainByContact.get(r.id) ?? null, brainStatus, {
            waitingOnUs,
            lastInboundAt: r.lastInboundAt,
            waitingMinutes:
              waitingOnUs && r.lastInboundAt
                ? Math.round((nowMs - Date.parse(r.lastInboundAt)) / 60000)
                : null,
          })
        : null;
      // "Everyone deserves a follow-up." One small answer per card: when the
      // machine next chases this person if they stay quiet, or the plain
      // admission that nothing ever will. Creators use the nudge ladder's own
      // clock (nextTouch); pre-signup leads use the drip's stamp (chase).
      const j = journeyByContact.get(r.id) ?? null;
      let followUp: { label: string; tone: 'wait' | 'due' | 'stopped'; title: string } | null = null;
      if (r.isCreatorLead) {
        const nowD = new Date(nowTick);
        if (j) {
          const next = nextTouch({
            now: nowD,
            hasAccount: true,
            allDone: j.allDone,
            openStep: j.openStep,
            suspendedAt: j.suspendedAt,
            stoppedAt: j.stoppedAt,
            nudgeCount: j.nudgeCount,
            lastNudgedAt: j.lastNudgedAt,
            lastActivityAt: j.lastActivityAt,
            lastInboundAt: r.lastInboundAt,
            lastOutboundAt: r.lastOutboundAt,
            checkInsThisStep: 0,
            checkInsLive: true,
          });
          if (next.kind === 'stopped') {
            followUp = { label: 'no more follow-ups', tone: 'stopped', title: next.detail };
          } else if (next.kind === 'nudge' && next.dueAt) {
            followUp = next.overdue
              ? { label: 'follow-up due', tone: 'due', title: next.detail }
              : { label: `next ${dueLabel(next.dueAt, nowD)}`, tone: 'wait', title: `${next.label}. ${next.detail}` };
          }
          // 'done' (5/5) and 'reply' (waiting on the brain) say nothing here:
          // the 5/5 badge and the brain badge already own those stories.
        } else {
          const ch = chaseByContact.get(r.id) ?? null;
          if (ch?.kind === 'drip' && ch.at) {
            const l = dueLabel(ch.at, nowD);
            followUp =
              l === 'due now'
                ? { label: 'follow-up due', tone: 'due', title: 'The automatic WhatsApp follow-up is due to go out.' }
                : { label: `next ${l}`, tone: 'wait', title: 'Automatic WhatsApp follow-up if they do not reply.' };
          } else if (ch?.kind === 'stopped') {
            followUp = { label: 'no more follow-ups', tone: 'stopped', title: ch.reason ?? 'Nothing more will be sent automatically.' };
          } else if (ch?.kind === 'none') {
            followUp = {
              label: 'nothing scheduled',
              tone: 'due',
              title: ch.reason ?? 'No automatic follow-up will fire for this lead. A human chases them or nobody does.',
            };
          }
        }
      }
      return {
        ...r,
        vsl: funnelByContact.get(r.id) ?? null,
        journey: j,
        followUp,
        brainBadge,
        draftPending: pendingDraftIds.has(r.id),
        // Preview only. Deliberately NOT the row's timestamp and NOT counted
        // as outbound, both of those were real bugs (see useInboxThreads).
        draftBody: draftByContact.get(r.id) ?? null,
        pinnedAt: f?.pinnedAt ?? null,
        archivedAt: f?.archivedAt ?? null,
        unread: isThreadUnread(r, f?.lastReadAt),
      };
    });

    // Archived threads are hidden from every other view — that is the point of
    // archiving. They come back under the ARCHIVED pill, un-archive included.
    const scoped =
      filter === 'archived'
        ? decorated.filter((r) => r.archivedAt)
        : decorated.filter((r) => !r.archivedAt);

    const byFilter =
      filter === 'unread' ? scoped.filter((r) => r.unread)
      : filter === 'drafts' ? scoped.filter((r) => r.draftPending)
      : filter === 'onboarded' ? scoped.filter((r) => r.journey?.allDone)
      : scoped;

    return sortInboxRows(byFilter);
  }, [sidebarRows, funnelByContact, journeyByContact, chaseByContact, nowTick, brainByContact, brainStatus, pendingDraftIds, draftByContact, inboxFlags, filter]);

  // The same order, regrouped into labelled bands (pinned / needs a reply /
  // everything else). Headers render only when the list actually mixes bands.
  const sections = useMemo(() => inboxSections(decoratedRows), [decoratedRows]);

  // Badge counts on the pills. All computed off the whole non-archived list,
  // not the current view, so switching filters never changes them.
  //
  // 5/5 carries a count for the same reason the others do. Hugo, 08 Aug 2026:
  // "when I click 5/5 it only shows me five users, it should show all of them
  // and on top the number of users that is on 5/5." Five rows and the number
  // five are indistinguishable by eye, so the pill now says how many fully
  // onboarded creators exist and the list under it is all of them.
  const { unreadTotal, draftTotal, onboardedTotal } = useMemo(() => {
    let unreadTotal = 0;
    let draftTotal = 0;
    let onboardedTotal = 0;
    for (const r of sidebarRows) {
      if (inboxFlags.get(r.id)?.archivedAt) continue;
      if (isThreadUnread(r, inboxFlags.get(r.id)?.lastReadAt)) unreadTotal += 1;
      if (pendingDraftIds.has(r.id)) draftTotal += 1;
      if (journeyByContact.get(r.id)?.allDone) onboardedTotal += 1;
    }
    return { unreadTotal, draftTotal, onboardedTotal };
  }, [sidebarRows, inboxFlags, pendingDraftIds, journeyByContact]);

  const openThread = useCallback(
    (contactId: string) => {
      setActiveContactId(contactId);
      // Marked read on a DELIBERATE click only. The inbox auto-selects the top
      // row on load; marking that read would silently clear the bold on the
      // newest reply before anyone had looked at it.
      markRead(contactId);
    },
    [markRead],
  );

  const onPin = useCallback(
    async (contactId: string, pinned: boolean) => {
      const err = await togglePin(contactId);
      if (err) pushToast(`Could not ${pinned ? 'unpin' : 'pin'}: ${err}`, 'error');
      else pushToast(pinned ? 'Unpinned' : 'Pinned to the top', 'success');
    },
    [togglePin, pushToast],
  );

  const onArchive = useCallback(
    async (contactId: string, archived: boolean) => {
      const err = await toggleArchive(contactId);
      if (err) pushToast(`Could not ${archived ? 'restore' : 'archive'}: ${err}`, 'error');
      else pushToast(archived ? 'Back in the inbox' : 'Archived. Find it under ARCHIVED.', 'success');
    },
    [toggleArchive, pushToast],
  );

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
    if (!activeContactId && decoratedRows.length > 0) {
      setActiveContactId(decoratedRows[0].id);
    }
    // If the currently-selected contact disappeared from the VISIBLE list
    // (archived, or filtered out), fall back to the top row. Deliberately the
    // visible list and not sidebarRows, so archiving the open thread moves the
    // agent on to the next one instead of leaving a ghost selected.
    if (activeContactId && !decoratedRows.some((r) => r.id === activeContactId) && decoratedRows.length > 0) {
      setActiveContactId(decoratedRows[0].id);
    }
  }, [decoratedRows, activeContactId, searchParams, setSearchParams]);

  // Resolve activeContact from the store first (full Contact shape
  // for stage selector / edit modal) — fall back to a synthesized
  // shim from the sidebar row when the store hasn't hydrated yet.
  const activeRow = sidebarRows.find((r) => r.id === activeContactId);
  const activeDeal = dealForPhone(activeRow?.phone ?? contacts.find((c) => c.id === activeContactId)?.phone);
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
  const activeIsCreatorLead =
    isHeypubliProduct(activeContact?.customFields) || Boolean(activeRow?.isCreatorLead);
  // A house thread, so the property templates apply and the reviews-era ones
  // are noise.
  const activeIsProperty = isPropertyLead(activeContact?.customFields, !!activeDeal);
  const activeJourney = activeContactId ? journeyByContact.get(activeContactId) ?? null : null;
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
  const crmSms = useMemo(() => crmMessages
    .filter((m) => m.status !== 'discarded')
    .map((m) => ({
      id: m.id,
      contactId: m.contactId,
      direction: m.direction,
      body: m.body,
      sentAt: m.createdAt,
      channel: m.channel,
      subject: m.subject,
      attachmentUrl: m.attachmentUrl,
      // Only the count travels. The bytes are fetched per item through
      // /api/crm/media, because the Twilio URLs need our credentials.
      mediaCount: m.mediaUrls.length,
      status: m.status,
      aiGenerated: m.aiGenerated,
    })), [crmMessages]);

  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const draftAction = useCallback(async (draftId: string, action: 'send' | 'discard', body?: string) => {
    setDraftBusy(draftId);
    try {
      // 2026-08-02: the result used to be dropped on the floor, so a failed
      // approval (24h WhatsApp window closed, kill switch, opt-out) showed
      // NOTHING, the badge just came back with no explanation.
      const { data, error } = await supabase.functions.invoke('wk-draft-action', {
        body: { draft_id: draftId, action, body },
      }) as { data: { ok?: boolean; error?: string } | null; error: { message: string; context?: Response } | null };
      if (error || data?.error) {
        pushToast(
          `Draft ${action} failed: ${(await fnErrorText(error, data)) ?? 'unknown'}`,
          'error'
        );
      }
    } finally {
      setDraftBusy(null);
      // Clear the row's "AI reply" pill straight away rather than waiting on
      // the realtime UPDATE — approving and still seeing the badge reads as a
      // failed action.
      refetchDrafts();
    }
  }, [refetchDrafts, pushToast]);

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
    const items: { kind: 'sms' | 'call' | 'activity' | 'funnel' | 'site'; ts: string; payload: unknown }[] = contactSms.map((m) => ({
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
    // Video-funnel activity, in line with the calls and texts (Hugo 2026-07-26)
    // — the lead watching your video is part of the conversation.
    for (const f of timeline.funnel) {
      items.push({ kind: 'funnel' as const, ts: f.ts, payload: f });
    }
    for (const e of timeline.site) {
      items.push({ kind: 'site' as const, ts: e.ts, payload: e });
    }
    items.sort((a, b) => +new Date(a.ts) - +new Date(b.ts));
    return items;
  }, [contactSms, timeline.calls, contactActivity, timeline.funnel]);

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

  // THE PROPERTY TEMPLATES, in the inbox as well as the board.
  //
  // Hugo, 2026-08-14: "when I open it I should be able to have the email
  // templates, but not only the pipelines, I should be able to have the email
  // template ready as well as in the inbox."
  //
  // They already existed, in components/templates/dealProcessSteps.ts, which
  // drives the Deal process page and the next-step popover. But they were
  // copy-to-clipboard only and never reached a compose box, so the inbox
  // dropdown offered exactly two leftovers from the reviews business
  // ("Subscribe link", "Onboarding link") on an estate agency thread.
  //
  // Read from the SAME list, so the playbook and the box can never drift.
  const propertyTemplates = useMemo(() => {
    if (!activeIsProperty) return [];
    // The deal process labels its templates for humans ('Email', 'WhatsApp',
    // 'Phone'); the compose box speaks in channel keys. A Phone template is a
    // script to read, not something to send, so it never reaches the box.
    const wanted = replyChannel === 'email' ? 'Email'
      : replyChannel === 'whatsapp' ? 'WhatsApp' : null;
    if (!wanted) return [];
    return DEAL_STAGES.flatMap((stage) =>
      stage.templates
        .filter((t) => t.channel === wanted)
        .map((t) => ({
          id: `deal:${stage.tag}:${t.label}`,
          name: `${stage.n}. ${t.label}`,
          body_md: t.body,
          subject: t.subject ?? null,
          channel: replyChannel,
          move_to_stage_id: null,
          attachment_url: null,
        })),
    );
  }, [activeIsProperty, replyChannel]);

  // Property templates FIRST on a house thread: they are the ones that apply.
  const allTemplates = useMemo(
    () => [...propertyTemplates, ...visibleTemplates],
    [propertyTemplates, visibleTemplates],
  );

  const applyTemplate = (id: string) => {
    setSelectedTemplateId(id);
    if (!id) return;
    const tpl = allTemplates.find((t) => t.id === id);
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
    setMetaTplSid('');
    setMetaVars({});
  }, [replyChannel, activeContactId]);

  // Load the approved Meta templates once, the first time WhatsApp is picked.
  // Fail quiet: no approved template just means the picker stays hidden, and
  // free-form replies inside the window are unaffected.
  useEffect(() => {
    if (replyChannel !== 'whatsapp' || metaTemplatesLoaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await callWaAdmin<{ templates: MetaTemplate[] }>({ action: 'template_list' });
        if (!cancelled) setMetaTemplates((res.templates ?? []).filter(isApproved));
      } catch {
        if (!cancelled) setMetaTemplates([]);
      } finally {
        if (!cancelled) setMetaTemplatesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [replyChannel, metaTemplatesLoaded]);

  // Is the free-reply window open on this thread? Outside it WhatsApp drops
  // anything but an approved template, so the composer says so up front
  // instead of letting the send fail.
  const waOpen = useMemo(() => waWindowOpen(crmMessages), [crmMessages]);

  const activeMetaTemplate = metaTemplates.find((t) => t.sid === metaTplSid) ?? null;

  /** Pick (or clear) an approved template, pre-filling {{1}} with the human's
   *  first name. contact.name is the COMPANY in this CRM; the person is
   *  custom_fields.owner_name, so prefer that. */
  const chooseMetaTemplate = (sid: string) => {
    setMetaTplSid(sid);
    const tpl = metaTemplates.find((t) => t.sid === sid);
    // A template carries fixed wording and nothing else: no attachment can
    // ride with it (wk-sms-send refuses one). Drop any staged file here, or
    // it sits in the composer looking attached and is silently dropped.
    if (tpl) setReplyAttachmentUrl(null);
    if (!tpl) { setMetaVars({}); return; }
    const person =
      (activeContact?.customFields?.owner_name ?? '').trim() ||
      (activeContact?.name ?? '').trim();
    const first = person.split(/\s+/)[0] ?? '';
    const vars: Record<string, string> = {};
    for (const n of new Set([...tpl.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1]))) {
      vars[n] = n === '1' ? first : '';
    }
    setMetaVars(vars);
  };

  const send = async () => {
    if (!activeContact || sending) return;
    // A template send carries no typed text: the wording is the one Meta
    // approved, only the blanks travel.
    const sendingTemplate = replyChannel === 'whatsapp' && !!activeMetaTemplate;
    if (!sendingTemplate && !reply.trim()) return;
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
      // whatsapp → wk-sms-send with channel:'whatsapp' (2026-08-02: the
      //            Twilio WhatsApp sender replaced Unipile here, that key is
      //            dead and the receptionist inbox keeps its own path)
      // email    → wk-email-send (Resend)
      const fn = supabase.functions as unknown as SmsSendInvoke;
      const trimmedBody = reply.trim();
      let resp: Awaited<ReturnType<SmsSendInvoke['invoke']>>;
      const attach = replyAttachmentUrl || undefined;
      if (sendingTemplate) {
        // Meta template: the server checks it is still approved, fills the
        // blanks from Twilio's own copy and stores the finished wording.
        resp = await fn.invoke('wk-sms-send', {
          body: {
            contact_id: activeContact.id,
            channel: 'whatsapp',
            content_sid: activeMetaTemplate!.sid,
            content_variables: metaVars,
          },
        });
      } else if (replyChannel === 'whatsapp') {
        resp = await fn.invoke('wk-sms-send', {
          body: { contact_id: activeContact.id, body: trimmedBody, attachment_url: attach, channel: 'whatsapp' },
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
          `${channelLabel} send failed: ${(await fnErrorText(error, data)) ?? 'unknown'}`,
          'error'
        );
      } else {
        pushToast(sendingTemplate ? 'Template sent' : `${channelLabel} sent`, 'success');
        setReply('');
        setMetaTplSid('');
        setMetaVars({});
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

  // NOTE: we intentionally do NOT early-return a blank page when nothing is
  // selected. That used to replace the ENTIRE inbox (sidebar + filters) with a
  // misleading "No contacts yet" — the "inbox glitch" Hugo saw when an agent
  // had calls but no message threads. The sidebar always renders; Pane 2 shows
  // a placeholder instead.

  return (
    <>
    <div className="h-full flex">
      {/* Pane 1 — list */}
      <aside data-testid="inbox-list" className="w-[280px] bg-white border-r border-[#E5E7EB] flex flex-col">
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
          {/* Filter header, reorganised 2026-08-03 (Hugo: "ugly and
              unorganised"). Four fixed one-line rows, nothing ever wraps:
                1. state pills   (ALL / UNREAD / DRAFTS / archive icon)
                2. channel pills (SMS / WA / EMAIL / CALLS / VM / MISSED)
                3. AI status pill (left) + campaign select (right)
              Same single-select `filter`, same testids. Compact px-1.5 pills
              so each row genuinely fits the 280px pane (a previous "two short
              rows" attempt measured 398px and wrapped into four lines). */}
          {(() => {
            const pill = (f: Filter) => {
              const count =
                f === 'unread' ? unreadTotal
                : f === 'drafts' ? draftTotal
                : f === 'onboarded' ? onboardedTotal
                : 0;
              const iconOnly = f === 'archived';
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  data-testid={`inbox-filter-${f}`}
                  title={iconOnly ? 'Archived' : f === 'onboarded' ? 'Fully onboarded creators (all 5 steps done)' : undefined}
                  aria-label={iconOnly ? 'Archived conversations' : f === 'onboarded' ? 'Fully onboarded creators' : undefined}
                  className={cn(
                    'inline-flex flex-shrink-0 items-center gap-1 px-1.5 py-[3px] text-[10px] font-semibold rounded-full transition-colors uppercase tracking-wide',
                    filter === f
                      ? 'bg-[#3C5A87] text-white'
                      : 'bg-[#F3F3EE] text-[#6B7280] hover:bg-black/[0.05]'
                  )}
                >
                  {f === 'archived' && <Archive style={{ width: 10, height: 10 }} />}
                  {f === 'drafts' && <Bot style={{ width: 9, height: 9 }} />}
                  {!iconOnly && FILTER_LABEL[f]}
                  {count > 0 && (
                    <span
                      data-testid={`inbox-filter-count-${f}`}
                      className={cn(
                        'min-w-[14px] px-1 rounded-full text-[9px] font-bold tabular-nums text-center',
                        filter === f ? 'bg-white/25 text-white' : 'bg-[#3C5A87] text-white'
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            };
            // Sideways scroll is a safety net only; both rows fit at 280px.
            const rowCls = 'flex gap-1 flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
            return (
              <>
                <div className={rowCls}>{STATE_FILTERS.map(pill)}</div>
                <div className={rowCls}>{SOURCE_FILTERS.map(pill)}</div>
              </>
            );
          })()}
          {/* One quiet status row: is the AI answering this inbox (left), and
              the campaign scope (right, only once campaigns exist). Fixed
              height so the async pill never shifts the rows above/below. */}
          <div className="h-[24px] flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              {aiStatus.loaded && (
                <>
                  <span
                    data-testid="inbox-ai-status"
                    title={
                      !aiStatus.enabled
                        ? 'The AI reply engine is switched off. Incoming texts wait for a human.'
                        : aiStatus.mode === 'auto'
                          ? 'The AI answers incoming texts by itself (campaigns set to draft still wait for approval).'
                          : 'The AI writes a draft for every incoming text and waits for your approval. Nothing sends on its own.'
                    }
                    className={cn(
                      'inline-flex flex-shrink-0 items-center gap-1 px-1.5 py-[3px] text-[9.5px] font-bold uppercase tracking-wide rounded-full border',
                      !aiStatus.enabled
                        ? 'bg-[#F3F3EE] border-[#E5E7EB] text-[#6B7280]'
                        : aiStatus.mode === 'auto'
                          ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                          : 'bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]'
                    )}
                  >
                    <Bot style={{ width: 10, height: 10 }} />
                    {!aiStatus.enabled
                      ? 'AI off'
                      : aiStatus.mode === 'auto'
                        ? 'AI auto-replies'
                        : 'AI drafts, you approve'}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      data-testid="inbox-ai-status-change"
                      onClick={() => navigateTo('/admin/crm/agent/personality?ch=sms')}
                      className="flex-shrink-0 text-[10px] text-[#3C5A87] font-medium hover:underline underline-offset-2"
                    >
                      change
                    </button>
                  )}
                </>
              )}
            </div>
            {campaignOptions.length > 0 && (
              <div className="flex items-center gap-1 min-w-0">
                <Megaphone style={{ width: 11, height: 11 }} className="text-[#9CA3AF] flex-shrink-0" />
                <select
                  data-testid="inbox-campaign-filter"
                  value={campaignFilter}
                  onChange={(e) => setCampaignFilter(e.target.value)}
                  className="text-[10.5px] bg-[#F3F3EE] border-none rounded-full px-1.5 py-[3px] text-[#374151] font-medium max-w-[120px] truncate focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
                >
                  <option value="all">All campaigns</option>
                  {campaignOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[#E5E7EB]">
          {/* PR 52 war-room: sidebarRows is the union of (a) thread
              rows ordered newest-first by latest wk_sms_messages,
              and (b) contacts with no messages yet. Newest message
              ALWAYS sits at the top, Hugo's spec.
              Hugo 2026-08-02: the pinned/unread/rest bands now carry a small
              sticky label each, but ONLY when the list actually mixes bands,
              so a plain list stays a plain list. */}
          {/* ONE flat array under ONE parent, headers interleaved. Never wrap
              the rows in per-section Fragments: a keyed Fragment is a parent,
              and a row crossing bands (markRead flips unread off) would
              unmount + remount, destroying an in-progress rename and focus. */}
          {sections.flatMap((sec) => [
            ...(sections.length > 1
              ? [
                  <div
                    key={`hdr-${sec.key}`}
                    data-testid={`inbox-section-${sec.key}`}
                    className="sticky top-0 z-[1] px-3 py-1 bg-[#FAFAF7]/95 backdrop-blur-sm text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF] flex items-center gap-1"
                  >
                    {sec.key === 'pinned' && <Pin style={{ width: 9, height: 9 }} />}
                    {sec.key === 'pinned' ? 'Pinned' : sec.key === 'unread' ? 'Needs a reply' : 'Everything else'}
                    <span className="tabular-nums">{sec.rows.length}</span>
                  </div>,
                ]
              : []),
            ...sec.rows.map((r) => {
            const initials = (r.name || r.phone)
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2);
            const actionNeeded = r.draftPending || r.vsl?.readyToSend;
            return (
              // A div, not a button: the row now carries its own pin and
              // archive buttons, and a button inside a button is invalid HTML
              // that browsers "fix" by unnesting, which loses the click.
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                data-testid={`inbox-row-${r.id}`}
                data-unread={r.unread ? '1' : '0'}
                data-pinned={r.pinnedAt ? '1' : '0'}
                onClick={() => openThread(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread(r.id); }
                }}
                className={cn(
                  'group relative w-full text-left px-3 py-2.5 cursor-pointer hover:bg-[#F3F3EE]/50',
                  // Unread gets its own tint so a reply is findable in a list of
                  // 100 blast rows without reading a word of it.
                  r.unread && activeContactId !== r.id && 'bg-[#EFF6FF]',
                  activeContactId === r.id && 'bg-[#EEF2F8]',
                  actionNeeded
                    ? 'border-l-2 border-l-[#F59E0B]'
                    : r.unread
                      ? 'border-l-2 border-l-[#3C5A87]'
                      : r.pinnedAt
                        ? 'border-l-2 border-l-[#94A3B8]'
                        : ''
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center flex-shrink-0',
                    r.unread ? 'bg-[#3C5A87] text-white' : 'bg-[#3C5A87]/15 text-[#3C5A87]'
                  )}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      'text-[13px] truncate flex items-center gap-1',
                      r.unread ? 'font-extrabold text-[#0F172A]' : 'font-semibold text-[#1A1A1A]'
                    )}>
                      {r.pinnedAt && (
                        <Pin
                          data-testid={`inbox-pinned-${r.id}`}
                          style={{ width: 10, height: 10 }}
                          className="flex-shrink-0 text-[#3C5A87]"
                          aria-label="Pinned"
                        />
                      )}
                      <EditableName
                        value={r.name}
                        onSave={(n) => renameContact(r.id, n)}
                        className={r.unread ? 'text-[13px] font-extrabold' : 'text-[13px] font-semibold'}
                      />
                    </div>
                    {/* Owner + website. A HeyPubli creator is a person, not a
                        business, and will never have a website, so the pair of
                        red "not available" gap markers fired on every single
                        one of them and told Hugo nothing. Dropped for creators
                        alone. It stays for everybody else: the SAME inbox
                        serves the Reviews product, where the website is the
                        point of the whole lead. */}
                    <LeadIdentity
                      isProperty={isPropertyLead(r.customFields, dealForPhone(r.phone) != null)}
                      person={askForName(r.customFields, dealForPhone(r.phone)?.branch_contact_name)}
                      owner={r.owner}
                      website={r.website}
                      layout="inline"
                      size="sm"
                      isCreatorLead={r.isCreatorLead}
                    />
                    <AgentChip agentId={r.ownerAgentId} size="xs" />
                    <CalcChip calcAt={r.vsl?.calcAt} count={r.vsl?.calcCount} />
                    {r.campaignName && (
                      <span
                        data-testid={`inbox-campaign-${r.id}`}
                        title={`Campaign: ${r.campaignName}`}
                        className="inline-flex items-center gap-0.5 text-[9.5px] font-medium text-[#6B7280] truncate max-w-[120px]"
                      >
                        <Megaphone style={{ width: 8, height: 8 }} className="flex-shrink-0" />
                        {r.campaignName}
                      </span>
                    )}
                    {/* BADGES on their own line, PREVIEW on the next.
                        Hugo 2026-08-07: with both in one row the badges ate the
                        column and every card read "Hey ...", which is not a
                        message preview. Two lines is what a phone does. */}
                    {(r.journey || (r.isCreatorLead && journeyStatus === 'ready') || r.brainBadge || r.draftPending || r.vsl) && (
                    <div className="flex items-center gap-1 min-w-0">
                      {/* What the reply brain did with this thread, and why.
                          FIVE tones, three of which exist so "we deliberately
                          stopped" (quiet), "handed to you on purpose" (action)
                          and "nobody ever looked" (alarm) can never be read as
                          one another again. `unknown` is the lookup failing:
                          it says "cannot check" out loud rather than showing
                          nothing, because absence reads as fine. */}
                      {r.brainBadge && (
                        <span
                          data-testid={`inbox-brain-${r.id}`}
                          title={r.brainBadge.detail}
                          className={cn(
                            'flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wide px-1 py-px rounded',
                            r.brainBadge.tone === 'ok' && 'bg-[#F0FDF4] border border-[#BBF7D0] text-[#166534]',
                            r.brainBadge.tone === 'quiet' && 'bg-[#F3F4F6] border border-[#D1D5DB] text-[#6B7280]',
                            r.brainBadge.tone === 'action' && 'bg-[#FFFBEB] border border-[#FDE68A] text-[#B45309]',
                            r.brainBadge.tone === 'alarm' && 'bg-[#B91C1C] text-white',
                            r.brainBadge.tone === 'unknown' && 'bg-white border border-dashed border-[#D1D5DB] text-[#9CA3AF]',
                          )}
                        >
                          {r.brainBadge.label}
                        </span>
                      )}
                      {/* How far along the creator onboarding this lead is.
                          A signed-up creator gets a filled n/5 counter; a lead
                          with no account yet gets a hollow "lead" chip. The two
                          are deliberately a different shape as well as a
                          different word, because "1/5" and "not signed up" are
                          opposite states and must never be read as the same.
                          A THIRD state, and the reason for the status check:
                          when the lookup did not run we know neither, so no
                          chip is drawn at all. A "lead" chip there would be
                          the page asserting something it cannot know. */}
                      {r.journey ? (
                        <span
                          data-testid={`inbox-journey-${r.id}`}
                          title={`Onboarding ${r.journey.doneCount} of ${r.journey.totalSteps}: ${r.journey.steps
                            .filter((s) => s.done)
                            .map((s) => s.label)
                            .join(', ') || 'nothing done yet'}`}
                          className={cn(
                            'flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wide px-1 py-px rounded tabular-nums',
                            r.journey.allDone
                              ? 'bg-[#166534] text-white'
                              : 'bg-[#EEF6FF] border border-[#BFDBFE] text-[#3C5A87]',
                          )}
                        >
                          {r.journey.doneCount}/{r.journey.totalSteps}
                        </span>
                      ) : r.isCreatorLead && journeyStatus === 'ready' ? (
                        <span
                          data-testid={`inbox-journey-lead-${r.id}`}
                          title="No HeyPubli account yet. They have not signed up."
                          className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wide px-1 py-px rounded border border-dashed border-[#D1D5DB] text-[#9CA3AF]"
                        >
                          lead
                        </span>
                      ) : null}
                      {/* Waiting on a human — leftmost, so a scan finds it. */}
                      {r.draftPending && (
                        <span
                          data-testid={`inbox-draft-pending-${r.id}`}
                          title="An AI reply is waiting for your approval"
                          className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wide px-1 py-px rounded bg-[#FFFBEB] border border-[#FDE68A] text-[#B45309]"
                        >
                          <Bot style={{ width: 9, height: 9 }} /> AI reply
                        </span>
                      )}
                      {r.vsl?.readyToSend && (
                        <span
                          data-testid={`inbox-video-ready-${r.id}`}
                          title="Video rendered — approve and text it"
                          className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wide px-1 py-px rounded bg-[#F0FDF4] border border-[#BBF7D0] text-[#166534]"
                        >
                          <Send style={{ width: 9, height: 9 }} /> Send video
                        </span>
                      )}
                      {/* Stage chip, in the board's own colour for that stage.
                          Suppressed when the green pill shows — "Ready to send"
                          and "Send video" side by side is one fact twice. */}
                      {r.vsl && !r.vsl.readyToSend && (
                        <span
                          data-testid={`inbox-vsl-${r.id}`}
                          title={`Video funnel — ${r.vsl.label}`}
                          className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wide px-1 py-px rounded"
                          style={{ background: `${r.vsl.color}1F`, color: r.vsl.color }}
                        >
                          <Clapperboard style={{ width: 9, height: 9 }} /> {r.vsl.label}
                        </span>
                      )}
                    </div>
                    )}
                    <div className={cn(
                      'text-[11px] truncate flex items-center gap-1',
                      r.unread ? 'text-[#1A1A1A] font-semibold' : 'text-[#6B7280]'
                    )}>
                      {r.kind === 'call' ? (
                        <>
                          {r.callStatus === 'missed' ? (
                            <PhoneMissed style={{ width: 10, height: 10 }} className="flex-shrink-0 text-[#EF4444]" />
                          ) : r.callStatus === 'voicemail' ? (
                            <Voicemail style={{ width: 10, height: 10 }} className="flex-shrink-0 text-[#F59E0B]" />
                          ) : r.lastDirection === 'outbound' ? (
                            <PhoneOutgoing style={{ width: 10, height: 10 }} className="flex-shrink-0 text-[#3C5A87]" />
                          ) : (
                            <PhoneIncoming style={{ width: 10, height: 10 }} className="flex-shrink-0 text-[#3C5A87]" />
                          )}
                          <span className="truncate">{r.lastMessageBody?.slice(0, 40) ?? '—'}</span>
                        </>
                      ) : r.draftPending && r.draftBody ? (
                        /* WhatsApp's "Draft:" convention. The amber "AI reply"
                           badge to the left already labels it, so the preview
                           is JUST the draft text (a second "AI draft:" prefix
                           squeezed the actual words out of a 150px column).
                           Timestamp and unread state stay driven by real
                           messages, never by drafts. */
                        <span
                          data-testid={`inbox-preview-${r.id}`}
                          className="truncate text-[#B45309]"
                        >
                          {snippet(r.draftBody, 48)}
                        </span>
                      ) : (
                        <>
                          {r.lastChannel && <ChannelGlyph channel={r.lastChannel} size={10} />}
                          {/* The message itself, the way every chat list on a
                              phone shows it. snippet() flattens the newlines a
                              WhatsApp lead-ad message is full of (its first
                              line is blank, so the preview used to render as
                              nothing at all) and truncates with three full
                              stops, never the ellipsis character. */}
                          <span
                            data-testid={`inbox-preview-${r.id}`}
                            title={r.lastMessageBody ?? undefined}
                            className="truncate"
                          >
                            {r.lastMessageBody
                              ? `${r.lastDirection === 'outbound' ? '↗ ' : ''}${snippet(r.lastMessageBody, 40)}`
                              : 'No messages yet'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {/* The next follow-up, or the admission there is none.
                        Hugo, 07 Aug 2026: "next to their name, above the
                        archive and the pin and the minutes... with the
                        countdown. And if it's no more follow-up, you have to
                        write it." */}
                    {r.followUp && (
                      <div
                        data-testid={`inbox-followup-${r.id}`}
                        title={r.followUp.title}
                        className={cn(
                          'text-[9px] font-semibold uppercase tracking-wide tabular-nums whitespace-nowrap',
                          r.followUp.tone === 'wait' && 'text-[#B45309]',
                          r.followUp.tone === 'due' && 'text-[#B91C1C]',
                          r.followUp.tone === 'stopped' && 'text-[#9CA3AF]',
                        )}
                      >
                        {r.followUp.label}
                      </div>
                    )}
                    {r.lastMessageAt && (
                      <div className={cn(
                        'text-[10px] tabular-nums',
                        r.unread ? 'text-[#3C5A87] font-bold' : 'text-[#9CA3AF]'
                      )}>
                        {formatRelativeTime(r.lastMessageAt)}
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      {r.unread && (
                        <span
                          data-testid={`inbox-unread-${r.id}`}
                          title={`${r.inboundSinceReply || 1} unanswered message${(r.inboundSinceReply || 1) === 1 ? '' : 's'}`}
                          className="min-w-[16px] h-[16px] px-1 rounded-full bg-[#3C5A87] text-white text-[9px] font-bold flex items-center justify-center tabular-nums"
                        >
                          {r.inboundSinceReply > 9 ? '9+' : r.inboundSinceReply || 1}
                        </span>
                      )}
                      {/* Pin / archive. Hidden until the row is hovered or is
                          the open one, so a 100-row list stays quiet — except a
                          pinned row, which keeps its button visible so the way
                          to undo it is always in reach. */}
                      <button
                        type="button"
                        data-testid={`inbox-pin-${r.id}`}
                        title={r.pinnedAt ? 'Unpin' : 'Pin to the top'}
                        aria-label={r.pinnedAt ? 'Unpin conversation' : 'Pin conversation to the top'}
                        onClick={(e) => { e.stopPropagation(); void onPin(r.id, !!r.pinnedAt); }}
                        className={cn(
                          'p-1 rounded-md text-[#6B7280] hover:bg-white hover:text-[#3C5A87] transition-opacity',
                          r.pinnedAt || activeContactId === r.id
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        )}
                      >
                        {r.pinnedAt
                          ? <PinOff style={{ width: 12, height: 12 }} />
                          : <Pin style={{ width: 12, height: 12 }} />}
                      </button>
                      <button
                        type="button"
                        data-testid={`inbox-archive-${r.id}`}
                        title={r.archivedAt ? 'Put back in the inbox' : 'Archive'}
                        aria-label={r.archivedAt ? 'Restore conversation to the inbox' : 'Archive conversation'}
                        onClick={(e) => { e.stopPropagation(); void onArchive(r.id, !!r.archivedAt); }}
                        className={cn(
                          'p-1 rounded-md text-[#6B7280] hover:bg-white hover:text-[#3C5A87] transition-opacity',
                          r.archivedAt || activeContactId === r.id
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                        )}
                      >
                        {r.archivedAt
                          ? <ArchiveRestore style={{ width: 12, height: 12 }} />
                          : <Archive style={{ width: 12, height: 12 }} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          }),
          ])}
          {decoratedRows.length === 0
            && !((filter === 'calls' || filter === 'voicemail' || filter === 'missed') ? callsLoading : threadsLoading)
            && (
            <div className="px-4 py-10 text-center text-[12px] text-[#9CA3AF]">
              {filter === 'calls' ? 'No calls yet.'
                : filter === 'voicemail' ? 'No voicemails yet.'
                : filter === 'missed' ? 'No missed calls yet.'
                : filter === 'unread' ? 'Nothing unread. Every reply has been answered.'
                : filter === 'drafts' ? 'No AI replies waiting for approval.'
                : filter === 'onboarded' ? 'No fully onboarded creators here yet.'
                : filter === 'archived' ? 'Nothing archived.'
                : searchQuery.trim() ? 'No matches.'
                : EMPTY_CHANNEL_LABEL[filter] ? `No ${EMPTY_CHANNEL_LABEL[filter]} conversations here yet.`
                : 'No conversations yet.'}
              {/* Hugo 2026-08-03: he filtered WA while impersonating Maria and
                  got a bare "No conversations yet", which read as broken. The
                  view WAS the reason: say so, and undo it in one click. */}
              {isAdmin && viewAsId && (
                <div data-testid="inbox-empty-viewas-hint" className="mt-2 text-[11.5px] text-[#B45309]">
                  <div>You are seeing only {viewAsName || 'this agent'}&apos;s leads.</div>
                  <button
                    type="button"
                    data-testid="inbox-empty-viewas-reset"
                    onClick={() => setViewAs(null, null)}
                    className="mt-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-[8px] bg-[#3C5A87] text-white hover:bg-[#3C5A87]/90"
                  >
                    Show everyone&apos;s leads
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Pane 2 — thread (or a placeholder when nothing is selected) */}
      <section className="flex-1 bg-[#F3F3EE]/30 flex flex-col min-w-0">
        {!activeContact ? (
          <div className="flex-1 flex items-center justify-center p-12 text-center text-[#9CA3AF]">
            <div className="max-w-[300px]">
              <p className="text-[15px] font-semibold text-[#6B7280]">Pick a conversation on the left</p>
              <p className="text-[12.5px] mt-1.5 leading-relaxed">No messages yet? Your calls are under the <b>Calls</b> filter — or start a new conversation from the dialer or Contacts.</p>
            </div>
          </div>
        ) : (
        <>
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
            {/* Same rule as the cards: a creator has no business and no
                website, so the gap markers are noise on them and information
                on everybody else. */}
            <LeadIdentity
              isProperty={isPropertyLead(activeContact.customFields, !!activeDeal)}
              person={askForName(activeContact.customFields, activeDeal?.branch_contact_name)}
              owner={activeContact.customFields?.owner_name}
              website={activeContact.customFields?.website}
              layout="stack"
              size="sm"
              isCreatorLead={activeIsCreatorLead}
            />
            <div className="text-[11px] text-[#6B7280] tabular-nums">
              {activeContact.phone}
            </div>
            {/* THE DEAL, in the inbox. Hugo, 2026-08-14: "make sure information
                we have on the card on the pipeline also accessible in the
                inbox." The same links and the same instruction the board shows,
                drawn by the same two components so they cannot drift. */}
            {activeDeal && (
              <div className="mt-1 space-y-1">
                <PropertyLinkChips links={[activeDeal]} />
                <BriefLine brief={activeDeal.brief} pinnedNote={activeDeal.pinned_note} />
              </div>
            )}
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
                mediaCount: number;
                status?: string;
                aiGenerated?: boolean;
              };
              const ch = (m.channel || 'sms') as ChannelKindUI;
              const subj = m.subject ?? null;
              const isDraft = m.status === 'draft';
              return (
                <div
                  key={`sms-${m.id}`}
                  className={cn(
                    'rounded-2xl px-3 py-2 text-[13px] leading-snug',
                    // Email is the one channel people write paragraphs in, so
                    // it gets the room. 60% is right for a text message and
                    // squeezes an agency reply into a column.
                    ch === 'email' ? 'max-w-[85%]' : 'max-w-[60%]',
                    isDraft
                      ? 'bg-[#EEF2F8] border border-dashed border-[#3C5A87] text-[#1A1A1A] ml-auto'
                      : m.direction === 'outbound'
                        ? 'bg-[#3C5A87]/15 text-[#1A1A1A] ml-auto'
                        : 'bg-white border border-[#E5E7EB] text-[#1A1A1A]'
                  )}
                >
                  {isDraft && (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-[#3C5A87] uppercase tracking-wide mb-1">
                      <Bot className="w-3 h-3" /> AI draft
                    </div>
                  )}
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
                  {/* Was a bare {m.body}. With no whitespace rule the browser
                      collapsed every newline, so a paragraphed email rendered
                      as one unbroken wall of text. */}
                  <MessageBody
                    body={m.body}
                    tone={m.direction === 'outbound' && !isDraft ? 'dark' : 'light'}
                  />
                  {/* What the LEAD sent us. Kept apart from attachmentUrl below,
                      which is the brochure WE attach. Before 2026-08-03 an
                      image-only message drew a bubble with nothing in it. */}
                  {m.mediaCount > 0 && (
                    <InboundMedia
                      messageId={m.id}
                      count={m.mediaCount}
                      tone={m.direction === 'outbound' || isDraft ? 'dark' : 'light'}
                    />
                  )}
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
                  <div className="text-[10px] text-[#9CA3AF] mt-0.5 tabular-nums flex items-center gap-1">
                    {formatTimeOnly(m.sentAt)}
                    {/* Hugo 2026-08-02: "make sure everything is sent". One
                        honest tick per outbound message. The status webhook
                        rarely writes back (believe Twilio, not the CRM row),
                        so most messages show a single grey "sent" tick;
                        double tick only on a confirmed delivered/read, red
                        only on a real failure. */}
                    {m.direction === 'outbound' && !isDraft && (() => {
                      const st = (m.status ?? '').toLowerCase();
                      if (st === 'failed' || st === 'undelivered') {
                        return (
                          <span
                            data-testid={`msg-status-${m.id}`}
                            title={`This message did not go through (${st})`}
                            className="inline-flex items-center gap-0.5 text-[#DC2626] font-semibold"
                          >
                            <AlertTriangle style={{ width: 10, height: 10 }} /> failed
                          </span>
                        );
                      }
                      if (st === 'delivered' || st === 'read') {
                        return (
                          <CheckCheck
                            data-testid={`msg-status-${m.id}`}
                            style={{ width: 12, height: 12 }}
                            className="text-[#3C5A87]"
                            aria-label={st === 'read' ? 'Read' : 'Delivered'}
                          />
                        );
                      }
                      return (
                        <Check
                          data-testid={`msg-status-${m.id}`}
                          style={{ width: 12, height: 12 }}
                          className="text-[#9CA3AF]"
                          aria-label="Sent"
                        />
                      );
                    })()}
                  </div>
                  {isDraft && (
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        disabled={draftBusy === m.id}
                        onClick={() => void draftAction(m.id, 'send')}
                        className="text-[11px] font-semibold text-white bg-[#3C5A87] disabled:opacity-40 px-2.5 py-1 rounded-lg hover:bg-[#3C5A87]/90"
                      >Send</button>
                      <button
                        disabled={draftBusy === m.id}
                        onClick={() => void draftAction(m.id, 'discard')}
                        className="text-[11px] font-semibold text-[#6B7280] bg-white border border-[#E5E7EB] disabled:opacity-40 px-2.5 py-1 rounded-lg hover:bg-[#F3F3EE]"
                      >Discard</button>
                    </div>
                  )}
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
            // MUST come before the activity fallthrough below: that branch
            // casts any unknown payload to ActivityEvent and would render an
            // empty chip with `undefined` as its title.
            // Website-funnel event. MUST sit before the activity fallthrough
            // for the same reason the video one does: that branch casts any
            // unknown payload to ActivityEvent and renders `undefined`.
            if (item.kind === 'site') {
              const e = item.payload as SiteEvent;
              return (
                <div
                  key={`site-${e.id}`}
                  data-testid="thread-site-event"
                  className="mx-auto max-w-[80%] px-3 py-1.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-[11px] text-[#166534] flex items-center gap-2"
                >
                  <Globe className="w-3 h-3 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold">{e.label}</span>
                  </div>
                  <span
                    className="text-[10px] text-[#9CA3AF] tabular-nums flex-shrink-0"
                    title={formatDateTime(e.ts)}
                  >
                    {formatTimeOnly(e.ts)}
                  </span>
                </div>
              );
            }
            if (item.kind === 'funnel') {
              const f = item.payload as FunnelEvent;
              return (
                <div
                  key={`fun-${f.id}`}
                  data-testid="thread-funnel-event"
                  className="mx-auto max-w-[80%] px-3 py-1.5 rounded-xl bg-[#EEF6FF] border border-[#BFDBFE] text-[11px] text-[#3C5A87] flex items-center gap-2"
                >
                  <Clapperboard className="w-3 h-3 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold">{f.label}</span>
                  </div>
                  <span
                    className="text-[10px] text-[#9CA3AF] tabular-nums flex-shrink-0"
                    title={formatDateTime(f.ts)}
                  >
                    {formatTimeOnly(f.ts)}
                  </span>
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
            {replyChannel !== null && allTemplates.length > 0 && (
              <select
                value={selectedTemplateId}
                onChange={(e) => applyTemplate(e.target.value)}
                disabled={sending}
                data-testid="inbox-reply-template"
                className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded-[8px] disabled:opacity-60 max-w-[200px]"
                title="Insert a template"
              >
                <option value="">Templates ({allTemplates.length})…</option>
                {allTemplates.map((t) => (
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
          {/* WhatsApp only: the 24 hour rule and the way through it.
              Outside the window a free-form message is accepted by Twilio and
              killed later (63016), so saying it here beats a failed send. */}
          {replyChannel === 'whatsapp' && (
            <div className="flex flex-col gap-1.5" data-testid="inbox-wa-template-zone">
              {!waOpen && (
                <div
                  data-testid="inbox-wa-window-closed"
                  className="text-[11px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-2.5 py-1.5"
                >
                  This lead has not messaged in 24 hours, so WhatsApp will not deliver a normal
                  reply.{' '}
                  {metaTemplates.length > 0
                    ? 'Send an approved template instead.'
                    : 'You need a Meta approved template (Templates, WhatsApp tab).'}
                </div>
              )}
              {metaTemplates.length > 0 && (
                <div className="flex items-center gap-2">
                  <select
                    value={metaTplSid}
                    onChange={(e) => chooseMetaTemplate(e.target.value)}
                    disabled={sending}
                    data-testid="inbox-wa-meta-template"
                    className="px-2 py-1 text-[11px] bg-white border border-[#E5E7EB] rounded-[8px] disabled:opacity-60 max-w-[280px]"
                    title="Approved templates can be sent at any time"
                  >
                    <option value="">Approved template (works outside 24h)</option>
                    {metaTemplates.map((t) => (
                      <option key={t.sid} value={t.sid}>{t.name}</option>
                    ))}
                  </select>
                  {activeMetaTemplate && (
                    <button
                      type="button"
                      onClick={() => chooseMetaTemplate('')}
                      className="text-[11px] text-[#6B7280] hover:text-[#1A1A1A]"
                    >
                      Back to typing
                    </button>
                  )}
                </div>
              )}
              {activeMetaTemplate && (
                <div className="border border-[#E5E7EB] rounded-[10px] p-2.5 bg-[#F9FAFB] flex flex-col gap-2">
                  {Object.keys(metaVars).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(metaVars).sort((a, b) => Number(a) - Number(b)).map((n) => (
                        <label key={n} className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                          {`{{${n}}}`}
                          <input
                            value={metaVars[n]}
                            onChange={(e) => setMetaVars((v) => ({ ...v, [n]: e.target.value }))}
                            data-testid={`inbox-wa-var-${n}`}
                            className="px-2 py-1 text-[12px] bg-white border border-[#E5E7EB] rounded-[6px] w-[120px]"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <div
                    data-testid="inbox-wa-template-preview"
                    className="text-[13px] text-[#1A1A1A] whitespace-pre-wrap bg-white border border-[#E5E7EB] rounded-[8px] px-3 py-2"
                  >
                    {renderTemplate(activeMetaTemplate.body, metaVars)}
                  </div>
                  <div className="text-[10px] text-[#9CA3AF]">
                    Fixed wording approved by Meta. Costs about 4p to send, unlike a normal reply.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Attach an image/file to the reply. UK numbers can't MMS, so
              wk-sms-send appends the link to the body text instead (see its
              own comment on attachment_url) — this button just has to get a
              public URL onto replyAttachmentUrl, same as ContactSmsModal's
              composer, the only other place this already existed. */}
          {/* Hidden entirely in template mode: a template is fixed wording
              with no room for a file, so offering the paperclip would only
              stage something that gets dropped. */}
          {activeMetaTemplate ? null : replyAttachmentUrl ? (
            <div className="flex items-center gap-1 text-[11px] text-[#3C5A87] bg-[#EEF2F8] px-2 py-1 rounded-lg w-fit">
              <Paperclip className="w-3 h-3" />
              <a href={replyAttachmentUrl} target="_blank" rel="noopener noreferrer" className="truncate max-w-[300px] hover:underline">
                {replyAttachmentUrl.split('/').pop()}
              </a>
              <button onClick={() => setReplyAttachmentUrl(null)} className="ml-1 text-[#9CA3AF] hover:text-[#EF4444]">&times;</button>
            </div>
          ) : (
            replyChannel && (
              <label className="inline-flex items-center gap-1 w-fit px-2 py-1 text-[11px] text-[#6B7280] hover:text-[#3C5A87] hover:bg-[#EEF2F8] border border-[#E5E7EB] rounded-lg cursor-pointer transition-colors">
                {attachmentUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                {attachmentUploading ? 'Uploading…' : 'Attach image'}
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  data-testid="inbox-reply-attach-input"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 10 * 1024 * 1024) {
                      pushToast('File too large (max 10MB)', 'error');
                      e.target.value = '';
                      return;
                    }
                    setAttachmentUploading(true);
                    try {
                      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                      const { error: upErr } = await supabase.storage
                        .from('crm-attachments')
                        .upload(path, file, { upsert: true });
                      if (upErr) throw upErr;
                      const { data: urlData } = supabase.storage
                        .from('crm-attachments')
                        .getPublicUrl(path);
                      setReplyAttachmentUrl(urlData.publicUrl);
                    } catch (err) {
                      pushToast(`Upload failed: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
                    } finally {
                      setAttachmentUploading(false);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            )
          )}
          <div className="flex gap-2">
            {/* With a template chosen there is nothing to type: the preview
                above IS the message. */}
            {activeMetaTemplate ? (
              <div className="flex-1 px-3 py-2 text-[12px] text-[#6B7280] bg-[#F3F3EE] rounded-[10px]">
                Sending the template shown above.
              </div>
            ) : (
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={
                  replyChannel === null
                    ? 'Pick a channel above to start typing'
                    : replyChannel === 'whatsapp'
                      ? 'Type a WhatsApp reply'
                      : replyChannel === 'email'
                        ? 'Type the email body'
                        : 'Type a reply'
                }
                disabled={sending}
                data-testid="inbox-reply-body"
                className="flex-1 px-3 py-2 text-[13px] bg-[#F3F3EE] border-0 rounded-[10px] focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30 disabled:opacity-60"
              />
            )}
            <button
              type="submit"
              disabled={
                sending ||
                !replyChannel ||
                (activeMetaTemplate
                  ? Object.values(metaVars).some((v) => !v.trim())
                  : !reply.trim()) ||
                (replyChannel === 'email' && !replySubject.trim())
              }
              data-testid="inbox-reply-send"
              title={!replyChannel ? 'Pick SMS, WhatsApp or Email first' : undefined}
              className="flex items-center gap-1.5 bg-[#3C5A87] text-white text-[13px] font-semibold px-4 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              {sending ? 'Sending' : activeMetaTemplate ? 'Send template' : 'Send'}
            </button>
          </div>
        </form>
        </>
        )}
      </section>

      {/* Pane 3, the lead's journey (only with a selected conversation).
          Replaced the old "Contact timeline", which listed activity rows and,
          for a WhatsApp creator lead, had nothing at all to list. */}
      {activeContact && (
      <aside className="w-[320px] bg-white border-l border-[#E5E7EB] flex flex-col overflow-hidden">
        <JourneyPanel
          contactName={activeContact.name}
          contactPhone={activeContact.phone}
          journey={activeJourney}
          journeyStatus={journeyStatus}
          chase={chaseByContact.get(activeContact.id) ?? null}
          isCreatorLead={activeIsCreatorLead}
          messages={contactSms.map((m) => ({
            id: m.id,
            direction: m.direction,
            body: m.body,
            sentAt: m.sentAt,
            status: 'status' in m ? (m.status as string | undefined) : undefined,
          }))}
          funnel={timeline.funnel}
        />
      </aside>
      )}
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
