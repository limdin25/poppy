// The email on a Serviced Accommodation call (Hugo, 2026-09-23).
//
// Letting agents nearly always say "send me an email". So Pedro asks for the
// address, it goes in the box, he presses send while they are still on the
// phone. A PERSON presses send, every time: nothing on this desk texts or
// emails anybody by itself.
//
// WE ARE THE MIDDLEMAN. The email says we work with serviced accommodation
// companies and asks for a yes in principle from the agent or the landlord. It
// never says "we will take the flat", never agrees a rent, and never names a
// start date.

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mail, Send, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useContactPersistence } from '../../hooks/useContactPersistence';
import type { SaListing } from '../../hooks/useSaListings';
import { gbpMonth, spokenStreet } from '../../hooks/useSaListings';

/** The company Pedro says on the phone (src/core/content/sa-call-script.html). */
const COMPANY = 'Unico';

export function saEmailTemplate(opts: {
  address: string;
  street: string;
  city?: string | null;
  rent: string;
  person?: string | null;
  fromName: string;
}): { subject: string; body: string } {
  const hi = opts.person ? `Hi ${opts.person},` : 'Hi,';
  const where = opts.city ? ` in ${opts.city}` : '';
  return {
    subject: `${opts.street}, company let for serviced accommodation`,
    body: [
      hi,
      '',
      `Thanks for your time on the phone. As mentioned, we work with serviced accommodation companies who are looking for flats${where} on a company let of 3 to 5 years, and ${opts.address} would suit them.`,
      '',
      'For the landlord that means:',
      `- the full asking rent${opts.rent ? ` of ${opts.rent}` : ''}, paid by one company on one contract`,
      '- rent paid every month whether the flat is booked or not',
      '- the flat furnished, cleaned after every stay and looked after professionally',
      '- no empty months between tenants',
      '',
      'Could you let me know if you, or the landlord, would be open to this in principle? If so, we will introduce the company and they will take it from there.',
      '',
      'Thanks,',
      opts.fromName,
      COMPANY,
    ].join('\n'),
  };
}

interface Props {
  contactId?: string;
  contactEmail?: string;
  agentFirstName: string;
  listing: SaListing | null;
}

const VALID = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function SaEmailPane({ contactId, contactEmail, agentFirstName, listing }: Props) {
  const { pushToast, patchContact } = useSmsV2();
  const persist = useContactPersistence();
  const [email, setEmail] = useState(contactEmail ?? '');
  const [person, setPerson] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Once he types in the email itself, nothing overwrites him.
  const touched = useRef(false);

  const address = listing?.address || 'the flat';
  const street = spokenStreet(listing?.address) || address;
  const rent = gbpMonth(listing?.rentPcm);

  useEffect(() => {
    if (touched.current) return;
    const t = saEmailTemplate({ address, street, city: listing?.city, rent, person: person.trim() || null, fromName: agentFirstName });
    setSubject(t.subject);
    setBody(t.body);
  }, [address, street, rent, listing?.city, person, agentFirstName]);

  const valid = VALID.test(email.trim());
  const canSend = valid && !!subject.trim() && !!body.trim() && !sending && !!contactId;

  async function send() {
    if (!canSend || !contactId) return;
    setSending(true);
    setNote(null);
    try {
      const clean = email.trim().toLowerCase();
      const fn = supabase.functions as unknown as {
        invoke: (n: string, o: { body: Record<string, unknown> }) => Promise<{
          data: { error?: string } | null; error: { message: string } | null;
        }>;
      };
      const { data, error } = await fn.invoke('wk-email-send', {
        body: { contact_id: contactId, to_email: clean, subject: subject.trim(), body: body.trim() },
      });
      if (error || data?.error) {
        const detail = data?.error ?? error?.message ?? 'unknown';
        setNote(`It did not send: ${detail}`);
        pushToast(`Email failed: ${detail}`, 'error');
        return;
      }
      setSent(true);
      pushToast('Email sent', 'success');
      // Remember the address. Best effort: the email has gone either way.
      patchContact(contactId, { email: clean });
      const saved = await persist.patchContact(contactId, { email: clean });
      if (typeof saved === 'string') setNote(`Sent. The address was not saved to the lead: ${saved.toLowerCase()}`);
    } catch (e) {
      setNote(`It did not send: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="sa-email-pane">
      <div className="border-b border-[#E5E7EB] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Mail className="h-3.5 w-3.5 text-[#3C5A87]" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-[#3C5A87]">Send it while they are on the phone</span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-[#6B7280]">
          When they say "send me an email": get the address, press send, then ask them to confirm it landed.
        </p>
      </div>

      <div className="border-b border-[#E5E7EB] px-3 py-2 space-y-2">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">Their email</span>
          <input
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSent(false); }}
            placeholder="name@agency.co.uk"
            spellCheck={false}
            autoCapitalize="off"
            data-testid="sa-email-address"
            className="mt-0.5 w-full rounded border border-[#E5E7EB] px-2 py-1.5 text-[13px] text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">Their first name (optional)</span>
          <input
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="for the greeting"
            className="mt-0.5 w-full rounded border border-[#E5E7EB] px-2 py-1.5 text-[13px] text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none"
          />
        </label>
        {!valid && email.trim().length > 0 && (
          <div className="text-[11px] text-[#9A6B1E]">That is not a complete address yet.</div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
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
          rows={14}
          data-testid="sa-email-body"
          className="min-h-[200px] flex-1 w-full resize-y rounded border border-[#E5E7EB] px-2 py-1.5 text-[12px] leading-relaxed text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none"
        />
        <button
          onClick={send}
          disabled={!canSend}
          data-testid="sa-email-send"
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#2E7D43] px-3 py-2 text-[13px] font-bold text-white transition hover:bg-[#276b39] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : sent ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {sending ? 'Sending' : sent ? 'Sent, ask them to confirm it landed' : 'Send it now'}
        </button>
        {!contactId && (
          <p className="text-center text-[10.5px] text-[#9CA3AF]">No agency on screen yet. This is the email that will go out.</p>
        )}
      </div>
    </div>
  );
}
