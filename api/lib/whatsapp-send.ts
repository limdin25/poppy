// One WhatsApp send, and one honest answer to "is the 24 hour window open".
//
// WHY A MODULE RATHER THAN A FOURTH COPY. The same twenty lines of Twilio form
// posting already sit in api/lib/builder-outreach.ts twice (the invite and the
// morning reminder) and in api/crm/ai-reply.ts once. The new paths in this
// build (the brain answering a builder, the machine asking Hugo a question)
// would have made five. The existing three are deliberately NOT refactored onto
// this: they work, they are live, and the only thing rewriting them could do
// today is break a send that currently goes out.
//
// THE 24 HOUR WINDOW IS THE WHOLE REASON THIS FILE EXISTS.
//
// WhatsApp lets a business send free-form text only inside 24 hours of the
// person's last inbound message. Outside it, exactly one thing is deliverable:
// a template Meta has approved, sent as ContentSid plus ContentVariables. The
// cruel part is the failure mode. A free-form send outside the window is
// ACCEPTED by the Twilio API, returns a sid, and dies asynchronously as error
// 63016. So the UI shows a sent message that the recipient never receives, and
// the only way to know is the status webhook minutes later.
//
// windowOpen() therefore decides BEFORE spending, from our own message table:
// is there an inbound WhatsApp message from this number inside 24 hours. That
// is the same fact Meta uses, and reading it locally costs one indexed query.

import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

/** The registered WhatsApp Business sender. Since 2026-08-19 this is the Unico
 *  line for builders and estate agents; it is no longer the creator funnel's. */
export const whatsappSender = (): string =>
  process.env.WHATSAPP_SENDER_E164 || '+447460035763';

/** Meta's rule, in milliseconds. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Can we send this person a free-form message right now?
 *
 * TRUE only when they have messaged us on WhatsApp inside the window. A missing
 * contact, an empty thread or a database hiccup all read FALSE, which is the
 * safe direction: the worst case of a false negative is that an approved
 * template goes out instead, and the worst case of a false positive is a
 * message that silently never arrives.
 */
export async function windowOpen(
  sb: Sb,
  contactId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!contactId) return false;
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  try {
    const { data } = await sb
      .from('wk_sms_messages')
      .select('id')
      .eq('contact_id', contactId)
      .eq('direction', 'inbound')
      .eq('channel', 'whatsapp')
      .gte('created_at', since)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

export interface WhatsAppSendResult {
  ok: boolean;
  sid?: string;
  error?: string;
  /** The wk_sms_messages row, so a caller can mark it failed on its own terms. */
  messageId?: string;
}

interface SendArgs {
  contactId: string;
  toE164: string;
  /** The words. For a template send this is the RENDERED preview, kept so the
   *  inbox shows a human what the builder actually received. */
  body: string;
  /** Present = template send (window shut or cold). Absent = free-form. */
  contentSid?: string | null;
  contentVariables?: Record<string, string>;
  /** Stamped on the message row so the inbox can tell brain from human. */
  aiGenerated?: boolean;
}

/**
 * Send one WhatsApp message and file it in the CRM thread.
 *
 * THE ROW GOES IN BEFORE THE WIRE CALL, always. It is the ai-reply.ts rule and
 * it is not stylistic: if Twilio answers and we crash before writing, a retry
 * sends the message twice, and a builder receiving the same invite twice is a
 * builder who thinks we are a robot. A row written for a send that then fails
 * is marked failed and costs nothing.
 */
export async function sendWhatsApp(sb: Sb, args: SendArgs): Promise<WhatsAppSendResult> {
  const acc = process.env.TWILIO_ACCOUNT_SID ?? '';
  const tok = process.env.TWILIO_AUTH_TOKEN ?? '';
  if (!acc || !tok) return { ok: false, error: 'Twilio is not configured.' };
  if (!/^\+\d{8,15}$/.test(args.toE164)) return { ok: false, error: `Not a sendable number: ${args.toE164}` };

  const { data: pending } = await (sb.from('wk_sms_messages') as any).insert({
    contact_id: args.contactId,
    direction: 'outbound',
    channel: 'whatsapp',
    body: args.body,
    from_e164: whatsappSender(),
    to_e164: args.toE164,
    status: 'sending',
    ai_generated: args.aiGenerated ?? true,
  }).select('id').single();
  const messageId = (pending as { id?: string } | null)?.id;

  const form = new URLSearchParams({
    To: `whatsapp:${args.toE164}`,
    From: `whatsapp:${whatsappSender()}`,
    StatusCallback: `${process.env.SUPABASE_URL}/functions/v1/wk-sms-status`,
  });
  if (args.contentSid) {
    form.set('ContentSid', args.contentSid);
    form.set('ContentVariables', JSON.stringify(args.contentVariables ?? {}));
  } else {
    form.set('Body', args.body);
  }

  let resp: Response;
  try {
    resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${acc}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${acc}:${tok}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch (e) {
    if (messageId) await (sb.from('wk_sms_messages') as any).update({ status: 'failed' }).eq('id', messageId);
    return { ok: false, error: String(e).slice(0, 200), messageId };
  }

  if (!resp.ok) {
    const errText = (await resp.text()).slice(0, 300);
    if (messageId) await (sb.from('wk_sms_messages') as any).update({ status: 'failed' }).eq('id', messageId);
    return { ok: false, error: `Twilio ${resp.status}: ${errText}`, messageId };
  }
  const sent = await resp.json() as { sid?: string };
  if (messageId) {
    await (sb.from('wk_sms_messages') as any).update({
      twilio_sid: sent.sid ?? null,
      external_id: sent.sid ?? null,
      status: sent.sid ? 'sent' : 'queued',
    }).eq('id', messageId);
  }
  return { ok: true, sid: sent.sid, messageId };
}

/**
 * Is a Twilio Content template actually approved by Meta right now?
 *
 * Checked synchronously before every template send for the same reason
 * windowOpen exists: an unapproved template fails asynchronously and looks
 * exactly like success. Returns the lowercase status word, or '' when the
 * lookup itself failed (treated as not approved by every caller).
 */
export async function templateApproval(contentSid: string): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const token = process.env.TWILIO_AUTH_TOKEN ?? '';
  if (!/^HX[0-9a-f]{32}$/i.test(contentSid) || !sid || !token) return '';
  try {
    const res = await fetch(
      `https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`,
      { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` } },
    );
    if (!res.ok) return '';
    const data = await res.json() as Record<string, unknown>;
    return String(((data.whatsapp ?? {}) as Record<string, unknown>).status ?? '').toLowerCase();
  } catch {
    return '';
  }
}
