// Compliance backbone for HeyElsie Reviews. Every outbound review request goes
// through these guards. Design constraints (UK PECR / Google policy / DMCC):
//  - send-to-all is the ONLY mode (no sentiment gating exists anywhere)
//  - STOP on any channel suppresses ALL channels for that contact
//  - every SMS carries the business name + an opt-out line; emails get an
//    unsubscribe footer appended automatically
//  - no incentive language in templates
//  - quiet hours: send only inside the business's configured local window

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// --- Phone normalisation (UK-first, mirrors api/tools/send-sms.ts) ---

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = raw.replace(/[\s()-]/g, '');
  if (/^07\d{9}$/.test(p)) p = `+44${p.slice(1)}`;       // UK national mobile
  if (/^447\d{9}$/.test(p)) p = `+${p}`;
  if (/^00/.test(p)) p = `+${p.slice(2)}`;
  if (!/^\+\d{7,15}$/.test(p)) return null;
  return p;
}

// --- Suppression list ---

export async function isSuppressed(businessId: string, opts: { phone?: string | null; email?: string | null }): Promise<boolean> {
  const phone = normalizePhone(opts.phone);
  const email = opts.email?.trim().toLowerCase() || null;
  if (!phone && !email) return false;

  let q = supabase.from('review_suppressions').select('id').eq('business_id', businessId).limit(1);
  if (phone && email) q = q.or(`phone.eq.${phone},email.eq.${email}`);
  else if (phone) q = q.eq('phone', phone);
  else q = q.eq('email', email!);

  const { data } = await q;
  return !!data?.length;
}

export async function addSuppression(businessId: string, opts: {
  phone?: string | null;
  email?: string | null;
  reason: string;
  source: string;
}): Promise<void> {
  const phone = normalizePhone(opts.phone);
  const email = opts.email?.trim().toLowerCase() || null;
  if (!phone && !email) return;

  await supabase.from('review_suppressions').upsert(
    { business_id: businessId, phone, email, reason: opts.reason, source: opts.source },
    { onConflict: phone ? 'business_id,phone' : 'business_id,email', ignoreDuplicates: true },
  );

  // Kill any in-flight requests for this contact, cross-channel.
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id')
    .eq('business_id', businessId)
    .or([phone ? `phone.eq.${phone}` : null, email ? `email.eq.${email}` : null].filter(Boolean).join(','));
  const ids = (contacts ?? []).map((c) => c.id);
  if (ids.length) {
    await supabase
      .from('review_requests')
      .update({ status: 'opted_out', next_send_at: null })
      .eq('business_id', businessId)
      .in('contact_id', ids)
      .in('status', ['queued', 'in_progress']);
  }
}

// --- STOP keyword (mirrors the proven CRM regex) ---

const STOP_RE = /^\s*(stop|stopall|unsubscribe|quit|cancel|end|optout|opt out)[.!]*\s*$/i;

export function isStopMessage(body: string | null | undefined): boolean {
  return !!body && STOP_RE.test(body);
}

// --- Quiet hours ---

/** True if `now` falls inside the business's send window in its own timezone. */
export function insideQuietWindow(settings: { quiet_start: number; quiet_end: number; timezone: string }, now = new Date()): boolean {
  let hour: number;
  try {
    hour = parseInt(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: settings.timezone || 'Europe/London' }).format(now), 10);
  } catch {
    hour = now.getUTCHours();
  }
  return hour >= settings.quiet_start && hour < settings.quiet_end;
}

// --- Monthly cap (tier metering — initial requests only) ---

export function currentPeriodStart(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export async function requestsUsedThisPeriod(businessId: string): Promise<number> {
  const { data } = await supabase
    .from('review_usage')
    .select('requests_sent')
    .eq('business_id', businessId)
    .eq('period_start', currentPeriodStart())
    .maybeSingle();
  return data?.requests_sent ?? 0;
}

export async function incrementUsage(businessId: string, n = 1): Promise<number> {
  const { data, error } = await supabase.rpc('review_usage_increment', {
    b: businessId,
    p: currentPeriodStart(),
    n,
  });
  if (error) throw new Error(`review_usage_increment failed: ${error.message}`);
  return data as number;
}

// --- Template lint (blocks incentive language — Google policy + DMCC) ---

const INCENTIVE_RE = /\b(discount|free\b|prize|voucher|coupon|reward|cashback|refund if|money off|% off|giveaway)\b/i;

export function lintTemplate(template: string): { ok: boolean; error?: string } {
  if (INCENTIVE_RE.test(template)) {
    return { ok: false, error: 'Review requests must not offer incentives (Google policy and UK law). Remove words like "discount", "free", "prize" or "voucher".' };
  }
  if (!template.includes('{review_link}')) {
    return { ok: false, error: 'Template must include the {review_link} variable.' };
  }
  return { ok: true };
}

/** Guarantee the SMS body carries an opt-out line; append one if missing. */
export function ensureSmsOptOut(body: string): string {
  if (/\bSTOP\b/i.test(body)) return body;
  return `${body.trimEnd()} Reply STOP to opt out.`;
}

/** Standard unsubscribe footer appended to every review-request email. */
export function emailFooter(businessName: string, unsubscribeUrl: string): string {
  return `<p style="color:#9ca3af;font-size:12px;margin-top:24px;">You received this because you're a customer of ${businessName}. <a href="${unsubscribeUrl}" style="color:#9ca3af;">Unsubscribe</a> from review requests.</p>`;
}

// --- Twilio webhook signature (HMAC-SHA1, edge-safe Web Crypto; fail closed) ---

export async function validateTwilioSignature(opts: {
  url: string;
  params: Record<string, string>;
  signature: string | null;
  authToken?: string;
}): Promise<boolean> {
  const token = opts.authToken ?? process.env.TWILIO_AUTH_TOKEN;
  if (!token || !opts.signature) return false;

  const data = opts.url + Object.keys(opts.params).sort().map((k) => k + opts.params[k]).join('');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  let b64 = '';
  const bytes = new Uint8Array(mac);
  for (const b of bytes) b64 += String.fromCharCode(b);
  return btoa(b64) === opts.signature;
}

// --- Funnel event log ---

export async function logReviewEvent(opts: {
  businessId: string;
  requestId?: string | null;
  contactId?: string | null;
  type: string;
  channel?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await supabase.from('review_events').insert({
    business_id: opts.businessId,
    request_id: opts.requestId ?? null,
    contact_id: opts.contactId ?? null,
    type: opts.type,
    channel: opts.channel ?? null,
    meta: opts.meta ?? {},
  });
}

// --- Outbound Zapier-style webhooks ---

export async function fireReviewWebhooks(businessId: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const { data: hooks } = await supabase
    .from('review_webhooks')
    .select('url, secret, events')
    .eq('business_id', businessId)
    .eq('active', true);
  await Promise.allSettled(
    (hooks ?? [])
      .filter((h) => (h.events as string[]).includes(event))
      .map((h) =>
        fetch(h.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(h.secret ? { 'x-elsie-secret': h.secret } : {}) },
          body: JSON.stringify({ event, ...payload }),
        }),
      ),
  );
}
