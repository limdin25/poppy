// ContactSmsModal — quick-send dialog from anywhere a contact is listed.
// Originally SMS-only; PR 63 (multi-channel PR 4) adds a channel picker
// so the same modal sends SMS / WhatsApp / Email. The file name stays
// ContactSmsModal for back-compat with the four call-sites that import
// it; the displayed title changes per channel.
//
// Channels:
//   sms       → POST sms-send (legacy fn, takes { to, body })
//   whatsapp  → POST unipile-send (PR 61, takes { contact_id, body })
//   email     → POST wk-email-send (PR 62, takes { contact_id, subject, body })
//
// Per-channel rules:
//   sms / whatsapp — contact.phone required
//   email          — contact.email required + subject required
//
// Templates filter:
//   Show templates where channel IS NULL (universal) OR channel matches
//   the selected channel. Channel-specific templates are filtered in;
//   universal templates show in every channel.
//
// Hugo 2026-04-30 stage-coupling note: when an SMS template carries a
// move_to_stage_id, sending advances the contact's pipeline column.
// Same behaviour applies for WhatsApp + Email templates.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, MessageSquare, X, Check, ArrowRight, Phone, Mail, Paperclip, Trash2, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import type { NextStepBrief } from '../../../../../api/lib/next-step-brief';
import type { BranchEmail } from '../../../../../api/lib/branch-email-match';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useContactPersistence } from '../../hooks/useContactPersistence';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import FollowupPromptModal from '../followups/FollowupPromptModal';
import type { Contact } from '../../types';

type Channel = 'sms' | 'whatsapp' | 'email';

interface EmailFromRow {
  id: string;
  e164: string; // email address stored in e164 column for email rows
}

interface FromsTable {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, val: string) => {
        eq: (
          col: string,
          val: string | boolean
        ) => {
          order: (
            col: string,
            opts: { ascending: boolean }
          ) => Promise<{ data: EmailFromRow[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
}

interface Template {
  id: string;
  name: string;
  body_md: string;
  move_to_stage_id: string | null;
  channel: Channel | null;
  /** PR 90: email subject (also on universal templates so they can
   *  carry through to email mode). NULL for sms/whatsapp. */
  subject: string | null;
  attachment_url: string | null;
}

interface SendInvoke {
  invoke: (
    name: string,
    options: { body: Record<string, unknown> }
  ) => Promise<{
    data: { sid?: string; error?: string; external_id?: string; message_id?: string } | null;
    error: { message: string } | null;
  }>;
}

interface TemplatesTable {
  from: (t: string) => {
    select: (c: string) => {
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => Promise<{ data: Template[] | null; error: { message: string } | null }>;
    };
  };
}

interface ContactByEmailTable {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        maybeSingle: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
  };
}

interface Props {
  contact: Contact | null;
  onClose: () => void;
  agentFirstName?: string;
  /** PR 83: caller can pre-select the channel so e.g. clicking the
   *  "WhatsApp" icon on the contacts list opens the modal already
   *  pinned to WhatsApp instead of forcing a re-pick. */
  defaultChannel?: Channel | null;
  /** THE DEAL BEHIND THIS CARD, on the boards that have one.
   *
   *  Hugo, 2026-08-14: "when we have to email the prospects I want the AI to
   *  draft it, I don't want a static template. The prospect that's expecting
   *  the approval of funds, the email should be there ready to go."
   *
   *  With this present the email channel writes itself from the next-step
   *  brief the moment it opens, and attaches the proof of funds when that is
   *  what the deal is waiting on. Absent everywhere else, so the eight other
   *  call sites are byte-identical. */
  deal?: EmailDeal | null;
}

export interface EmailDeal {
  brief?: NextStepBrief | null;
  pinnedNote?: string | null;
  address?: string | null;
  bedrooms?: number | null;
  propertyType?: string | null;
  /** The branch, and the person we ask for. */
  agencyName?: string | null;
  agentPersonName?: string | null;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

/** Does this deal hang on us proving we have the money?
 *
 *  Matched on the brief's own words rather than guessed, so the statement is
 *  never attached to a branch that did not ask for it. A bank statement is not
 *  something to send speculatively. */
export function needsProofOfFunds(deal?: EmailDeal | null): boolean {
  const text = [
    ...(deal?.brief?.blockers ?? []),
    ...(deal?.brief?.do_now ?? []),
    deal?.pinnedNote ?? '',
  ].join(' ');
  return /proof of fund|pof\b|evidence of fund|proof of cash/i.test(text);
}

export default function ContactSmsModal({
  contact,
  onClose,
  agentFirstName,
  defaultChannel = null,
  deal = null,
}: Props) {
  const { pushToast, columns, patchContact } = useSmsV2();
  const persist = useContactPersistence();
  // PR 80 safety: channel starts UNSELECTED — agent must consciously pick
  // SMS / WhatsApp / Email before send. Prevents accidentally messaging
  // on the wrong channel.
  // PR 83: when the parent passes a defaultChannel (e.g. clicking the
  // WhatsApp icon on a contact row), open with that channel pre-selected.
  const [channel, setChannel] = useState<Channel | null>(defaultChannel);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [emailFroms, setEmailFroms] = useState<EmailFromRow[]>([]);
  const [selectedFromId, setSelectedFromId] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  // WHO IT GOES TO, typed. Hugo, 2026-08-14, clicking Email on a live property
  // deal: "it says contact has no email, but it doesn't have where for me to
  // type the email, which is no good." A branch we have never emailed is the
  // normal state of a new deal, so the missing address is a field to fill in,
  // not a wall. wk-email-send already takes a typed recipient (two branches of
  // one agency share an inbox and wk_contacts has a unique index on email), and
  // the address is written back onto the lead only AFTER it has gone.
  const [toEmail, setToEmail] = useState('');
  /** Addresses the system already holds for this branch, with the evidence for
   *  each. Hugo: "the system has the email, so the system should just add the
   *  email there." It fills the box; the reason is shown so he can judge it. */
  const [known, setKnown] = useState<BranchEmail[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  /** What the attachment is CALLED. A signed url ends in ?token=..., so the
   *  filename can no longer be read off the end of the link. */
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  // Once he types, nothing overwrites him. A draft can land seconds after he
  // has started editing, and losing what somebody typed is worse than not
  // drafting at all. Same rule as the dialer's Email pane.
  const touched = useRef(false);
  const drafted = useRef(false);
  const [sending, setSending] = useState(false);
  const [loadingTpls, setLoadingTpls] = useState(true);
  const [recentSendCount, setRecentSendCount] = useState(0);
  const [showSentBanner, setShowSentBanner] = useState(false);
  // PR 105: capture the channel label at send-time so the post-send banner
  // still reads correctly after we reset `channel` to null (forces re-pick).
  const [bannerLabel, setBannerLabel] = useState<string>('');
  // PR 107 (Hugo 2026-04-28): prompt for a follow-up after every send.
  const [followupTarget, setFollowupTarget] = useState<{
    contactId: string;
    contactName: string;
    columnId: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as TemplatesTable)
          .from('wk_sms_templates')
          .select('id, name, body_md, move_to_stage_id, channel, subject, attachment_url')
          .order('name', { ascending: true });
        if (!cancelled && data) setTemplates(data);
      } catch {
        // RLS / missing column — render with no templates.
      } finally {
        if (!cancelled) setLoadingTpls(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load active email "from" addresses (Elijah@, Georgia@, ...).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as FromsTable)
          .from('wk_numbers')
          .select('id, e164')
          .eq('channel', 'email')
          .eq('is_active', true)
          .order('e164', { ascending: true });
        if (!cancelled && data) setEmailFroms(data);
      } catch {
        // RLS / table not yet seeded — picker just hides the select.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset state when modal opens for a different contact OR channel changes.
  // PR 83: re-apply defaultChannel each time the modal opens, since the
  // parent may pass a different channel per click (WhatsApp icon vs Email icon).
  useEffect(() => {
    if (contact) {
      setSelectedTemplateId('');
      setBody('');
      setSubject('');
      setToEmail(contact.email ?? '');
      setRecentSendCount(0);
      setShowSentBanner(false);
      setChannel(defaultChannel);
    }
  }, [contact, defaultChannel]);

  useEffect(() => {
    setSelectedTemplateId('');
    setBody('');
    if (channel !== 'email') setSubject('');
  }, [channel]);

  // THE EMAIL WRITES ITSELF. Hugo: "I don't want a static template, I want the
  // AI brain to always draft it."
  //
  // Written from the next-step BRIEF, not from a transcript: by the time a card
  // is being emailed off the board the call is days old, and what matters is
  // the one thing the deal is waiting on. Every figure in the brief was read
  // from the deal engine when it was written, so nothing is re-derived here.
  const draft = useCallback(async () => {
    if (!deal || drafting) return;
    setDrafting(true);
    setDraftNote(null);
    try {
      const res = await fetch('/api/crm/draft-offer-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'follow_up',
          house: {
            address: deal.address ?? null,
            askingPrice: deal.brief?.asking ?? null,
            offerPrice: deal.brief?.offer ?? null,
            beds: deal.bedrooms ?? null,
            propertyType: deal.propertyType ?? null,
          },
          context: {
            doNow: deal.brief?.do_now ?? null,
            blockers: deal.brief?.blockers ?? null,
            pinnedNote: deal.pinnedNote ?? null,
            step: deal.brief?.step ?? null,
          },
          agentName: deal.agentPersonName ?? null,
          agencyName: deal.agencyName ?? contact?.name ?? null,
          fromName: agentFirstName ?? 'Hugo',
          companyName: 'Unico',
        }),
      });
      const json = await res.json() as { subject?: string; body?: string; error?: string };
      if (!res.ok || json.error) {
        setDraftNote(json.error ?? 'Could not write it. Type the email yourself.');
        return;
      }
      if (touched.current) {
        setDraftNote('Draft ready, but you had started typing so it was left alone.');
        return;
      }
      if (json.subject) setSubject(json.subject);
      if (json.body) setBody(json.body);
      setDraftNote('Written by the brain from this deal. Read it before you send it.');
    } catch {
      setDraftNote('Could not reach the writer. Type the email yourself.');
    } finally {
      setDrafting(false);
    }
  }, [deal, drafting, contact?.name, agentFirstName]);

  // THE PROOF OF FUNDS, already attached. Hugo: "when our brain generates the
  // email the proof of funds is already attached and we just confirm everything
  // is okay and send it."
  //
  // Only when the deal actually asked for it. The document carries account
  // numbers and sort codes, so it is never attached speculatively, and the link
  // is a signed one that dies in an hour (api/crm/proof-of-funds.ts).
  const attachProof = useCallback(async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/crm/proof-of-funds', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json() as {
        available?: boolean; url?: string; filename?: string; reason?: string;
      };
      if (!json.available || !json.url) {
        setDraftNote((n) => n ?? (json.reason ?? 'No proof of funds on file to attach.'));
        return;
      }
      setAttachmentUrl(json.url);
      setAttachmentName(json.filename ?? 'Proof of funds.pdf');
    } catch {
      setDraftNote((n) => n ?? 'The proof of funds could not be attached. Attach it by hand.');
    }
  }, []);

  // THE ADDRESS WE ALREADY HOLD. An inbound email makes its own contact keyed
  // on the address, so the branch card never sees the reply the branch sent us.
  // Hugo, on being told to paste it by hand: "why do I need to paste the
  // address? The system has the email." Quite right.
  //
  // Only when the lead has none of its own: a saved address is a decision
  // somebody already made and it is never overridden by a lookup.
  const findKnownEmail = useCallback(async () => {
    if (!deal || (contact?.email ?? '').trim()) return;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/crm/branch-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ street: deal.address ?? null, agency: deal.agencyName ?? contact?.name ?? null }),
      });
      const json = await res.json() as { emails?: BranchEmail[] };
      const list = json.emails ?? [];
      if (!list.length) return;
      setKnown(list);
      // Never over a human. If he has already typed one, his wins.
      setToEmail((cur) => (cur.trim() ? cur : list[0].email));
    } catch {
      // No lookup is the state we were already in: he types it.
    }
  }, [deal, contact?.email, contact?.name]);

  // All three, the moment the email channel opens on a deal. One press for
  // Hugo: read it, then send.
  useEffect(() => {
    if (channel !== 'email' || !deal || drafted.current) return;
    drafted.current = true;
    void draft();
    void findKnownEmail();
    if (needsProofOfFunds(deal)) void attachProof();
  }, [channel, deal, draft, attachProof, findKnownEmail]);

  // A different lead is a different email.
  useEffect(() => {
    touched.current = false;
    drafted.current = false;
    setDraftNote(null);
    setAttachmentName(null);
    setKnown([]);
  }, [contact?.id]);

  const firstName = useMemo(
    () => (contact?.name ?? '').trim().split(/\s+/)[0] ?? '',
    [contact]
  );

  // Templates visible for the current channel: universal (channel=null) +
  // channel-specific (channel === current).
  const filteredTemplates = useMemo(
    () => templates.filter((t) => t.channel == null || t.channel === channel),
    [templates, channel]
  );

  const selectedTemplate = useMemo(
    () => filteredTemplates.find((t) => t.id === selectedTemplateId) ?? null,
    [filteredTemplates, selectedTemplateId]
  );

  const targetStage = useMemo(() => {
    if (!selectedTemplate?.move_to_stage_id) return null;
    return columns.find((c) => c.id === selectedTemplate.move_to_stage_id) ?? null;
  }, [selectedTemplate, columns]);

  const applyTemplate = (id: string) => {
    setSelectedTemplateId(id);
    if (!id) {
      setBody('');
      return;
    }
    const tpl = filteredTemplates.find((t) => t.id === id);
    if (!tpl) return;
    const expanded = interpolateTemplate(tpl.body_md, {
      firstName,
      agentFirstName,
    });
    setBody(expanded);
    // PR 90 (Hugo 2026-04-27): when applying a template on the email
    // channel, also fill the subject. Universal templates with a subject
    // carry through too.
    if (channel === 'email' && tpl.subject) {
      const expandedSubject = interpolateTemplate(tpl.subject, {
        firstName,
        agentFirstName,
      });
      setSubject(expandedSubject);
    }
    setAttachmentUrl(tpl.attachment_url ?? null);
    setShowSentBanner(false);
  };

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(toEmail.trim());

  // Channel-aware preflight checks. Email is deliberately NOT one of them any
  // more: a missing address is answered by the To field below, not by a wall.
  const channelDisabledReason = useMemo<string | null>(() => {
    if (!contact) return null;
    if (channel === 'sms' && !contact.phone) return 'Contact has no phone number';
    if (channel === 'whatsapp' && !contact.phone) {
      return 'Contact has no phone number for WhatsApp';
    }
    return null;
  }, [contact, channel]);

  const isSendDisabled =
    !body.trim() ||
    sending ||
    channel === null ||
    !!channelDisabledReason ||
    (channel === 'email' && (!subject.trim() || !emailValid));

  const send = async () => {
    if (!contact || isSendDisabled) return;
    if (!channel) {
      pushToast('Pick a channel first — SMS, WhatsApp or Email.', 'error');
      return;
    }
    setSending(true);
    try {
      const fn = supabase.functions as unknown as SendInvoke;
      const trimBody = body.trim();
      const trimSubject = subject.trim();

      // A reply already made its OWN contact keyed on the address (see
      // findKnownEmail above): inbound email never matches back to the
      // branch's phone-keyed card unless the domain literally matches the
      // trading name. Send anyway to that address and the message files
      // under THIS deal's contact.id, a row the lead's own Inbox thread
      // never reads from, so "sent" never shows up where Hugo is looking.
      // Route to the address's own contact when one already exists.
      let sendContactId = contact.id;
      let sendContactIsOther = false;
      if (channel === 'email') {
        const cleanTo = toEmail.trim().toLowerCase();
        if (cleanTo && cleanTo !== (contact.email ?? '').trim().toLowerCase()) {
          try {
            const { data: existing } = await (supabase as unknown as ContactByEmailTable)
              .from('wk_contacts')
              .select('id')
              .eq('email', cleanTo)
              .maybeSingle();
            if (existing && existing.id !== contact.id) {
              sendContactId = existing.id;
              sendContactIsOther = true;
            }
          } catch {
            // Lookup failed — fall back to filing under this deal's contact,
            // same as before this fix.
          }
        }
      }

      let resp: Awaited<ReturnType<SendInvoke['invoke']>>;
      if (channel === 'sms') {
        // PR 96 (Hugo 2026-04-28): was hitting legacy `sms-send` which
        // writes to the legacy `sms_messages` table. The inbox reads
        // wk_sms_messages, so SMS sent from this modal never appeared
        // in the thread until refresh \u2014 sometimes never. Routes through
        // wk-sms-send now (same as InboxPage + MidCallSmsSender).
        resp = await fn.invoke('wk-sms-send', {
          body: { contact_id: contact.id, body: trimBody, attachment_url: attachmentUrl || undefined },
        });
      } else if (channel === 'whatsapp') {
        // 2026-08-02: Twilio WhatsApp sender via wk-sms-send (channel param),
        // same as InboxPage. unipile-send is dead (key expired) and split the
        // thread across two senders.
        resp = await fn.invoke('wk-sms-send', {
          body: { contact_id: contact.id, body: trimBody, attachment_url: attachmentUrl || undefined, channel: 'whatsapp' },
        });
      } else {
        resp = await fn.invoke('wk-email-send', {
          body: {
            contact_id: sendContactId,
            to_email: toEmail.trim().toLowerCase(),
            subject: trimSubject,
            body: trimBody,
            channel_id: selectedFromId || undefined,
            attachment_url: attachmentUrl || undefined,
            attachment_name: attachmentName || undefined,
          },
        });
      }
      const { data, error } = resp;
      if (error || data?.error) {
        const detail = (data?.error as string | undefined) ?? error?.message ?? 'unknown';
        pushToast(`${CHANNEL_LABEL[channel]} send failed: ${detail}`, 'error');
        return;
      }
      pushToast(
        sendContactIsOther
          ? `Email sent — filed under ${toEmail.trim()}'s own Inbox thread, not this card`
          : `${CHANNEL_LABEL[channel]} sent`,
        'success'
      );

      // Remember the address, so next week's offer email does not need it
      // asking for again. AFTER the send and best effort ON PURPOSE: a unique
      // index clash with a sister branch sharing the inbox must never read back
      // as "your email did not send".
      if (channel === 'email' && !sendContactIsOther) {
        const clean = toEmail.trim().toLowerCase();
        if (clean && clean !== (contact.email ?? '').trim().toLowerCase()) {
          patchContact(contact.id, { email: clean });
          const saved = await persist.patchContact(contact.id, { email: clean });
          if (typeof saved === 'string') {
            pushToast(`Sent. The address was not saved to the lead: ${saved}`, 'error');
          }
        }
      }

      // Stage-coupled templates apply to all channels.
      if (selectedTemplate?.move_to_stage_id && targetStage && contact.id) {
        patchContact(contact.id, { pipelineColumnId: targetStage.id });
        try {
          await persist.moveToColumn(contact.id, targetStage.id);
          pushToast(`Moved to ${targetStage.name}`, 'success');
        } catch (e) {
          pushToast(
            `Stage move failed: ${e instanceof Error ? e.message : 'unknown'}`,
            'error'
          );
        }
      }

      setBody('');
      setAttachmentUrl(null);
      if (channel === 'email') setSubject('');
      setSelectedTemplateId('');
      setRecentSendCount((n) => n + 1);
      setBannerLabel(`${CHANNEL_LABEL[channel]} sent`);
      setShowSentBanner(true);
      // PR 105: force re-pick of channel after every successful send.
      setChannel(null);
      setTimeout(() => setShowSentBanner(false), 4000);
      // PR 107: prompt for a follow-up time. Stage-coupled templates may
      // have just moved the contact — prefer the new column if so.
      const followupColumnId = selectedTemplate?.move_to_stage_id ?? contact.pipelineColumnId;
      if (followupColumnId) {
        setFollowupTarget({
          contactId: contact.id,
          contactName: contact.name,
          columnId: followupColumnId,
        });
      }
    } catch (e) {
      pushToast(
        `${CHANNEL_LABEL[channel]} send crashed: ${e instanceof Error ? e.message : 'unknown'}`,
        'error'
      );
    } finally {
      setSending(false);
    }
  };

  if (!contact) return null;

  const length = body.length;
  const charLimit = channel === 'sms' ? 160 : channel === 'whatsapp' ? 4096 : 10000;
  const channelIcon =
    channel === 'email' ? Mail : channel === 'whatsapp' ? MessageSquare : Phone;
  const ChannelIcon = channelIcon;
  // Header label: when no channel picked, show generic "Message".
  const headerLabel = channel ? CHANNEL_LABEL[channel] : 'Message';
  const recipientLabel =
    channel === 'email' ? toEmail.trim() || 'type an address below' : contact.phone;

  // PR 107: lookup column for follow-up modal (read from store columns).
  const followupColumn = followupTarget
    ? columns.find((c) => c.id === followupTarget.columnId)
    : null;
  const followupSuggestedHours = (() => {
    const lc = followupColumn?.name.toLowerCase();
    if (lc === 'callback') return 2;
    if (lc === 'interested') return 24;
    return 24 * 3;
  })();

  return (
    <>
    <div
      className="fixed inset-0 z-[300] bg-black/40 flex items-center justify-center p-6"
      onClick={onClose}
      data-testid="contact-sms-modal"
    >
      <div
        className="bg-white rounded-2xl border border-[#E5E7EB] shadow-2xl w-full max-w-[560px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChannelIcon className="w-4 h-4 text-[#3C5A87]" />
            <h2 className="text-[14px] font-semibold text-[#1A1A1A]">
              {headerLabel} to {firstName || contact.name}
            </h2>
            <span className="text-[11px] text-[#9CA3AF] tabular-nums ml-1">
              {recipientLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#F3F3EE] text-[#6B7280] hover:text-[#1A1A1A]"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          {/* Channel picker — segmented radio. PR 80: starts UNSELECTED so
              the agent must pick consciously. Amber border when no
              channel chosen so it's visually obvious. */}
          <div className="flex items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Channel"
              className={cn(
                'inline-flex p-0.5 bg-[#F3F3EE] rounded-[10px] gap-0.5 border',
                channel === null
                  ? 'border-[#F59E0B] ring-1 ring-[#F59E0B]/30'
                  : 'border-[#E5E5E5]'
              )}
              data-testid="contact-sms-modal-channel-picker"
            >
              {(['sms', 'whatsapp', 'email'] as const).map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={channel === c}
                  onClick={() => setChannel(c)}
                  className={cn(
                    'px-3 py-1 text-[12px] font-medium rounded-[8px] transition-colors',
                    channel === c
                      ? 'bg-white text-[#3C5A87] shadow-sm'
                      : 'text-[#6B7280] hover:text-[#1A1A1A]'
                  )}
                  data-testid={`channel-radio-${c}`}
                  type="button"
                >
                  {CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
            {channel === null && (
              <span className="text-[10px] font-semibold text-[#B45309] uppercase tracking-wide">
                Pick one
              </span>
            )}
          </div>

          {channelDisabledReason && (
            <div
              className="text-[12px] text-[#F59E0B] bg-[#FEF3C7] border border-[#F59E0B]/30 rounded-[10px] px-3 py-2"
              role="alert"
            >
              {channelDisabledReason}
            </div>
          )}

          {showSentBanner && (
            <div
              className="flex items-center gap-2 bg-[#EEF2F8] border border-[#3C5A87]/40 rounded-[10px] px-3 py-2 text-[12px] text-[#3C5A87]"
              role="status"
            >
              <Check className="w-4 h-4" />
              <span>
                {bannerLabel}
                {recentSendCount > 1 ? ` · ${recentSendCount} this session` : ''}
              </span>
            </div>
          )}

          <select
            value={selectedTemplateId}
            onChange={(e) => applyTemplate(e.target.value)}
            disabled={loadingTpls || filteredTemplates.length === 0}
            className="w-full px-2 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[10px] bg-white disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]"
          >
            <option value="">
              {loadingTpls
                ? 'Loading templates…'
                : filteredTemplates.length === 0
                  ? `No ${headerLabel} templates yet`
                  : 'Insert template…'}
            </option>
            {filteredTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.move_to_stage_id ? ' →' : ''}
                {t.channel ? ` · ${CHANNEL_LABEL[t.channel]}` : ''}
              </option>
            ))}
          </select>
          {targetStage && (
            <div className="flex items-center gap-1 text-[11px] text-[#3C5A87] bg-[#EEF2F8] px-2 py-1 rounded-[6px]">
              <ArrowRight className="w-3 h-3" />
              <span>
                Send will move contact to:{' '}
                <span className="font-semibold">{targetStage.name}</span>
              </span>
            </div>
          )}

          {channel === 'email' && emailFroms.length > 0 && (
            <select
              value={selectedFromId}
              onChange={(e) => setSelectedFromId(e.target.value)}
              className="w-full px-2 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[10px] bg-white"
              data-testid="contact-sms-modal-from"
            >
              <option value="">From: (default)</option>
              {emailFroms.map((f) => (
                <option key={f.id} value={f.id}>
                  From: {f.e164}
                </option>
              ))}
            </select>
          )}

          {/* The brain wrote it. Hugo reads it and presses send, or asks for
              another one. Only on a card that carries a deal; every other
              email in this modal is untouched. */}
          {channel === 'email' && deal && (
            <div
              className="flex items-center gap-2 rounded-[10px] border border-[#3C5A87]/25 bg-[#EEF2F8] px-3 py-2"
              data-testid="contact-sms-modal-draft"
            >
              <Sparkles className={cn('w-3.5 h-3.5 text-[#3C5A87]', drafting && 'animate-pulse')} />
              <span className="flex-1 text-[11px] leading-snug text-[#3C5A87]">
                {drafting
                  ? 'Writing this one from the deal...'
                  : draftNote ?? 'Written from this deal, not from a template.'}
              </span>
              <button
                type="button"
                onClick={() => { touched.current = false; void draft(); }}
                disabled={drafting}
                className="flex-shrink-0 rounded-[8px] border border-[#3C5A87]/30 bg-white px-2 py-1 text-[11px] font-semibold text-[#3C5A87] hover:bg-[#F5F8FC] disabled:opacity-50"
                data-testid="contact-sms-modal-rewrite"
              >
                Write it again
              </button>
            </div>
          )}

          {channel === 'email' && (
            <div>
              <input
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="To: their email address"
                type="email"
                spellCheck={false}
                autoCapitalize="off"
                className="w-full px-3 py-2 text-[13px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
                data-testid="contact-sms-modal-to"
              />
              {/* WHY that address is in the box. Never just filled in silently:
                  an offer emailed to the wrong branch is worse than one not
                  sent, so the evidence is on screen before he presses send. */}
              {known.length > 0 && (
                <div className="mt-1 space-y-1" data-testid="contact-sms-modal-known">
                  {known.map((k) => {
                    const picked = k.email === toEmail.trim().toLowerCase();
                    return (
                      <button
                        key={k.email}
                        type="button"
                        onClick={() => setToEmail(k.email)}
                        className={cn(
                          'w-full rounded-[8px] border px-2 py-1 text-left text-[11px] leading-snug',
                          picked
                            ? 'border-[#2E7D43]/40 bg-[#E8F5EC] text-[#2E7D43]'
                            : 'border-[#E5E5E5] bg-white text-[#6B7280] hover:bg-[#F9FAFB]',
                        )}
                      >
                        <span className="font-semibold">{k.email}</span>
                        <span className="block">{k.reason}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {!emailValid && known.length === 0 && (
                <div className="mt-1 text-[11px] text-[#6B7280]">
                  {contact.email
                    ? 'That does not look like an email address.'
                    : 'Nothing on file for this branch. Type theirs here, and it gets saved to the lead once the email has gone.'}
                </div>
              )}
            </div>
          )}

          {channel === 'email' && (
            <input
              value={subject}
              onChange={(e) => { touched.current = true; setSubject(e.target.value); }}
              placeholder="Email subject"
              className="w-full px-3 py-2 text-[13px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
              data-testid="contact-sms-modal-subject"
            />
          )}

          <textarea
            value={body}
            onChange={(e) => {
              touched.current = true;
              setBody(e.target.value);
              if (showSentBanner) setShowSentBanner(false);
            }}
            placeholder={
              channel === 'email'
                ? 'Type the email body…'
                : 'Type a message, or pick a template above.'
            }
            rows={channel === 'email' ? 8 : 5}
            className="w-full px-3 py-2 text-[13px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87] resize-none"
            data-testid="contact-sms-modal-body"
          />

          {/* Attachment upload / preview */}
          <div className="flex items-center gap-2">
            {attachmentUrl ? (
              <div
                className="flex items-center gap-2 px-2.5 py-1.5 bg-[#EEF2F8] border border-[#3C5A87]/20 rounded-lg text-[11px]"
                data-testid="contact-sms-modal-attachment"
              >
                {attachmentName ? (
                  <ShieldCheck className="w-3 h-3 text-[#2E7D43]" />
                ) : (
                  <Paperclip className="w-3 h-3 text-[#3C5A87]" />
                )}
                <a
                  href={attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open it and check it before you send"
                  className="text-[#3C5A87] font-medium truncate max-w-[260px]"
                >
                  {/* The signed link ends in ?token=..., so the label is the
                      name we were given, never the end of the URL. */}
                  {attachmentName ?? attachmentUrl.split('?')[0].split('/').pop()}
                </a>
                <button
                  onClick={() => { setAttachmentUrl(null); setAttachmentName(null); }}
                  className="text-[#6B7280] hover:text-red-500"
                  title="Take it off this email"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-[#6B7280] hover:text-[#3C5A87] hover:bg-[#EEF2F8] border border-[#E5E5E5] rounded-lg cursor-pointer transition-colors">
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
                {uploading ? 'Uploading…' : 'Attach file'}
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 10 * 1024 * 1024) {
                      pushToast('File too large (max 10MB)', 'error');
                      return;
                    }
                    setUploading(true);
                    try {
                      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                      const { error: upErr } = await supabase.storage
                        .from('crm-attachments')
                        .upload(path, file, { upsert: true });
                      if (upErr) throw upErr;
                      const { data: urlData } = supabase.storage
                        .from('crm-attachments')
                        .getPublicUrl(path);
                      setAttachmentUrl(urlData.publicUrl);
                    } catch (err) {
                      pushToast(`Upload failed: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
                    } finally {
                      setUploading(false);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span
              className={cn(
                'text-[10px] tabular-nums',
                length > charLimit ? 'text-[#F59E0B]' : 'text-[#9CA3AF]'
              )}
            >
              {length}/{charLimit}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="text-[12px] text-[#6B7280] px-3 py-1.5 rounded-[10px] hover:bg-[#F3F3EE]"
              >
                Done
              </button>
              <button
                onClick={() => void send()}
                disabled={isSendDisabled}
                className="bg-[#3C5A87] text-white text-[12px] font-semibold px-4 py-1.5 rounded-[10px] inline-flex items-center gap-1 hover:bg-[#3C5A87]/90 disabled:opacity-50"
                data-testid="contact-sms-modal-send"
              >
                <Send className="w-3 h-3" />
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    {followupTarget && (
      <FollowupPromptModal
        open
        onOpenChange={(o) => { if (!o) setFollowupTarget(null); }}
        contactId={followupTarget.contactId}
        contactName={followupTarget.contactName}
        columnId={followupTarget.columnId}
        columnName={followupColumn?.name ?? 'Stage'}
        suggestedHoursAhead={followupSuggestedHours}
        callId={null}
        onSaved={() => setFollowupTarget(null)}
      />
    )}
    </>
  );
}
