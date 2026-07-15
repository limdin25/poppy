// wk-email-webhook — inbound email webhook from Resend.
// PR 62 (multi-channel PR 3), Hugo 2026-04-27.
//
// Public endpoint (verify_jwt = false). Resend posts here on email.received.
// MX records for the CRM inbound email domain (CRM_INBOUND_EMAIL_DOMAIN
// Supabase secret) point at Resend so inbound CRM email lands in this
// handler. Recipients outside that domain are dropped at intake.
//
// PR 103 (Hugo 2026-04-28): Resend's email.received WEBHOOK payload is
// metadata-only (from, to, subject, email_id) — no html/text. To get
// the body we must call GET /emails/inbound/{email_id}. The earlier
// /emails/{email_id} (outbound store) returns 404 for inbound IDs;
// /emails/inbound/{email_id} is the dedicated inbound endpoint and
// returns html + text + headers + a pre-signed raw MIME download URL.
//
// Signature verification — Svix HMAC-SHA256 over the raw request body:
//   svix-id          → event id
//   svix-timestamp   → ISO 8601
//   svix-signature   → "v1,<base64-sig>" (or comma-list of versions)
//   secret           → from wk_channel_credentials (provider='resend')
//                       or RESEND_WEBHOOK_SECRET env
//   sig_basis        = svix-id + "." + svix-timestamp + "." + raw-body
//
// We verify against the raw body, not parsed JSON, because Svix signs
// the exact bytes Resend sent.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_WEBHOOK_SECRET_ENV = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
// Inbound recipient allowlist domain (e.g. "heyelsie.com"). No default —
// if unset we fail closed rather than accepting (or hardcoding) a domain.
const CRM_INBOUND_EMAIL_DOMAIN = (Deno.env.get('CRM_INBOUND_EMAIL_DOMAIN') ?? '')
  .trim()
  .toLowerCase()
  .replace(/^@/, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ok = (payload: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: true, ...payload }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

interface ResendInboundEvent {
  type?: string;
  created_at?: string;
  // PR 102: Resend's email.received payload carries the full email
  // inline. Fields below cover both the documented shape and minor
  // variations seen in production (string vs object addresses,
  // headers as array vs map).
  data?: {
    email_id?: string;
    id?: string;
    from?: string | { address?: string; name?: string };
    to?: Array<string | { address?: string; name?: string }>;
    subject?: string;
    html?: string;
    text?: string;
    headers?: Array<{ name?: string; value?: string }> | Record<string, string>;
    created_at?: string;
  };
}

interface ResendFullEmail {
  id?: string;
  from?: string | { address?: string; name?: string };
  to?: string[] | Array<{ address?: string }>;
  subject?: string;
  html?: string;
  text?: string;
  created_at?: string;
}

async function loadWebhookSecret(supa: SupabaseClient): Promise<string> {
  const { data } = await supa
    .from('wk_channel_credentials')
    .select('secret')
    .eq('provider', 'resend')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const dbKey = (data as { secret?: string } | null)?.secret ?? '';
  // Env secret first — it's the operator-controlled source of truth; the
  // DB row is only a fallback for workspaces that store it there.
  return RESEND_WEBHOOK_SECRET_ENV || dbKey;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifySvixSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  rawBody: string,
): Promise<boolean> {
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;

  // Svix secrets often arrive prefixed with "whsec_" — strip if present
  // and base64-decode. If decoding fails (custom plain string secret),
  // fall back to using the secret as raw bytes.
  let keyBytes: Uint8Array<ArrayBuffer>;
  const cleaned = secret.replace(/^whsec_/, '');
  try {
    const bin = atob(cleaned);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    keyBytes = bytes;
  } catch {
    keyBytes = new TextEncoder().encode(secret);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = new TextEncoder().encode(`${svixId}.${svixTimestamp}.${rawBody}`);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // svixSignature header may be "v1,sig1 v1,sig2" (space-separated),
  // each entry is "<version>,<base64-sig>". Match any.
  const tokens = svixSignature.split(/\s+/);
  for (const tok of tokens) {
    const [, sigPart] = tok.split(',');
    if (!sigPart) continue;
    const a = new TextEncoder().encode(sigPart);
    const b = new TextEncoder().encode(expected);
    if (timingSafeEqual(a, b)) return true;
  }
  return false;
}

// PR 104 (Hugo 2026-04-28): strip quoted reply history so an inbound
// email body only contains the NEW content, not the entire thread.
//
// Gmail / Outlook / Apple Mail all prefix quoted text with `>` and
// introduce it with patterns like:
//   "On <date> <person> wrote:"           (Gmail, single or wrapped line)
//   "-----Original Message-----"           (Outlook)
//   "From: <person>\nSent: <date>..."     (Outlook variant)
//
// We cut at the first such marker and drop any leading or trailing
// quote-prefixed lines. Conservative — if no marker is recognised,
// we return the text as-is so we never accidentally truncate a real
// reply that happens to contain the word "wrote:".
function stripReplyQuotes(input: string): string {
  if (!input) return '';
  let text = input;

  // 1. Cut at "On ... wrote:" — match across up to ~3 lines because
  //    Gmail often wraps the attribution line.
  const gmailMatch = text.match(/\n[> ]*On [^\n]{0,200}(?:\n[^\n]{0,200}){0,2}wrote:?[ \t]*\n?/);
  if (gmailMatch && gmailMatch.index !== undefined) {
    text = text.slice(0, gmailMatch.index);
  }

  // 2. Cut at "-----Original Message-----" (Outlook).
  text = text.split(/\n-----+\s*Original Message\s*-----+/i)[0];

  // 3. Cut at a "From: ...\nSent: ..." Outlook header pair.
  const outlookHeader = text.match(/\n[> ]*From:[ \t]+.+\n[> ]*(Sent|Date):[ \t]+/);
  if (outlookHeader && outlookHeader.index !== undefined) {
    text = text.slice(0, outlookHeader.index);
  }

  // 4. Drop lines that are pure quote (start with '>' after optional
  //    whitespace). Leaves real reply content intact.
  text = text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');

  // 5. Collapse 3+ blank lines and trim ends.
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

async function findOrCreateContact(
  supa: SupabaseClient,
  email: string,
  contactName: string,
  firstEmailId: string,
): Promise<string | null> {
  const { data: existing } = await supa
    .from('wk_contacts')
    .select('id')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if ((existing as { id?: string } | null)?.id) {
    return (existing as { id: string }).id;
  }

  const { data: inserted, error: insErr } = await supa
    .from('wk_contacts')
    .insert({
      name: contactName || email,
      email,
      phone: `email:${email}`, // wk_contacts.phone is UNIQUE NOT NULL — synthesise a non-conflicting placeholder
      owner_agent_id: null,
      pipeline_column_id: null,
      custom_fields: {
        source: 'inbound_email',
        first_email_id: firstEmailId,
      },
      is_hot: false,
    })
    .select('id')
    .single();

  if (insErr || !(inserted as { id?: string } | null)?.id) {
    console.error('[wk-email-webhook] wk_contacts insert failed', insErr);
    return null;
  }
  return (inserted as { id: string }).id;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Read raw body once — we need it for signature verification AND for
  // JSON parse. After this point, req.body is consumed.
  const rawBody = await req.text();
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Signature verification (best-effort — log + drop on mismatch).
  const svixId = req.headers.get('svix-id') ?? '';
  const svixTs = req.headers.get('svix-timestamp') ?? '';
  const svixSig = req.headers.get('svix-signature') ?? '';
  const secret = await loadWebhookSecret(supa);

  if (secret) {
    const valid = await verifySvixSignature(secret, svixId, svixTs, svixSig, rawBody);
    if (!valid) {
      console.error(
        `[wk-email-webhook] INVALID Svix signature — dropping event. svix-id=${svixId} ts=${svixTs}`,
      );
      // PR 100 (Hugo 2026-04-28): was returning 200 here so Resend wouldn't
      // retry. That meant any inbound email that arrived during a secret-
      // mismatch window was silently lost forever (Hugo's reply on
      // 2026-04-28 was lost this way). Now returns 401 so Resend retries
      // with backoff while we fix the secret. Resend caps retries at a few
      // attempts over hours; if the secret stays broken past that, it'll
      // dead-letter — which is still correct behaviour for a sustained
      // misconfiguration.
      return new Response(
        JSON.stringify({ error: 'invalid signature' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  } else {
    // Fail closed — with no secret we cannot verify the sender, and
    // accepting would let anyone inject wk_contacts / wk_sms_messages rows.
    console.error('[wk-email-webhook] no webhook secret configured — rejecting (fail closed)');
    return new Response(
      JSON.stringify({ error: 'webhook secret not configured' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let event: ResendInboundEvent;
  try {
    event = JSON.parse(rawBody) as ResendInboundEvent;
  } catch {
    return ok({ note: 'invalid json — accepted to stop retries' });
  }

  if (event.type !== 'email.received') {
    console.log(`[wk-email-webhook] ignoring event type=${event.type}`);
    return ok({ note: 'ignored event type' });
  }

  const d = event.data ?? {};
  // Resend has used both `email_id` and `id` for the inbound email
  // identifier. Either is fine — we just need it for idempotency.
  const emailId = d.email_id || d.id || '';
  if (!emailId) {
    console.warn('[wk-email-webhook] missing email_id in event payload');
    return ok({ note: 'no email_id' });
  }

  // PR 102: extract from/to/subject/body from the payload directly.
  // Earlier code did a GET /emails/{id} which is outbound-only —
  // returned 404 for inbound IDs and dropped every inbound message.
  const fromRaw = d.from;
  const fromAddr =
    typeof fromRaw === 'string'
      ? fromRaw
      : (fromRaw?.address ?? '');
  const fromName =
    typeof fromRaw === 'string' ? '' : (fromRaw?.name ?? '');

  let toAddr = '';
  if (Array.isArray(d.to) && d.to.length > 0) {
    const first = d.to[0];
    toAddr = typeof first === 'string' ? first : (first?.address ?? '');
  }

  const fromEmail = fromAddr.toLowerCase().trim();
  if (!fromEmail) {
    console.warn('[wk-email-webhook] missing from address in payload', JSON.stringify(d).slice(0, 300));
    return ok({ note: 'no from' });
  }

  // Only accept emails delivered to the configured CRM inbound domain
  // (CRM_INBOUND_EMAIL_DOMAIN). Resend's MX can also catch other domains
  // pointed at it (DMARC reports, postmaster bounces) — drop those at
  // webhook intake so the CRM only ever sees its own domain's traffic.
  // If the env var is unset, fail closed instead of guessing a domain.
  if (!CRM_INBOUND_EMAIL_DOMAIN) {
    console.error('[wk-email-webhook] CRM_INBOUND_EMAIL_DOMAIN not set — rejecting event');
    return new Response(
      JSON.stringify({ error: 'CRM_INBOUND_EMAIL_DOMAIN not configured' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
  const toEmail = toAddr.toLowerCase().trim();
  if (!toEmail.endsWith(`@${CRM_INBOUND_EMAIL_DOMAIN}`)) {
    console.log(`[wk-email-webhook] dropping recipient outside ${CRM_INBOUND_EMAIL_DOMAIN}: ${toEmail}`);
    return ok({ note: 'recipient outside CRM inbound domain — dropped', to: toEmail });
  }

  const subject = d.subject ?? '';

  // PR 103: fetch html + text from the dedicated inbound endpoint.
  // Resend's email.received webhook payload is metadata-only.
  let html = '';
  let text = '';
  if (RESEND_API_KEY) {
    try {
      const r = await fetch(
        `https://api.resend.com/emails/inbound/${emailId}`,
        { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } },
      );
      if (r.ok) {
        const full = (await r.json()) as { html?: string; text?: string };
        html = full.html ?? '';
        text = full.text ?? '';
      } else {
        const errText = await r.text();
        console.warn(
          `[wk-email-webhook] inbound body fetch ${r.status}: ${errText.slice(0, 200)}`,
        );
      }
    } catch (e) {
      console.error('[wk-email-webhook] inbound body fetch threw', e);
    }
  } else {
    console.warn('[wk-email-webhook] RESEND_API_KEY missing — body will be empty');
  }
  const rawBodyText = text || html.replace(/<[^>]+>/g, '');
  // PR 104: strip quoted history so the inbox shows only the new reply.
  const bodyText = stripReplyQuotes(rawBodyText);

  const contactId = await findOrCreateContact(supa, fromEmail, fromName, emailId);
  if (!contactId) return ok({ note: 'contact resolution failed' });

  const { error: msgErr } = await supa
    .from('wk_sms_messages')
    .insert({
      contact_id: contactId,
      direction: 'inbound',
      channel: 'email',
      body: bodyText,
      external_id: emailId,
      subject,
      from_e164: fromEmail,
      to_e164: toAddr || null,
      media_urls: [],
      status: 'received',
    });

  if (msgErr) {
    const code = (msgErr as { code?: string }).code;
    if (code === '23505') {
      console.log(`[wk-email-webhook] duplicate email_id=${emailId} — idempotent skip`);
    } else {
      console.error('[wk-email-webhook] insert failed', msgErr);
    }
  } else {
    await supa
      .from('wk_contacts')
      .update({ last_contact_at: new Date().toISOString() })
      .eq('id', contactId);
  }

  return ok({ saved: !msgErr, email_id: emailId });
});
