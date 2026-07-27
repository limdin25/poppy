// SubscribeButton — the two "send the link" controls the agent uses to close
// on a call.
//
// Hugo 2026-07-22:
//   • Send our OWN branded pages (go.heyelsie.com), never a raw Stripe link.
//   • PLAIN links — no query string. The customer types their own details on
//     the page; nothing is pre-filled from the URL.
//   • TWO links:
//       – "Send subscribe link"  → /subscribe (DURING the call: enter email →
//         account created → pick a plan → Stripe → pay).
//       – "Send onboarding link" → /continue  (AFTER the call: they already
//         paid, log in by email code and finish setup — upload customers,
//         connect Google).
//   • The greeting name is the LEAD's OWNER (custom_fields.owner_name), NOT the
//     business name (wk_contacts.name is the company for plumber leads). The
//     name/email fields RE-SYNC whenever the active lead changes, so a previous
//     lead's owner (e.g. "Claire Cash") never sticks on the next contact.
//   • SMS/email copy says "pop your details in" — NO mention of a card; they
//     add the card themselves on the page.

import { useEffect, useState } from 'react';
import { CreditCard, Send, Copy, Check, X, Loader2, Mail, ClipboardList } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import type { Contact } from '../../types';

const SUBSCRIBE_LINK = 'https://go.heyelsie.com/subscribe';
const CONTINUE_LINK = 'https://go.heyelsie.com/continue';

type Kind = 'subscribe' | 'continue';

export default function SubscribeButton({ contact }: { contact: Contact }) {
  // name = owner (person) name for the SMS/email greeting; email = where to
  // send the link. These belong to the AGENT's send action, not the page.
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // Re-sync to THIS lead whenever the active contact changes — otherwise the
  // useState initial value would stick and show the previous lead's owner
  // name on the next contact (the "Claire Cash on Hugo" bug, Hugo 2026-07-22).
  useEffect(() => {
    setName((contact.customFields?.owner_name || contact.name || '').trim());
    setEmail((contact.email || '').trim());
  }, [contact.id, contact.customFields?.owner_name, contact.name, contact.email]);

  return (
    <div className="pb-1.5 border-b border-[#E5E7EB]/70 space-y-1.5">
      <LinkSender
        kind="subscribe"
        contact={contact}
        name={name}
        email={email}
        onName={setName}
        onEmail={setEmail}
      />
      <LinkSender
        kind="continue"
        contact={contact}
        name={name}
        email={email}
        onName={setName}
        onEmail={setEmail}
      />
    </div>
  );
}

function LinkSender({
  kind,
  contact,
  name,
  email,
  onName,
  onEmail,
}: {
  kind: Kind;
  contact: Contact;
  name: string;
  email: string;
  onName: (v: string) => void;
  onEmail: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState(false);
  const [copied, setCopied] = useState(false);

  const isSub = kind === 'subscribe';
  const link = isSub ? SUBSCRIBE_LINK : CONTINUE_LINK;
  const first = name.trim().split(/\s+/)[0] || 'there';

  const smsBody = isSub
    ? `Hi ${first}, here's your HeyElsie sign-up link — it's £1 to start and nothing else for 10 days: ${link} — pop your details in while I'm on the line and I'll get your reviews rolling.`
    : `Thanks for the call ${first}! Here's your setup link to finish getting started — upload your customers and connect your Google, takes about 10 minutes: ${link} — any bother, just reply.`;
  const emailSubject = isSub ? 'Your HeyElsie reviews sign-up link' : 'Your HeyElsie setup link';
  const emailBody = isSub
    ? `Hi ${first},\n\nHere's your secure sign-up link to start your 10-day free trial — nothing is charged for 10 days:\n\n${link}\n\nPop your details in and we'll get your Google reviews rolling.\n\nThanks,\nThe HeyElsie team`
    : `Hi ${first},\n\nThanks for the call. Here's your setup link to finish getting started — upload your customer list and connect your Google profile (about 10 minutes):\n\n${link}\n\nReviews start landing within days. Any questions, just reply.\n\nThanks,\nThe HeyElsie team`;

  async function textLink() {
    if (!contact.phone) { setNote('This lead has no mobile number — use email or copy.'); return; }
    setBusy(true);
    setNote('');
    try {
      const { error } = await supabase.functions.invoke('wk-sms-send', { body: { contact_id: contact.id, body: smsBody } });
      if (error) { setNote('Text failed — copy the link and send it manually.'); return; }
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  async function emailLink() {
    const to = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { setNote('Add a valid email to send by email (or use Text / Copy).'); return; }
    setBusy(true);
    setNote('');
    try {
      // wk-email-send delivers to the contact's on-file email — sync it to
      // what the agent typed so the link reaches the right inbox.
      if (to !== (contact.email || '')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('wk_contacts' as any) as any).update({ email: to }).eq('id', contact.id);
      }
      const { error } = await supabase.functions.invoke('wk-email-send', { body: { contact_id: contact.id, subject: emailSubject, body: emailBody } });
      if (error) { setNote('Email failed — copy the link and send it manually.'); return; }
      setSentEmail(true);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false); setNote(''); setSent(false); setSentEmail(false); setCopied(false);
  }

  if (!open) {
    return isSub ? (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#2e7d43] hover:bg-[#276b39] rounded-[8px] py-1.5 transition-colors"
      >
        <CreditCard className="w-3.5 h-3.5" /> Send subscribe link
      </button>
    ) : (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#2e7d43] border border-[#cfe6d4] bg-white hover:bg-[#eef8f0] rounded-[8px] py-1.5 transition-colors"
      >
        <ClipboardList className="w-3.5 h-3.5" /> Send onboarding link
      </button>
    );
  }

  return (
    <div className="rounded-[10px] border border-[#cfe6d4] bg-[#f4f9f5] p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#2e7d43]">
          {isSub ? 'Subscribe on the call' : 'Onboarding — after the call'}
        </span>
        <button onClick={reset} className="p-0.5 rounded hover:bg-black/[0.06] text-[#6B7280]"><X className="w-3.5 h-3.5" /></button>
      </div>

      {/* These fill the SMS greeting + the email-send address — NOT the page. */}
      <input
        value={name} onChange={(e) => onName(e.target.value)} placeholder="Owner name (for the text greeting)"
        className="w-full px-2 py-1.5 text-[12px] bg-white border border-[#d8ebdd] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#2e7d43]/40"
      />
      <input
        value={email} onChange={(e) => onEmail(e.target.value)} placeholder="Email (only to send the link by email)" type="email"
        className="w-full px-2 py-1.5 text-[12px] bg-white border border-[#d8ebdd] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#2e7d43]/40"
      />

      <div className="text-[10px] text-[#374151] break-all bg-white border border-[#d8ebdd] rounded-[8px] px-2 py-1.5">{link}</div>
      <div className="text-[10px] font-medium text-[#2e7d43] uppercase tracking-wide">Send it — text or email</div>
      <div className="flex gap-1.5">
        <button
          onClick={textLink} disabled={busy || sent}
          className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#2e7d43] hover:bg-[#276b39] disabled:opacity-60 rounded-[8px] py-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sent ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
          {sent ? 'Texted' : 'Text link'}
        </button>
        <button
          onClick={emailLink} disabled={busy || sentEmail}
          className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#2e7d43] border border-[#2e7d43] bg-white hover:bg-[#eef8f0] disabled:opacity-60 rounded-[8px] py-1.5"
        >
          {sentEmail ? <Check className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
          {sentEmail ? 'Emailed' : 'Email link'}
        </button>
        <button
          onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); }}
          title="Copy link"
          className="flex items-center justify-center gap-1 text-[12px] font-semibold text-[#2e7d43] border border-[#cfe6d4] bg-white hover:bg-[#eef8f0] rounded-[8px] px-2.5 py-1.5"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {note && <div className="text-[10.5px] text-[#b45309] leading-snug">{note}</div>}
    </div>
  );
}
