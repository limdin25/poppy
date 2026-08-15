// The email to the estate agent, sent while they are still on the phone.
//
// Hugo, 2026-08-14, after watching Pedro do it by hand: "on the call he asks
// can I have your email, they give it, and he says I'm sending you an email
// now, please confirm you received it. On this email we just ask for the video,
// so they have our address and we have theirs." And then: "there is no field to
// type the email address on the right hand side, so that should be there. And
// then the AI does both, types the email address if he doesn't want to type it,
// plus writes the email for the agent, and he just presses send."
//
// So this pane is three things in one column, in the order they happen:
//
//   1. THE ADDRESS. A field he can type into, which fills ITSELF the moment the
//      branch says the address out loud. The coach hears it (extractEmail in
//      api/lib/spoken-email.ts), files a card carrying meta.captured_email, and
//      this pane is subscribed to those cards over realtime.
//   2. THE EMAIL. Already written when he gets here: the fixed template lands
//      instantly so there is ALWAYS something to send, and the AI draft written
//      from this actual call replaces it when it arrives, unless he has started
//      typing.
//   3. SEND. One press, to whatever is in the box (wk-email-send takes a typed
//      recipient, because sister branches share one inbox and wk_contacts has a
//      unique index on email). The address is written onto the lead AFTER it has
//      gone, so next week's offer email already knows where to go.
//
// TWO EMAILS, never one, because the deal process has two calls:
//   discovery -> the video request, which NEVER carries a figure of ours
//   offer     -> the offer email, which is the existing draft-offer-email path
// The mode is read from the same callModeForStep switch the script pane and the
// offer strip obey, so all three can never disagree about which call this is.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, Send, Sparkles, Check, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useContactPersistence } from '../../hooks/useContactPersistence';
import { callModeForStep } from '../../lib/nextStep';
import type { OfferHouse } from './MidCallSmsSender';

interface Props {
  contactId?: string;
  /** The branch name, for the greeting when we have no person. */
  contactName?: string;
  /** Whatever address is already on the lead. */
  contactEmail?: string;
  /** The person Pedro is speaking to, when the checklist has them. */
  agentPersonName?: string | null;
  agentFirstName: string;
  /** The live wk_calls.id: what the AI draft reads to write from this call. */
  currentCallId?: string | null;
  /** The house on screen. */
  offerHouse?: OfferHouse | null;
  /** custom_fields.next_step, which decides call one or call two. */
  nextStep?: string | null;
}

/** Who the email comes from. Pedro says this company on every property call
 *  (src/core/content/property-call-script.html), and it is the company on the
 *  property working agreement, so it is what the email has to say too. */
const COMPANY = 'Unico';

/** The email that is ALWAYS there, before any model is asked.
 *
 *  Pedro asked, in as many words: "where can I find the template email to send
 *  to them while on the call?" This is the answer, and it is pre-filled rather
 *  than hidden behind a picker. If the model is slow, down, or writes something
 *  he does not like, this is what sends. No figure appears in it, ever. */
export function videoRequestTemplate(opts: {
  street: string;
  person?: string | null;
  fromName: string;
}): { subject: string; body: string } {
  const hi = opts.person ? `Hi ${opts.person},` : 'Hi,';
  return {
    subject: `${opts.street}, the video walkthrough`,
    body: [
      hi,
      '',
      `Thanks for your time just now on ${opts.street}. As promised, here is my email so you have it.`,
      '',
      'When you get a minute, could you send over a video walkthrough of it? Even a quick walk round on your phone next time you are there is perfect, and you do not need to be in it. Our builder prices the works off the video, which is how we can move quickly without dragging anyone out to a viewing.',
      '',
      'If the floor plan or the full EPC are on file, those two are useful as well.',
      '',
      `We are a cash buyer, a limited company, no mortgage and no chain, so once we have had a proper look I will come back to you with something you can put to the vendor.`,
      '',
      'Thanks,',
      `${opts.fromName}`,
      COMPANY,
    ].join('\n'),
  };
}

/** The email for a branch that said NO to the video.
 *
 *  Hugo, 2026-08-14: "sometimes the agent refuses the video. Then how do we get
 *  their email? You ask, can I have your email anyway, so my director can
 *  contact you direct with some questions. And the email is gonna be just
 *  written hi, this is Pedro, please confirm you have seen this email."
 *
 *  So it asks for NOTHING. Its whole job is to make the address real while they
 *  are still on the phone: they read it out, they watch it arrive, they say so.
 *  A branch that has just refused one thing will refuse a second ask in the same
 *  breath, and we would rather have a working address than a second no. */
export function addressOnlyTemplate(opts: {
  street: string;
  person?: string | null;
  fromName: string;
}): { subject: string; body: string } {
  const hi = opts.person ? `Hi ${opts.person},` : 'Hi,';
  return {
    subject: `${opts.street}, ${opts.fromName} at ${COMPANY}`,
    body: [
      hi,
      '',
      `This is ${opts.fromName} at ${COMPANY}, we just spoke about ${opts.street}. Sending this so you have my email address.`,
      '',
      'Could you reply to confirm it has reached you? Our director may come back to you directly with a couple of questions on it.',
      '',
      'Thanks,',
      `${opts.fromName}`,
      COMPANY,
    ].join('\n'),
  };
}

const streetOf = (address?: string | null): string => {
  const s = (address ?? '').trim();
  if (!s) return 'the property';
  return s.split(',')[0].trim() || s;
};

export default function PropertyEmailPane({
  contactId,
  contactName,
  contactEmail,
  agentPersonName,
  agentFirstName,
  currentCallId,
  offerHouse,
  nextStep,
}: Props) {
  const { pushToast, patchContact } = useSmsV2();
  const persist = useContactPersistence();
  const isOfferCall = callModeForStep(nextStep) === 'offer';

  const [email, setEmail] = useState(contactEmail ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  // Once he types, nothing overwrites him. The AI draft can land seconds after
  // he has started editing, and losing what somebody typed mid-call is worse
  // than not drafting at all.
  const touched = useRef(false);
  const drafted = useRef(false);
  // Which call-one email is in the box. Flipped by Pedro the moment a branch
  // says no to the video, which happens mid-sentence, so it is one button and
  // not a menu.
  const [askKind, setAskKind] = useState<'video' | 'address_only'>('video');

  const street = streetOf(offerHouse?.address);

  // 1. The template, immediately. There is always something to send, and it
  //    swaps the instant he presses the other button.
  useEffect(() => {
    if (touched.current) return;
    if (isOfferCall) return; // the offer email is written, never templated
    const t = askKind === 'video'
      ? videoRequestTemplate({ street, person: agentPersonName, fromName: agentFirstName })
      : addressOnlyTemplate({ street, person: agentPersonName, fromName: agentFirstName });
    setSubject(t.subject);
    setBody(t.body);
  }, [street, agentPersonName, agentFirstName, isOfferCall, askKind]);

  // A different lead is a different email. Reset, or the last branch's draft
  // gets sent to this one.
  useEffect(() => {
    touched.current = false;
    drafted.current = false;
    setSent(false);
    setNote(null);
    setHeard(null);
    setAskKind('video');
    setEmail(contactEmail ?? '');
  }, [contactId, contactEmail]);

  /** 2. The AI draft, from what was actually said on this call. */
  const draft = useCallback(async (silent = false) => {
    if (drafting) return;
    setDrafting(true);
    if (!silent) setNote(null);
    try {
      // The drafter reads live transcripts and the proof-of-funds settings with
      // the service-role key, so it is gated like every other deal route.
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch('/api/crm/draft-offer-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess?.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          kind: isOfferCall ? 'offer' : askKind === 'video' ? 'video_request' : 'address_only',
          callId: currentCallId ?? null,
          house: offerHouse ?? {},
          agentName: agentPersonName ?? null,
          agencyName: contactName ?? null,
          fromName: agentFirstName,
          companyName: COMPANY,
        }),
      });
      const json = await res.json() as { subject?: string; body?: string; error?: string; usedTranscript?: boolean };
      if (!res.ok || json.error) {
        // The template is still in the box, so this is a note, not a failure.
        if (!silent) setNote(json.error ?? 'Could not write it. The template below still sends.');
        return;
      }
      if (touched.current) {
        setNote('Draft ready, but you had started typing so it was left alone.');
        return;
      }
      if (json.subject) setSubject(json.subject);
      if (json.body) setBody(json.body);
      setNote(json.usedTranscript ? 'Written from this call.' : 'Written without a transcript.');
    } catch {
      if (!silent) setNote('Could not reach the writer. The template below still sends.');
    } finally {
      setDrafting(false);
    }
  }, [drafting, isOfferCall, askKind, currentCallId, offerHouse, agentPersonName, contactName, agentFirstName]);

  // 3. The address, typed by the brain. The coach files a card the moment it
  //    hears one; this listens for it and fills the field, then writes the
  //    email from the call without being asked. That is the whole of Hugo's
  //    "he just presses send".
  useEffect(() => {
    if (!currentCallId) return;
    const channel = supabase
      .channel(`email-capture-${currentCallId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wk_live_coach_events', filter: `call_id=eq.${currentCallId}` },
        (payload: { new?: { meta?: { captured_email?: string } | null } }) => {
          const found = payload.new?.meta?.captured_email;
          if (!found) return;
          setHeard(found);
          // Never overwrite a human. If he has typed an address, his wins.
          setEmail((cur) => (cur.trim() ? cur : found));
          if (!drafted.current && !touched.current) {
            drafted.current = true;
            void draft(true);
          }
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [currentCallId, draft]);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  // No lead on screen is a real state in this room (between calls, empty
  // queue). The pane still draws, so Pedro can read the email he is about to
  // send before the lead lands; only the send is held back.
  const canSend = valid && !!subject.trim() && !!body.trim() && !sending && !!contactId;

  async function send() {
    if (!canSend || !contactId) return;
    setSending(true);
    setNote(null);
    try {
      const clean = email.trim().toLowerCase();

      // THE EMAIL GOES TO WHAT IS IN THE BOX, not to what happens to be stored.
      // Two branches of one agency share an inbox all the time and wk_contacts
      // has a unique index on email, so saving cannot be the thing that decides
      // whether an email can be sent.
      const fn = supabase.functions as unknown as {
        invoke: (n: string, o: { body: Record<string, unknown> }) => Promise<{
          data: { error?: string } | null; error: { message: string } | null;
        }>;
      };
      const { data, error } = await fn.invoke('wk-email-send', {
        body: {
          contact_id: contactId,
          to_email: clean,
          subject: subject.trim(),
          body: body.trim(),
        },
      });
      if (error || data?.error) {
        const detail = data?.error ?? error?.message ?? 'unknown';
        setNote(`It did not send: ${detail}`);
        pushToast(`Email failed: ${detail}`, 'error');
        return;
      }
      setSent(true);
      pushToast('Email sent', 'success');

      // Then remember it, so the offer email next week does not need the
      // address asking for again. Best effort ON PURPOSE: the email has gone,
      // and a unique-index clash with a sister branch must never read back as
      // "your email did not send".
      patchContact(contactId, { email: clean });
      const saved = await persist.patchContact(contactId, { email: clean });
      if (typeof saved === 'string') {
        setNote(`Sent. The address was not saved to the lead: ${saved.toLowerCase()}`);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'unknown';
      setNote(`It did not send: ${detail}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="property-email-pane">
      <div className="border-b border-[#E5E7EB] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Mail className="h-3.5 w-3.5 text-[#3C5A87]" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#3C5A87]">
            {isOfferCall ? 'The offer email' : 'Send it while they are on the phone'}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-[#6B7280]">
          {isOfferCall
            ? 'Written from this call and the figures on the strip. Read it before you send it.'
            : askKind === 'video'
              ? 'Ask for the email, send this, then say: "I have just sent you one, can you tell me it lands?" It asks for the video and gives them our address.'
              : 'They said no to the video. This one asks for nothing: it just puts your address in front of them and asks them to confirm it arrived.'}
        </p>
      </div>

      {/* 1. The address */}
      <div className="border-b border-[#E5E7EB] px-3 py-2">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
            Agent email
          </span>
          <input
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSent(false); }}
            placeholder="they say it, it appears here"
            spellCheck={false}
            autoCapitalize="off"
            data-testid="property-email-address"
            className="mt-0.5 w-full rounded border border-[#E5E7EB] px-2 py-1.5 text-[13px] text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none"
          />
        </label>
        {heard && (
          <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-[#2E7D43]">
            <Check className="mt-px h-3 w-3 flex-shrink-0" />
            <span>
              Heard <b>{heard}</b> on the call. Check it against what they said before you send.
            </span>
          </div>
        )}
        {!valid && email.trim().length > 0 && (
          <div className="mt-1 text-[11px] text-[#9A6B1E]">That is not a complete address yet.</div>
        )}
      </div>

      {/* 2. The email */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { touched.current = false; void draft(); }}
            disabled={drafting}
            data-testid="property-email-draft"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#CFDCEC] bg-[#EEF2F8] px-2 py-1 text-[11px] font-semibold text-[#3C5A87] disabled:opacity-50"
          >
            {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {drafting
              ? 'Writing it'
              : isOfferCall
                ? 'Write the offer'
                : askKind === 'video'
                  ? 'Write it from this call'
                  : 'Write the short one'}
          </button>
        </div>

        {/* THE TWO CALL-ONE EMAILS. A branch says no to the video mid-sentence,
            and the answer to that is never "then we get no email": the address
            is the call, the video is a bonus. One press swaps to the two-line
            one that asks for nothing. */}
        {!isOfferCall && (
          <div className="flex gap-1" data-testid="property-email-ask-kind">
            {([
              ['video', 'Asked for the video'],
              ['address_only', 'No video, just my address'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  touched.current = false;
                  drafted.current = false;
                  setAskKind(k);
                  setNote(null);
                }}
                className={`flex-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                  askKind === k
                    ? 'border-[#3C5A87] bg-[#EEF2F8] text-[#3C5A87]'
                    : 'border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#FAFAF8]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {note && (
          <div className="flex items-start gap-1.5 rounded border border-[#EBD9B4] bg-[#FDF3E3] px-2 py-1 text-[11px] leading-snug text-[#9A6B1E]">
            <AlertTriangle className="mt-px h-3 w-3 flex-shrink-0" />
            <span>{note}</span>
          </div>
        )}

        <input
          value={subject}
          onChange={(e) => { touched.current = true; setSubject(e.target.value); }}
          placeholder="Subject"
          className="w-full rounded border border-[#E5E7EB] px-2 py-1.5 text-[12px] font-medium text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => { touched.current = true; setBody(e.target.value); }}
          rows={12}
          data-testid="property-email-body"
          className="min-h-[180px] flex-1 w-full resize-y rounded border border-[#E5E7EB] px-2 py-1.5 text-[12px] leading-relaxed text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none"
        />

        <button
          onClick={send}
          disabled={!canSend}
          data-testid="property-email-send"
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#2E7D43] px-3 py-2 text-[13px] font-bold text-white transition hover:bg-[#276b39] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : sent ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {sending ? 'Sending' : sent ? 'Sent, ask them to confirm it landed' : 'Send it now'}
        </button>
        {!contactId ? (
          <p className="text-center text-[10.5px] text-[#9CA3AF]">
            No lead on screen yet. This is the email that will go out.
          </p>
        ) : !valid ? (
          <p className="text-center text-[10.5px] text-[#9CA3AF]">
            The address is what is missing. Ask for it, or type it here.
          </p>
        ) : null}
      </div>
    </div>
  );
}
