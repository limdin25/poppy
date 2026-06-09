import { createClient } from '@supabase/supabase-js';
import { stripHtml, cleanEmailBody, isEmailSpam, normalizeSubject } from '../lib/email-utils.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';

export const config = { runtime: 'edge' };

// ── Svix signature verification (Web Crypto — no Node Buffer) ──────────────
// Resend signs webhooks with Svix: headers svix-id / svix-timestamp /
// svix-signature; the signed content is `${id}.${timestamp}.${rawBody}`,
// HMAC-SHA256 with the secret (base64 after a `whsec_` prefix). The signature
// header is a space-separated list of `v1,<base64sig>` — accept if ANY matches.
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySvix(rawBody: string, headers: Headers): Promise<boolean> {
  // No secret set yet → process anyway (lets us confirm delivery before locking
  // down), same tolerant pattern as the Unipile webhook.
  if (!RESEND_WEBHOOK_SECRET) {
    console.warn('[resend-inbound] RESEND_WEBHOOK_SECRET unset — skipping signature check');
    return true;
  }
  const id = headers.get('svix-id') || '';
  const timestamp = headers.get('svix-timestamp') || '';
  const sigHeader = headers.get('svix-signature') || '';
  if (!id || !timestamp || !sigHeader) return false;

  // Replay guard — Svix tolerance is 5 minutes.
  const ts = parseInt(timestamp, 10);
  if (Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretB64 = RESEND_WEBHOOK_SECRET.replace(/^whsec_/, '');
  const keyBytes = base64ToBytes(secretB64);
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = bytesToBase64(new Uint8Array(sig));

  return sigHeader.split(' ').some((part) => {
    const [version, value] = part.split(',');
    return version === 'v1' && !!value && timingSafeEqual(value, expected);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function extractEmail(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

function parseFrom(raw: string): { email: string; name: string } {
  const email = extractEmail(raw);
  let name = '';
  if (raw && raw.includes('<')) {
    name = raw.slice(0, raw.indexOf('<')).trim().replace(/^"|"$/g, '');
  }
  return { email, name: name || email };
}

// Recipient lists can be string[] or {email|address|identifier}[]; normalise to emails.
function toEmailList(to: any): string[] {
  if (!to) return [];
  const arr = Array.isArray(to) ? to : [to];
  return arr
    .map((x) => (typeof x === 'string' ? extractEmail(x) : extractEmail(x?.email || x?.address || x?.identifier || '')))
    .filter(Boolean);
}

// Headers arrive as either [{name,value}] or a plain object; key by lowercase name.
function headerMap(headers: any): Record<string, string> {
  const map: Record<string, string> = {};
  if (!headers) return map;
  if (Array.isArray(headers)) {
    for (const h of headers) {
      const k = (h?.name || h?.key || '').toString().toLowerCase();
      if (k) map[k] = (h?.value ?? h?.val ?? '').toString();
    }
  } else if (typeof headers === 'object') {
    for (const k of Object.keys(headers)) map[k.toLowerCase()] = (headers as any)[k]?.toString?.() ?? '';
  }
  return map;
}

function normMsgId(raw: string): string {
  return (raw || '').replace(/[<>]/g, '').trim().toLowerCase();
}

function parseRefs(raw: string): string[] {
  return (raw || '').split(/\s+/).map(normMsgId).filter(Boolean);
}

async function fetchReceivedEmail(id: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${id}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Handler ─────────────────────────────────────────────────────────────--
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const rawBody = await req.text();
  if (!(await verifySvix(rawBody, req.headers).catch(() => false))) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400 });
  }

  if (event?.type !== 'email.received') {
    return new Response(JSON.stringify({ ok: true, skipped: event?.type || 'unknown' }), { status: 200 });
  }

  try {
    const data = event.data || {};
    const receivedId = data.email_id || data.id || data.received_email_id || '';
    if (!receivedId) {
      return new Response(JSON.stringify({ ok: true, note: 'no received-email id' }), { status: 200 });
    }

    // The webhook carries metadata only — fetch the full email for the body.
    const email = await fetchReceivedEmail(receivedId);
    if (!email) {
      // GET can lag the webhook slightly; 502 makes Resend retry (dedup guards us).
      return new Response(JSON.stringify({ error: 'received email not retrievable yet' }), { status: 502 });
    }

    const toList = toEmailList(email.to ?? data.to);
    const { email: fromEmail, name: fromName } = parseFrom(email.from ?? data.from ?? '');
    const subject = email.subject ?? data.subject ?? '';
    const htmlBody: string = email.html || '';
    const plainBody: string = email.text || (htmlBody.includes('<') ? stripHtml(htmlBody) : htmlBody);
    const emailText = cleanEmailBody(plainBody);
    const createdAt = email.created_at || data.created_at || new Date().toISOString();

    const hdrs = headerMap(email.headers);
    const messageId = normMsgId(hdrs['message-id'] || email.message_id || '');
    const inReplyTo = normMsgId(hdrs['in-reply-to'] || '');
    const references = parseRefs(hdrs['references'] || '');
    const candidateParents = [inReplyTo, ...references].filter(Boolean);

    if (!fromEmail) {
      return new Response(JSON.stringify({ ok: true, note: 'no sender' }), { status: 200 });
    }

    // ── Resolve channel + business by recipient domain ──────────────────────
    let channel: any = null;
    for (const addr of toList) {
      const domain = (addr.split('@')[1] || '').toLowerCase();
      if (!domain) continue;
      const { data: ch } = await supabase
        .from('channels')
        .select('id, business_id, agent_id, auto_reply_enabled, config')
        .eq('status', 'connected')
        .contains('config', { provider: 'resend', domain })
        .limit(1)
        .maybeSingle();
      if (ch) { channel = ch; break; }
    }
    if (!channel) {
      return new Response(JSON.stringify({ ok: true, note: 'no Resend channel for recipient domain', to: toList }), { status: 200 });
    }

    const businessId = channel.business_id as string;
    const autoReply = channel.auto_reply_enabled === true;

    // The address at OUR end this email was sent to (the alias on the send-as
    // domain) — shown in the Inbox and used by the per-inbox filter.
    const channelDomain = ((channel.config as Record<string, unknown>)?.domain as string || '').toLowerCase();
    const receivedAddress =
      toList.find((a: string) => a.toLowerCase().endsWith(`@${channelDomain}`)) || toList[0] || null;

    // ── Find or create contact by sender email ─────────────────────────────
    let contactId: string | null = null;
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('email', fromEmail)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      if (fromName && fromName !== fromEmail && !existingContact.name) {
        await supabase.from('contacts').update({ name: fromName }).eq('id', contactId);
      }
    } else {
      const { data: newContact } = await supabase
        .from('contacts')
        .insert({ business_id: businessId, email: fromEmail, name: fromName || fromEmail })
        .select('id')
        .single();
      contactId = newContact?.id || null;
    }
    if (!contactId) {
      return new Response(JSON.stringify({ ok: true, note: 'no contact' }), { status: 200 });
    }

    // ── Threading: header reply-match → contact's open thread → new ─────────
    let conversationId: string | null = null;
    let convoAiHandling = true;

    for (const parent of candidateParents) {
      const { data: pm } = await supabase
        .from('messages')
        .select('conversation_id')
        .contains('metadata', { message_id: parent })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pm?.conversation_id) {
        const { data: conv } = await supabase
          .from('conversations')
          .select('id, ai_handling, business_id, channel')
          .eq('id', pm.conversation_id)
          .maybeSingle();
        if (conv && conv.business_id === businessId && conv.channel === 'email') {
          conversationId = conv.id;
          convoAiHandling = conv.ai_handling !== false;
          break;
        }
      }
    }

    const normalSub = normalizeSubject(subject);

    if (!conversationId) {
      const { data: byContact } = await supabase
        .from('conversations')
        .select('id, ai_handling')
        .eq('business_id', businessId)
        .eq('contact_id', contactId)
        .eq('channel', 'email')
        .eq('status', 'open')
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byContact) {
        conversationId = byContact.id;
        convoAiHandling = byContact.ai_handling !== false;
      }
    }

    let createdConversation = false;
    if (!conversationId) {
      const { data: newConvo } = await supabase
        .from('conversations')
        .insert({
          business_id: businessId,
          contact_id: contactId,
          agent_id: channel.agent_id || null,
          channel: 'email',
          status: 'open',
          ai_handling: true,
          subject: normalSub || null,
          email_thread_id: messageId || receivedId || null,
          received_address: receivedAddress,
          unread_count: 1,
        })
        .select('id')
        .single();
      conversationId = newConvo?.id || null;
      createdConversation = true;
    }
    if (!conversationId) {
      return new Response(JSON.stringify({ ok: true, note: 'no conversation' }), { status: 200 });
    }

    // ── Idempotency: Resend retries webhooks ───────────────────────────────
    const { data: dupRows } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .contains('metadata', { external_id: receivedId })
      .limit(1);
    if (dupRows?.[0]) {
      return new Response(JSON.stringify({ ok: true, note: 'duplicate' }), { status: 200 });
    }

    // ── Spam + insert ──────────────────────────────────────────────────────
    const spam = isEmailSpam(fromEmail, subject, emailText, htmlBody);
    const preview = emailText.slice(0, 100);

    const { data: insertedMsg } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'inbound',
      sender: 'contact',
      content_type: 'text',
      body: emailText.slice(0, 10000) || null,
      metadata: {
        sender_email: fromEmail,
        sender_name: fromName,
        subject,
        external_id: receivedId,
        message_id: messageId,
        in_reply_to: inReplyTo || null,
        to_attendees: toList,
        is_spam: spam,
        via: 'resend_inbound',
      },
      created_at: createdAt,
    }).select('id').single();

    // Bump unread for existing threads (a freshly created one starts at 1).
    let nextUnread: number | undefined;
    if (!createdConversation) {
      const { data: convRow } = await supabase
        .from('conversations')
        .select('unread_count')
        .eq('id', conversationId)
        .single();
      nextUnread = (convRow?.unread_count ?? 0) + 1;
    }

    await supabase
      .from('conversations')
      .update({
        last_message_at: createdAt,
        last_message_preview: preview,
        ...(receivedAddress ? { received_address: receivedAddress } : {}),
        ...(nextUnread !== undefined ? { unread_count: nextUnread } : {}),
      })
      .eq('id', conversationId);

    if (spam) {
      await supabase.from('conversations').update({ is_spam: true } as any).eq('id', conversationId);
      return new Response(JSON.stringify({ ok: true, spam: true, conversation_id: conversationId }), { status: 200 });
    }

    // Non-spam: rescue a thread that was previously (mis)flagged as spam so the
    // legit reply becomes visible again. Conditional — only writes when flagged.
    await supabase
      .from('conversations')
      .update({ is_spam: false } as any)
      .eq('id', conversationId)
      .eq('is_spam', true);

    // ── Queue AI takeover (same contract as the email poll) ────────────────
    if (emailText && autoReply && convoAiHandling && insertedMsg?.id) {
      const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
      fetch(`${appUrl}/api/messages/queue-takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          conversation_id: conversationId,
          message_id: insertedMsg.id,
          channel: 'email',
          received_at: new Date().toISOString(),
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, inserted: true, conversation_id: conversationId }), { status: 200 });
  } catch (err: any) {
    console.error('[resend-inbound]', err?.message || err);
    return new Response(JSON.stringify({ error: 'internal error' }), { status: 500 });
  }
}
