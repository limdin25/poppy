// Read the message before it goes, then choose which one goes.
//
// Hugo, 2026-08-24: "he can click and say send message and then it shows the
// opener message ... and make sure he can choose the template he wants to
// send." Then 2026-08-25: "we can have the templates and everything but I
// think we have to have SMS first ... then he can click to SMS and SMS the
// details."
//
// SO THERE ARE TWO LANES AND TEXT IS THE ONE THAT OPENS. The WhatsApp lane is
// unchanged and still here: approved templates only, fixed wording, three
// slots. The text lane is new and is the one that actually reaches a cold
// builder, because his WhatsApp window has never been open and a template is
// the only thing Meta lets through it. On the text lane Pedro writes the words
// himself, which is the whole point after a phone call: the man is expecting
// the address, not a form letter.
//
// This is deliberately a modal with its own button rather than an inline
// confirm. It is the last thing between a press and a cold message landing on a
// real builder's phone, and everything that can refuse the send is shown here
// rather than discovered afterwards.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, MessageSquare, X } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { callWaAdmin, isApproved, renderTemplate, type MetaTemplate } from '../../lib/waAdmin';
import { prefillTemplateVars } from '../../lib/waTemplates';
// The same charset rules the server rewrites the body with, imported rather
// than re-typed. Two copies of the GSM-7 table is two answers to "how many
// texts is this", and the expensive one is always the copy that is wrong.
import { nonGsm7, smsSegments } from '../../../../../api/lib/sms-charset';

export type SendChannel = 'sms' | 'whatsapp';

interface Props {
  open: boolean;
  onClose: () => void;
  recipients: Array<{ id: string; name: string; phone: string | null }>;
  facts: { address: string; viewingTime: string; sender: string };
  houseNumberKnown: boolean;
  /** The house-level block as WhatsApp sees it. */
  blockedReason: string | null;
  /** The same block as a text sees it, which differs by exactly one reason:
   *  template_pending does not apply to something that has no template. */
  blockedBySms: string | null;
  /** Server-rendered from the house's own facts, so the words on this screen
   *  and the words on the wire come from one place. */
  smsDrafts: { opener: string; details: string };
  /** Which draft to open on. "details" is what follows a phone call. */
  initialDraft?: 'opener' | 'details';
  sentToday: number;
  dailyCap: number;
  onSend: (input: {
    channel: SendChannel;
    contentSid?: string;
    vars?: Record<string, string>;
    smsBody?: string;
  }) => Promise<void>;
}

/** Three texts to a stranger is already long, and the server refuses past it,
 *  so the box says so before the press rather than after. */
const MAX_SEGMENTS = 3;

export default function SendReviewDialog({
  open, onClose, recipients, facts, houseNumberKnown,
  blockedReason, blockedBySms, smsDrafts, initialDraft = 'opener',
  sentToday, dailyCap, onSend,
}: Props) {
  const [channel, setChannel] = useState<SendChannel>('sms');
  const [draftKind, setDraftKind] = useState<'opener' | 'details'>(initialDraft);
  const [smsBody, setSmsBody] = useState('');
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [sid, setSid] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reopening resets to text and to whichever draft the press implied, because
  // the alternative is a dialog that silently remembers a choice made about a
  // different builder on a different house.
  useEffect(() => {
    if (!open) return;
    setChannel('sms');
    setDraftKind(initialDraft);
  }, [open, initialDraft]);

  useEffect(() => {
    if (!open) return;
    setSmsBody(draftKind === 'details' ? smsDrafts.details : smsDrafts.opener);
  }, [open, draftKind, smsDrafts.details, smsDrafts.opener]);

  // The template list is only fetched when the WhatsApp lane is actually
  // opened. It was a blocking load on every press before, for a lane that is
  // now the second choice.
  useEffect(() => {
    if (!open || channel !== 'whatsapp') return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    callWaAdmin<{ templates: MetaTemplate[] }>({ action: 'template_list' })
      .then((r) => {
        if (!alive) return;
        // Only approved templates are offered. Meta refuses the rest at the
        // wire anyway, and sendOutreachRow checks approval again before it
        // spends, so offering one would only produce a confusing refusal.
        const ok = (r.templates ?? []).filter(isApproved);
        setTemplates(ok);
        setSid((cur) => (cur && ok.some((t) => t.sid === cur) ? cur : ok[0]?.sid ?? ''));
      })
      .catch((e) => { if (alive) setLoadError(e instanceof Error ? e.message : 'Could not load the templates.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, channel]);

  const chosen = useMemo(() => templates.find((t) => t.sid === sid) ?? null, [templates, sid]);

  useEffect(() => {
    if (!chosen) return;
    setVars(prefillTemplateVars(chosen.body, {
      address: facts.address, viewingTime: facts.viewingTime, sender: facts.sender,
    }));
  }, [chosen, facts.address, facts.viewingTime, facts.sender]);

  const preview = chosen ? renderTemplate(chosen.body, vars) : '';
  const blanks = chosen ? Object.entries(vars).filter(([, v]) => !v.trim()) : [];
  const room = Math.max(0, dailyCap - sentToday);
  const overCap = recipients.length > room;

  const bad = useMemo(() => (channel === 'sms' ? nonGsm7(smsBody) : []), [channel, smsBody]);
  const segments = useMemo(() => (channel === 'sms' && smsBody ? smsSegments(smsBody) : 0), [channel, smsBody]);
  const tooLong = segments > MAX_SEGMENTS;

  // A landline cannot receive either kind of message. It is listed rather than
  // hidden so that "I picked five and four went" has a reason on the screen.
  const landlines = recipients.filter((r) => !/^\+447\d{9}$/.test(String(r.phone ?? '')));

  const block = channel === 'sms' ? blockedBySms : blockedReason;
  const canSend = channel === 'sms'
    ? Boolean(smsBody.trim()) && !tooLong && !block && !overCap && !sending
    : Boolean(chosen) && !blanks.length && !block && !overCap && !sending;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl" data-testid="send-review-dialog">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold text-[#1A1A1A]">
              Write to {recipients.length} builder{recipients.length === 1 ? '' : 's'}
            </h2>
            <p className="mt-0.5 text-[11px] text-[#6B7280]">Read it before it goes.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-[#9CA3AF] hover:bg-[#F3F4F6]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 inline-flex rounded-[10px] border border-[#E5E7EB] bg-[#FAFAF8] p-0.5">
          {([['sms', 'Text'], ['whatsapp', 'WhatsApp']] as const).map(([id, label]) => (
            <button
              key={id}
              data-testid={`send-channel-${id}`}
              onClick={() => setChannel(id)}
              className={cn(
                'rounded-[8px] px-3 py-1 text-[11.5px]',
                channel === id ? 'bg-white font-bold text-[#3C5A87] shadow-sm' : 'text-[#6B7280]',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {block ? (
          <Warn>This house cannot have builders written to yet. Clear the block above first.</Warn>
        ) : null}
        {!houseNumberKnown ? (
          <Warn>
            There is still no house number on this advert. They will be told the street only, and the last
            time that happened the builder asked which house it was and never got an answer.
          </Warn>
        ) : null}
        {overCap ? (
          <Warn>
            Only {room} of today&apos;s {dailyCap} can still go out and you have {recipients.length} selected.
            Send fewer, or wait until tomorrow.
          </Warn>
        ) : null}
        {landlines.length ? (
          <Warn>
            {landlines.length} of these {landlines.length === 1 ? 'is a landline' : 'are landlines'} and cannot
            be messaged at all. Ring {landlines.length === 1 ? 'that one' : 'those'} instead.
          </Warn>
        ) : null}

        {channel === 'sms' ? (
          <>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">The text</label>
              <div className="flex gap-1">
                {([['opener', 'First contact'], ['details', 'After a call']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    data-testid={`sms-draft-${id}`}
                    onClick={() => setDraftKind(id)}
                    className={cn(
                      'rounded-full border px-2 py-[1px] text-[10.5px]',
                      draftKind === id
                        ? 'border-[#3C5A87] bg-[#EEF2F8] font-medium text-[#3C5A87]'
                        : 'border-[#E5E7EB] bg-white text-[#6B7280]',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              data-testid="sms-body"
              value={smsBody}
              onChange={(e) => setSmsBody(e.target.value)}
              rows={5}
              className="w-full rounded-[10px] border border-[#E5E7EB] bg-white px-3 py-2 text-[12px] leading-relaxed text-[#1A1A1A] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
            />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'text-[10.5px] tabular-nums',
                  tooLong ? 'font-bold text-[#DC2626]' : 'text-[#6B7280]',
                )}
              >
                {smsBody.length} characters, {segments} text{segments === 1 ? '' : 's'} each
              </span>
              {tooLong ? (
                <span className="text-[10.5px] text-[#DC2626]">
                  Too long. Keep it to {MAX_SEGMENTS}.
                </span>
              ) : null}
            </div>
            {bad.length ? (
              // Not a style note. One of these characters drops the segment
              // from 160 characters to 70, so a two-part text quietly becomes
              // a five-part one on every send.
              <p className="mt-1 text-[10.5px] text-[#B45309]">
                {bad.join(' ')} will be swapped for plain punctuation before this sends. Those characters
                more than double what each text costs.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <label className="mb-1 block text-[9.5px] font-bold uppercase tracking-wider text-[#9CA3AF]">Approved message</label>
            {loading ? (
              <div className="h-8 animate-pulse rounded-[8px] bg-[#F3F4F6]" />
            ) : loadError ? (
              <p className="text-[11.5px] text-[#DC2626]">{loadError}</p>
            ) : !templates.length ? (
              <p className="text-[11.5px] text-[#B45309]">
                No approved WhatsApp template exists yet, so nothing can be sent to a builder outside a live
                conversation. Use Text instead, which needs no approval.
              </p>
            ) : (
              <select
                data-testid="send-template-picker"
                value={sid}
                onChange={(e) => setSid(e.target.value)}
                className="mb-2 w-full rounded-[8px] border border-[#E5E7EB] bg-white px-2 py-1.5 text-[12px] text-[#1A1A1A] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
              >
                {templates.map((t) => <option key={t.sid} value={t.sid}>{t.name}</option>)}
              </select>
            )}

            {chosen ? (
              <>
                <div className="whitespace-pre-wrap rounded-[10px] border border-[#E5E7EB] bg-[#FAFAF8] px-3 py-2 text-[12px] leading-relaxed text-[#1A1A1A]">
                  {preview}
                </div>
                {blanks.length ? (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[11px] text-[#B45309]">
                      Fill these in. They are left empty rather than guessed, because a wrong address is a builder
                      at the wrong house.
                    </p>
                    {blanks.map(([n]) => (
                      <input
                        key={n}
                        value={vars[n] ?? ''}
                        onChange={(e) => setVars((v) => ({ ...v, [n]: e.target.value }))}
                        placeholder={`Blank ${n}`}
                        className="w-full rounded-[8px] border border-[#F59E0B] bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]"
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}

        <div className="mt-3 max-h-28 overflow-y-auto rounded-[10px] border border-[#E5E7EB]">
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-[#F3F4F6] px-2 py-1 last:border-b-0">
              <span className="truncate text-[11.5px] text-[#374151]">{r.name}</span>
              <span className="font-mono text-[11px] tabular-nums text-[#9CA3AF]">{r.phone}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[10.5px] text-[#6B7280]">{sentToday} of {dailyCap} sent today</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-[8px] border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#6B7280]">
              Cancel
            </button>
            <button
              data-testid="send-review-confirm"
              disabled={!canSend}
              onClick={async () => {
                setSending(true);
                try {
                  await onSend(channel === 'sms'
                    ? { channel: 'sms', smsBody }
                    : { channel: 'whatsapp', contentSid: chosen?.sid, vars });
                } finally { setSending(false); }
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[11.5px] font-bold text-white',
                canSend ? 'bg-[#2E7D46]' : 'bg-[#9CA3AF]',
              )}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
              {channel === 'sms' ? 'Send the text' : 'Send it'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-start gap-1.5 rounded-[10px] border border-[#F59E0B] bg-[#FFFBEB] px-2.5 py-1.5">
      <AlertTriangle className="mt-[2px] h-3 w-3 flex-shrink-0 text-[#B45309]" />
      <span className="text-[11px] text-[#B45309]">{children}</span>
    </div>
  );
}
