// MidCallSmsSender — mid-call quick-send embedded in COL 1 of LiveCallScreen.
//
// History:
//   PR 16 (2026-04-26): mandatory stage picker before send.
//   PR 50/57 (2026-04-30): stage-coupled templates auto-pick the stage.
//   PR 63 (2026-04-27 / multi-channel PR 4): channel picker — agent
//     can mid-call switch from SMS to WhatsApp or Email so a "I'll
//     send you the details now" promise can land on whatever channel
//     fits best.
//
// File name stays MidCallSmsSender for back-compat with imports from
// LiveCallScreen.tsx; the displayed title changes per channel.

import { useEffect, useMemo, useState } from 'react';
import { Send, MessageSquare, ArrowRight, ArrowUp, Phone, Mail } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useContactPersistence } from '../../hooks/useContactPersistence';
import { interpolateTemplate } from '../../lib/interpolateTemplate';
import StageSelector from '../shared/StageSelector';
import FollowupPromptModal from '../followups/FollowupPromptModal';
import { useActiveCallCtx } from './ActiveCallContext';

type Channel = 'sms' | 'whatsapp' | 'email';

interface Template {
  id: string;
  name: string;
  body_md: string;
  move_to_stage_id: string | null;
  channel: Channel | null;
  /** PR 90: email subject (also stored on universal templates so a
   *  template can be sent on email later). NULL for sms/whatsapp. */
  subject: string | null;
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
  contactId: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  agentFirstName: string;
  /** PR 86: when set, send fns resolve from wk_campaign_numbers for
   *  this campaign (matching channel) before falling back to workspace
   *  default. Same precedence rule wk-dialer-start uses for voice. */
  campaignId?: string | null;
  /** Forwarded to the embedded StageSelector so the stage dropdown
   *  shows only this pipeline's columns instead of every workspace
   *  pipeline. Required for the dialer-pro mid-call surface; without
   *  it the dropdown flattens 16 columns from 2 pipelines into one. */
  pipelineId?: string | null;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

export default function MidCallSmsSender({
  contactId,
  contactName,
  contactPhone,
  contactEmail,
  agentFirstName,
  campaignId = null,
  pipelineId = null,
}: Props) {
  const { pushToast, columns, patchContact, contacts } = useSmsV2();
  const currentContact = contacts.find((c) => c.id === contactId);
  const persist = useContactPersistence();
  // PR 80 safety: channel starts UNSELECTED. Mid-call sender forces
  // an explicit channel pick before send to prevent accidental cross-
  // channel messages.
  const [channel, setChannel] = useState<Channel | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingTpls, setLoadingTpls] = useState(true);
  const [pickedStageId, setPickedStageId] = useState<string | null>(null);
  // PR 116 (Hugo 2026-04-28): show "From: …" above the send box so the
  // agent sees which line the message will go from. Reads the first
  // active wk_numbers row matching the picked channel. Doesn't try to
  // resolve campaign-pinned numbers client-side — the send fns do that
  // on the server; we just surface a sensible default for visibility.
  const [fromLine, setFromLine] = useState<string | null>(null);
  useEffect(() => {
    if (!channel) {
      setFromLine(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('wk_numbers' as any) as any)
        .select('e164, label')
        .eq('channel', channel)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const row = data as { e164?: string; label?: string | null } | null;
      if (row?.e164) {
        setFromLine(row.label ? `${row.e164} · ${row.label}` : row.e164);
      } else {
        setFromLine(null);
      }
    })();
    return () => { cancelled = true; };
  }, [channel]);
  // PR 107 (Hugo 2026-04-28): every successful send opens the follow-up
  // prompt so the agent always commits to a next-touch time.
  const [followupTarget, setFollowupTarget] = useState<{
    columnId: string;
  } | null>(null);
  const { call } = useActiveCallCtx();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as TemplatesTable)
          .from('wk_sms_templates')
          .select('id, name, body_md, move_to_stage_id, channel, subject')
          .order('name', { ascending: true });
        if (!cancelled && data) setTemplates(data);
      } catch {
        // RLS or table missing — show no templates, free-text still works.
      } finally {
        if (!cancelled) setLoadingTpls(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = useMemo(
    () => contactName.trim().split(/\s+/)[0] ?? '',
    [contactName]
  );

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
    // PR 90 (Hugo 2026-04-27): when applying on email channel, also
    // fill the subject from the template (interpolated).
    if (channel === 'email' && tpl.subject) {
      const expandedSubject = interpolateTemplate(tpl.subject, {
        firstName,
        agentFirstName,
      });
      setSubject(expandedSubject);
    }
    if (tpl.move_to_stage_id) {
      setPickedStageId(tpl.move_to_stage_id);
    }
  };

  // Reset transient state on channel switch.
  useEffect(() => {
    setSelectedTemplateId('');
    setBody('');
    if (channel !== 'email') setSubject('');
  }, [channel]);

  const channelDisabledReason = useMemo<string | null>(() => {
    if (channel === 'sms' && !contactPhone) return 'No phone';
    if (channel === 'whatsapp' && !contactPhone) return 'No phone';
    if (channel === 'email' && !contactEmail) return 'No email on file';
    return null;
  }, [channel, contactPhone, contactEmail]);

  const stageMissing = pickedStageId === null;

  const channelMissing = channel === null;

  const isSendDisabled =
    channelMissing ||
    !body.trim() ||
    sending ||
    stageMissing ||
    !!channelDisabledReason ||
    (channel === 'email' && !subject.trim());

  const send = async () => {
    if (isSendDisabled) return;
    setSending(true);
    try {
      const trimBody = body.trim();
      const trimSubject = subject.trim();
      const fn = supabase.functions as unknown as SendInvoke;

      // PR 86: pass campaignId through so send fns resolve from
      // wk_campaign_numbers when on a call. Falls through to workspace
      // default when null/undefined.
      const camp = campaignId ?? undefined;
      let resp: Awaited<ReturnType<SendInvoke['invoke']>>;
      if (channel === 'sms') {
        // PR 96 (Hugo 2026-04-28): legacy `sms-send` route wrote to the
        // legacy `sms_messages` table, which the CRM inbox doesn't read.
        // Switched to wk-sms-send so the bubble appears in /crm/inbox
        // realtime + carries campaign context.
        resp = await fn.invoke('wk-sms-send', {
          body: { contact_id: contactId, body: trimBody, campaign_id: camp },
        });
      } else if (channel === 'whatsapp') {
        resp = await fn.invoke('unipile-send', {
          body: { contact_id: contactId, body: trimBody, campaign_id: camp },
        });
      } else {
        resp = await fn.invoke('wk-email-send', {
          body: {
            contact_id: contactId,
            subject: trimSubject,
            body: trimBody,
            campaign_id: camp,
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

      const target = columns.find((c) => c.id === pickedStageId);
      if (target && target.id !== currentContact?.pipelineColumnId) {
        patchContact(contactId, { pipelineColumnId: target.id });
        try {
          await persist.moveToColumn(contactId, target.id);
          pushToast(`Moved to ${target.name}`, 'success');
        } catch (e) {
          pushToast(
            `Stage move failed: ${e instanceof Error ? e.message : 'unknown'}`,
            'error'
          );
        }
      }
      setBody('');
      if (channel === 'email') setSubject('');
      setSelectedTemplateId('');
      // PR 107: open follow-up prompt anchored to the just-picked stage,
      // BEFORE we wipe pickedStageId for the next compose.
      if (pickedStageId) {
        setFollowupTarget({ columnId: pickedStageId });
      }
      setPickedStageId(null);
      // PR 105: force re-pick of channel after every successful send.
      setChannel(null);
    } catch (e) {
      pushToast(
        `${CHANNEL_LABEL[channel]} send crashed: ${e instanceof Error ? e.message : 'unknown'}`,
        'error'
      );
    } finally {
      setSending(false);
    }
  };

  const length = body.length;
  // channel starts unselected; fall back to a neutral label so the header
  // and template-empty placeholder don't index CHANNEL_LABEL with null.
  const channelLabel = channel ? CHANNEL_LABEL[channel] : 'Message';
  const charLimit = channel === 'sms' ? 160 : channel === 'whatsapp' ? 4096 : 10000;
  const ChannelIcon =
    channel === 'email' ? Mail : channel === 'whatsapp' ? MessageSquare : Phone;

  // PR 107: lookup column for follow-up modal.
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
    <div className="border border-[#E5E7EB] rounded-xl p-2.5 bg-white">
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ChannelIcon className="w-3.5 h-3.5 text-[#1E9A80] flex-none" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#1A1A1A] truncate">
            Send {channelLabel} to {firstName || contactName}
          </span>
        </div>
        <div
          role="radiogroup"
          aria-label="Channel"
          className="inline-flex p-0.5 bg-[#F3F3EE] rounded-[6px] border border-[#E5E5E5] gap-0.5 flex-none"
        >
          {(['sms', 'whatsapp', 'email'] as const).map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={channel === c}
              onClick={() => setChannel(c)}
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-semibold rounded-[4px] transition-colors',
                channel === c
                  ? 'bg-white text-[#1E9A80] shadow-sm'
                  : 'text-[#6B7280] hover:text-[#1A1A1A]'
              )}
              type="button"
            >
              {c === 'sms' ? 'SMS' : c === 'whatsapp' ? 'WA' : 'Email'}
            </button>
          ))}
        </div>
      </div>

      {channelDisabledReason && (
        <div
          className="text-[10px] text-[#B45309] bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-[6px] px-2 py-1 mb-2"
          role="alert"
        >
          {channelDisabledReason}
        </div>
      )}

      <select
        value={selectedTemplateId}
        onChange={(e) => applyTemplate(e.target.value)}
        disabled={loadingTpls || filteredTemplates.length === 0}
        className="w-full mb-2 px-2 py-1.5 text-[11px] border border-[#E5E5E5] rounded-[8px] bg-white disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]"
      >
        <option value="">
          {loadingTpls
            ? 'Loading templates…'
            : filteredTemplates.length === 0
              ? `No ${channelLabel} templates yet`
              : 'Insert template…'}
        </option>
        {filteredTemplates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.move_to_stage_id ? ' →' : ''}
          </option>
        ))}
      </select>

      <div
        className={cn(
          'mb-2 px-2 py-1.5 rounded-[8px] border flex items-center gap-2',
          stageMissing
            ? 'border-[#F59E0B]/60 bg-[#FFFBEB]'
            : 'border-[#1E9A80]/30 bg-[#ECFDF5]/50'
        )}
      >
        <span
          className={cn(
            'text-[10px] uppercase tracking-wide font-bold',
            stageMissing ? 'text-[#B45309]' : 'text-[#1E9A80]'
          )}
        >
          {stageMissing ? 'Pick stage' : 'Stage'}
        </span>
        <StageSelector
          value={pickedStageId ?? undefined}
          onChange={(col) => setPickedStageId(col)}
          size="xs"
          pipelineId={pipelineId}
        />
        {!stageMissing && targetStage && targetStage.id === pickedStageId && (
          <span className="text-[10px] text-[#1E9A80] inline-flex items-center gap-0.5 ml-auto">
            <ArrowRight className="w-3 h-3" /> from template
          </span>
        )}
      </div>

      {/* PR 116: from-line indicator. Tiny caption above the send box
          so the agent always knows which number/account is sending. */}
      {channel && fromLine && (
        <div className="text-[10px] text-[#6B7280] mb-1.5 flex items-center gap-1">
          <span className="font-semibold uppercase tracking-wide text-[#9CA3AF]">From:</span>
          <span className="font-mono text-[#1A1A1A]">{fromLine}</span>
        </div>
      )}

      {channel === 'email' && (
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Email subject (required) — type freely or pick a template above"
          className={cn(
            'w-full mb-2 px-2 py-1.5 text-[12px] border rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30 focus:border-[#1E9A80]',
            // PR 114: highlight subject input when blocking the send so
            // the agent sees what's missing without clicking the button.
            !subject.trim() && body.trim().length > 0
              ? 'border-[#F59E0B] bg-[#FFFBEB]'
              : 'border-[#E5E5E5]'
          )}
        />
      )}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          channel === 'email'
            ? 'Type your email here, or pick a template above. Templates are optional.'
            : 'Type a message, or pick a template above. Templates are optional.'
        }
        rows={channel === 'email' ? 7 : 5}
        className="w-full px-2 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#1E9A80]/30 focus:border-[#1E9A80] resize-y min-h-[80px]"
      />
      {/* PR 106 (Hugo 2026-04-28): when a body has been typed but no
          stage is picked, pulse a soft warning right above the Send
          row so the agent sees it at the moment they reach for Send.
          The orange "Pick stage" badge above the textarea was getting
          missed. Stage gate (PR 16) still enforces — this is just UX. */}
      {body.trim().length > 0 && pickedStageId === null && channel !== null && !sending && (
        <div className="text-[11px] text-[#B45309] inline-flex items-center gap-1.5 animate-pulse mt-1.5 mb-0.5">
          <ArrowUp className="w-3 h-3" /> Pick a stage to send
        </div>
      )}
      <div className="flex items-center justify-between mt-1.5">
        <span
          className={cn(
            'text-[10px] tabular-nums',
            length > charLimit ? 'text-[#F59E0B]' : 'text-[#9CA3AF]'
          )}
        >
          {length}/{charLimit}
        </span>
        <button
          onClick={() => void send()}
          disabled={isSendDisabled}
          title={
            channelDisabledReason ??
            (stageMissing
              ? 'Pick a stage before sending — every send routes the lead through the pipeline.'
              : channel === 'email' && !subject.trim()
                ? 'Email subject required'
                : undefined)
          }
          className="bg-[#1E9A80] text-white text-[11px] font-semibold px-3 py-1.5 rounded-[8px] inline-flex items-center gap-1 hover:bg-[#1E9A80]/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-3 h-3" />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
    {followupTarget && (
      <FollowupPromptModal
        open
        onOpenChange={(o) => { if (!o) setFollowupTarget(null); }}
        contactId={contactId}
        contactName={contactName}
        columnId={followupTarget.columnId}
        columnName={followupColumn?.name ?? 'Stage'}
        suggestedHoursAhead={followupSuggestedHours}
        callId={call?.callId ?? null}
        onSaved={() => setFollowupTarget(null)}
      />
    )}
    </>
  );
}
