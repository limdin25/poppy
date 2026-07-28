// Auto-send — the second half of "make their video and send when ready".
//
// Hugo 2026-07-27: the agent arms the send while they are still on the phone,
// then hangs up and dials the next lead. Ten minutes later the VPS worker
// finishes the render and nobody is watching. This cron is what watches.
//
// Runs every minute (vercel.json): a render that lands must not sit in a queue
// for five, because the whole promise to the lead was "it's on its way now".
//
// Node (req,res) runtime on purpose — the edge Request shape throws at runtime
// in this directory (caught in production on daily-agent-reports, 2026-07-24).

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import {
  getVslSettings,
  insideQuietHours,
  agentSmsLine,
  advanceVslState,
} from '../lib/vsl-settings.js';
import { autoSendDecision, type AutoSendChannel } from '../lib/vsl-auto-send.js';
import { notifyFunnelEvent } from '../lib/vsl-notify.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { maxDuration: 60 };

/** Small enough that a stuck channel can't eat the minute, large enough that a
 *  whole team's calls landing at once still clear in one pass. */
const BATCH = 25;

// A `type`, not an `interface`: advanceVslState/notifyFunnelEvent take
// `… & Record<string, unknown>`, and only type aliases get the implicit index
// signature that satisfies it.
type ArmedPage = {
  id: string;
  slug: string;
  contact_id: string;
  agent_id: string;
  state: string;
  render_status: 'queued' | 'rendering' | 'ready' | 'failed' | null;
  video_url: string | null;
  auto_send_channel: AutoSendChannel | null;
  auto_send_armed_at: string | null;
  auto_send_body: string | null;
  auto_send_subject: string | null;
  business_name: string;
  owner_first: string | null;
};

// Same normaliser as wk-sms-send — UK national (07…) → +44 or Twilio 21211s.
function normalizeE164(raw: string): string {
  const s = (raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return `+${s.slice(2)}`;
  if (s.startsWith('0')) return `+44${s.slice(1)}`;
  return `+${s}`;
}

async function sendSms(from: string, to: string, body: string): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`twilio ${res.status}: ${text.slice(0, 180)}`);
  return (JSON.parse(text) as { sid?: string }).sid ?? '';
}

async function sendEmail(from: string, to: string, subject: string, body: string): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text: body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`resend ${res.status}: ${text.slice(0, 180)}`);
  return (JSON.parse(text) as { id?: string }).id ?? '';
}

async function sendWhatsapp(accountId: string, to: string, body: string): Promise<string> {
  const token = process.env.UNIPILE_TOKEN;
  const dsn = process.env.UNIPILE_DSN;
  if (!token || !dsn) throw new Error('UNIPILE_TOKEN/DSN not configured');
  const res = await fetch(`https://${dsn}/api/v1/chats`, {
    method: 'POST',
    headers: { 'X-API-KEY': token, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ account_id: accountId, attendees_ids: [to], text: body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`unipile ${res.status}: ${text.slice(0, 180)}`);
  const j = JSON.parse(text) as { message_id?: string; chat_id?: string; id?: string };
  return j.message_id ?? j.chat_id ?? j.id ?? '';
}

/** The from-address for email: a paired wk_numbers row first, then the
 *  workspace default. No hardcoded fallback — sending review-brand mail from an
 *  unverified domain is worse than not sending it. */
async function emailFromLine(): Promise<string | null> {
  const { data } = await supabase
    .from('wk_numbers')
    .select('e164')
    .eq('channel', 'email')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.e164 || process.env.CRM_EMAIL_FROM || process.env.EMAIL_FROM || null;
}

async function whatsappAccount(): Promise<string | null> {
  const { data } = await supabase
    .from('wk_numbers')
    .select('external_id')
    .eq('channel', 'whatsapp')
    .eq('provider', 'unipile')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.external_id || null;
}

/** Send on the armed channel and record it in the same table the inbox reads —
 *  a text the next person to open this lead cannot see is, to them, a text that
 *  never happened. Throws on any failure; the caller records why. */
async function deliver(
  page: ArmedPage,
  channel: AutoSendChannel,
  contact: { phone: string | null; email: string | null },
  body: string,
  subject: string | null,
): Promise<void> {
  if (channel === 'sms' || channel === 'whatsapp') {
    const to = normalizeE164(contact.phone || '');
    if (!to) throw new Error('no_destination');

    if (channel === 'sms') {
      const from = await agentSmsLine(page.agent_id);
      if (!from) throw new Error('no_from_number');
      // Insert BEFORE the provider call: a lost response must not let a retry
      // re-send. There is no retry here, but the row is the audit trail.
      const { data: row } = await supabase.from('wk_sms_messages').insert({
        contact_id: page.contact_id, direction: 'outbound', channel: 'sms', body,
        from_e164: from, to_e164: to, status: 'sending', created_by: page.agent_id,
      }).select('id').single();
      try {
        const sid = await sendSms(from, to, body);
        await supabase.from('wk_sms_messages').update({
          twilio_sid: sid || null, external_id: sid || null, status: sid ? 'sent' : 'queued',
        }).eq('id', row!.id);
      } catch (e) {
        await supabase.from('wk_sms_messages').update({ status: 'failed' }).eq('id', row!.id);
        throw e;
      }
      return;
    }

    const account = await whatsappAccount();
    if (!account) throw new Error('whatsapp_not_connected');
    const id = await sendWhatsapp(account, to, body);
    await supabase.from('wk_sms_messages').insert({
      contact_id: page.contact_id, direction: 'outbound', channel: 'whatsapp', body,
      from_e164: '', to_e164: to, status: 'sent', external_id: id || null,
      created_by: page.agent_id,
    });
    return;
  }

  const to = (contact.email || '').trim();
  if (!to) throw new Error('no_destination');
  const from = await emailFromLine();
  if (!from) throw new Error('no_email_from');
  const subj = (subject || '').trim() || `Your 2-minute video for ${page.business_name}`;
  const id = await sendEmail(from, to, subj, body);
  await supabase.from('wk_sms_messages').insert({
    contact_id: page.contact_id, direction: 'outbound', channel: 'email', body,
    subject: subj, from_e164: from, to_e164: to, status: 'sent',
    external_id: id || null, created_by: page.agent_id,
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const settings = await getVslSettings();
  const now = new Date();
  const ctx = {
    now,
    funnelEnabled: settings.enabled,
    insideHours: insideQuietHours(settings, now),
    hasDefaultVideo: !!settings.default_video_url,
  };

  const { data: armed } = await supabase
    .from('wk_vsl_pages')
    .select('id, slug, contact_id, agent_id, state, render_status, video_url, auto_send_channel, auto_send_armed_at, auto_send_body, auto_send_subject, business_name, owner_first')
    .not('auto_send_channel', 'is', null)
    .order('auto_send_armed_at', { ascending: true })
    .limit(BATCH);

  const tally = { sent: 0, waiting: 0, dropped: 0, failed: 0 };

  for (const p of (armed || []) as ArmedPage[]) {
    const verdict = autoSendDecision(p, ctx);

    if (verdict.action === 'wait') { tally.waiting++; continue; }

    if (verdict.action === 'abort') {
      // Disarm and say why. A silently forgotten arm is the agent believing a
      // text went out when it never did.
      await supabase.from('wk_vsl_pages')
        .update({ auto_send_channel: null, auto_send_error: verdict.reason })
        .eq('id', p.id);
      tally.dropped++;
      continue;
    }

    // CLAIM: clear the arm in an UPDATE that still filters on it being set, so
    // two overlapping cron runs cannot both send. Nothing below re-arms — a
    // failure here leaves the error on the page and the agent sends by hand,
    // which is the cheaper mistake of the two.
    const { data: claimed } = await supabase
      .from('wk_vsl_pages')
      .update({ auto_send_channel: null, auto_send_error: null })
      .eq('id', p.id)
      .not('auto_send_channel', 'is', null)
      .select('id')
      .maybeSingle();
    if (!claimed) { tally.waiting++; continue; }

    const { data: contact } = await supabase
      .from('wk_contacts')
      .select('phone, email')
      .eq('id', p.contact_id)
      .maybeSingle();

    const body = (p.auto_send_body || '').trim();
    if (!contact || !body) {
      await supabase.from('wk_vsl_pages')
        .update({ auto_send_error: !contact ? 'no_contact' : 'no_body' })
        .eq('id', p.id);
      tally.dropped++;
      continue;
    }

    try {
      await deliver(p, p.auto_send_channel!, contact, body, p.auto_send_subject);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[vsl-auto-send] send failed', p.slug, msg);
      await supabase.from('wk_vsl_pages')
        .update({ auto_send_error: `send_failed:${msg}`.slice(0, 300) })
        .eq('id', p.id);
      tally.failed++;
      continue;
    }

    // Only now is the page genuinely 'sent'.
    const adv = await advanceVslState(p, 'sent');
    if (adv?.advanced) await notifyFunnelEvent({ page: p, kind: 'vsl_sent' });
    await supabase.from('wk_vsl_events').insert({
      page_id: p.id,
      type: 'auto_sms',
      meta: { source: 'auto_send', channel: p.auto_send_channel },
    });
    tally.sent++;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, ...tally }));
}
