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

import { useEffect, useMemo, useState } from 'react';
import { Send, MessageSquare, X, Check, ArrowRight, Phone, Mail, Paperclip, Trash2, Loader2 } from 'lucide-react';
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

interface Props {
  contact: Contact | null;
  onClose: () => void;
  agentFirstName?: string;
  /** PR 83: caller can pre-select the channel so e.g. clicking the
   *  "WhatsApp" icon on the contacts list opens the modal already
   *  pinned to WhatsApp instead of forcing a re-pick. */
  defaultChannel?: Channel | null;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

export default function ContactSmsModal({
  contact,
  onClose,
  agentFirstName,
  defaultChannel = null,
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
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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

  // Channel-aware preflight checks.
  const channelDisabledReason = useMemo<string | null>(() => {
    if (!contact) return null;
    if (channel === 'sms' && !contact.phone) return 'Contact has no phone number';
    if (channel === 'whatsapp' && !contact.phone) {
      return 'Contact has no phone number for WhatsApp';
    }
    if (channel === 'email' && !contact.email) return 'Contact has no email address';
    return null;
  }, [contact, channel]);

  const isSendDisabled =
    !body.trim() ||
    sending ||
    channel === null ||
    !!channelDisabledReason ||
    (channel === 'email' && !subject.trim());

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
        resp = await fn.invoke('unipile-send', {
          body: { contact_id: contact.id, body: trimBody, attachment_url: attachmentUrl || undefined },
        });
      } else {
        resp = await fn.invoke('wk-email-send', {
          body: {
            contact_id: contact.id,
            subject: trimSubject,
            body: trimBody,
            channel_id: selectedFromId || undefined,
            attachment_url: attachmentUrl || undefined,
          },
        });
      }
      const { data, error } = resp;
      if (error || data?.error) {
        const detail = (data?.error as string | undefined) ?? error?.message ?? 'unknown';
        pushToast(`${CHANNEL_LABEL[channel]} send failed: ${detail}`, 'error');
        return;
      }
      pushToast(`${CHANNEL_LABEL[channel]} sent`, 'success');

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
    channel === 'email' ? contact.email ?? '(no email)' : contact.phone;

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
            <ChannelIcon className="w-4 h-4 text-[#1E9A80]" />
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
                      ? 'bg-white text-[#1E9A80] shadow-sm'
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
              className="flex items-center gap-2 bg-[#ECFDF5] border border-[#1E9A80]/40 rounded-[10px] px-3 py-2 text-[12px] text-[#1E9A80]"
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
            <div className="flex items-center gap-1 text-[11px] text-[#1E9A80] bg-[#ECFDF5] px-2 py-1 rounded-[6px]">
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

          {channel === 'email' && (
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
              className="w-full px-3 py-2 text-[13px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30 focus:border-[#1E9A80]"
              data-testid="contact-sms-modal-subject"
            />
          )}

          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (showSentBanner) setShowSentBanner(false);
            }}
            placeholder={
              channel === 'email'
                ? 'Type the email body…'
                : 'Type a message, or pick a template above.'
            }
            rows={channel === 'email' ? 8 : 5}
            className="w-full px-3 py-2 text-[13px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30 focus:border-[#1E9A80] resize-none"
            data-testid="contact-sms-modal-body"
          />

          {/* Attachment upload / preview */}
          <div className="flex items-center gap-2">
            {attachmentUrl ? (
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#ECFDF5] border border-[#1E9A80]/20 rounded-lg text-[11px]">
                <Paperclip className="w-3 h-3 text-[#1E9A80]" />
                <a href={attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-[#1E9A80] font-medium truncate max-w-[200px]">
                  {attachmentUrl.split('/').pop()}
                </a>
                <button onClick={() => setAttachmentUrl(null)} className="text-[#6B7280] hover:text-red-500">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-[#6B7280] hover:text-[#1E9A80] hover:bg-[#ECFDF5] border border-[#E5E5E5] rounded-lg cursor-pointer transition-colors">
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
                className="bg-[#1E9A80] text-white text-[12px] font-semibold px-4 py-1.5 rounded-[10px] inline-flex items-center gap-1 hover:bg-[#1E9A80]/90 disabled:opacity-50"
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
