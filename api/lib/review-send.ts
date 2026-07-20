// Shared composition + scheduling logic for the review-request engine.
// Used by the send cron, campaign enqueue, and test-send.

import { callLLM } from './llm.js';
import { ensureSmsOptOut, emailFooter } from './review-guards.js';

export interface SendSettings {
  smart_messaging: boolean;
  sms_template: string | null;
  email_subject: string | null;
  email_template: string | null;
  followup_template: string | null;
  owner_first_name: string | null;
  followups_enabled: boolean;
  followup_count: number;
  followup_gap_days: number;
  drip_per_day: number;
  quiet_start: number;
  quiet_end: number;
  timezone: string;
}

export const DEFAULT_SMS_TEMPLATE =
  'Hey {first_name}, thanks for choosing {business_name}! Would you mind leaving us a quick Google review? It only takes a minute and really helps: {review_link}';
export const DEFAULT_FOLLOWUP_TEMPLATE =
  'Hey {first_name}, just a quick follow-up from {business_name} — we’d really appreciate your feedback! {review_link}';
export const DEFAULT_EMAIL_SUBJECT = 'Quick favour, {first_name}?';

export function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(first_name|business_name|owner_name|review_link)\}/g, (_, k) => vars[k] ?? '');
}

/** Compose the SMS body for an initial request or a follow-up. */
export async function composeSmsBody(opts: {
  settings: SendSettings;
  businessName: string;
  firstName: string;
  reviewLink: string;
  isFollowup: boolean;
}): Promise<string> {
  const vars = {
    first_name: opts.firstName,
    business_name: opts.businessName,
    owner_name: opts.settings.owner_first_name ?? '',
    review_link: opts.reviewLink,
  };

  if (opts.isFollowup) {
    return ensureSmsOptOut(substitute(opts.settings.followup_template || DEFAULT_FOLLOWUP_TEMPLATE, vars));
  }

  if (!opts.settings.smart_messaging) {
    return ensureSmsOptOut(substitute(opts.settings.sms_template || DEFAULT_SMS_TEMPLATE, vars));
  }

  // Smart messaging: Claude writes the ask. Must keep the literal {review_link}
  // token so we control the URL; falls back to the default template if it doesn't.
  const system = `You write ONE short SMS asking a customer for a Google review on behalf of a UK service business. Rules: UK English; warm and human, never corporate; address the customer by first name; mention the business name; include the literal token {review_link} exactly once where the link should go; NEVER offer any incentive, discount or reward; no emojis; no hashtags; max 300 characters; output ONLY the message text.`;
  const user = `Business: ${opts.businessName}. Customer first name: ${opts.firstName}.${opts.settings.owner_first_name ? ` Owner first name: ${opts.settings.owner_first_name}.` : ''}`;
  const generated = (await callLLM('claude-sonnet-4-6', system, [{ role: 'user', content: user }], 200)).trim();

  const body = generated.includes('{review_link}')
    ? substitute(generated, vars)
    : substitute(DEFAULT_SMS_TEMPLATE, vars);
  return ensureSmsOptOut(body);
}

/** Compose the review-request email (subject + html). */
export function composeEmail(opts: {
  settings: SendSettings;
  businessName: string;
  firstName: string;
  reviewLink: string;
  imageUrl: string | null;
  unsubscribeUrl: string;
  isFollowup: boolean;
}): { subject: string; html: string } {
  const vars = {
    first_name: opts.firstName,
    business_name: opts.businessName,
    owner_name: opts.settings.owner_first_name ?? '',
    review_link: opts.reviewLink,
  };
  const subject = substitute(
    opts.isFollowup ? `Quick reminder from ${opts.businessName}` : (opts.settings.email_subject || DEFAULT_EMAIL_SUBJECT),
    vars,
  );
  const bodyText = substitute(
    opts.isFollowup
      ? (opts.settings.followup_template || DEFAULT_FOLLOWUP_TEMPLATE)
      : (opts.settings.email_template || opts.settings.sms_template || DEFAULT_SMS_TEMPLATE),
    { ...vars, review_link: '' },
  ).trim();

  const html = `
  <div style="font-family:sans-serif;line-height:1.6;color:#1c1c28;max-width:520px;margin:0 auto;">
    ${opts.imageUrl ? `<img src="${opts.imageUrl}" alt="${opts.businessName}" style="width:100%;border-radius:12px;margin-bottom:16px;"/>` : ''}
    <p style="font-size:16px;">${bodyText}</p>
    <p style="margin:24px 0;">
      <a href="${opts.reviewLink}" style="background:#3C5A87;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">Leave a review</a>
    </p>
    <p style="color:#6b7280;font-size:14px;">Thanks so much — it really helps.${opts.settings.owner_first_name ? `<br/>— ${opts.settings.owner_first_name}, ${opts.businessName}` : `<br/>— ${opts.businessName}`}</p>
    ${emailFooter(opts.businessName, opts.unsubscribeUrl)}
  </div>`;
  return { subject, html };
}

// --- Quiet-window / drip scheduling ---

export function localHour(timezone: string, at: Date): number {
  try {
    return parseInt(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: timezone || 'Europe/London' }).format(at), 10);
  } catch {
    return at.getUTCHours();
  }
}

export function insideWindowAt(settings: Pick<SendSettings, 'quiet_start' | 'quiet_end' | 'timezone'>, at: Date): boolean {
  const h = localHour(settings.timezone, at);
  return h >= settings.quiet_start && h < settings.quiet_end;
}

/** Next moment the send window opens at/after `from` (hour granularity). */
export function nextWindowOpen(settings: Pick<SendSettings, 'quiet_start' | 'quiet_end' | 'timezone'>, from: Date): Date {
  const h = localHour(settings.timezone, from);
  let hoursAhead: number;
  if (h < settings.quiet_start) hoursAhead = settings.quiet_start - h;
  else hoursAhead = 24 - h + settings.quiet_start;
  const d = new Date(from.getTime() + hoursAhead * 3600_000);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** Staggered ISO timestamps for `count` sends honouring drip pace + window. */
export function scheduleSlots(settings: SendSettings, count: number, now = new Date()): string[] {
  const perDay = Math.max(1, settings.drip_per_day);
  const windowMinutes = Math.max(60, (settings.quiet_end - settings.quiet_start) * 60);
  const spacing = Math.max(2, Math.floor(windowMinutes / perDay));
  const slots: string[] = [];
  let cursor = insideWindowAt(settings, now) ? new Date(now) : nextWindowOpen(settings, now);
  let usedToday = 0;
  for (let i = 0; i < count; i++) {
    if (usedToday >= perDay || !insideWindowAt(settings, cursor)) {
      cursor = nextWindowOpen(settings, cursor);
      usedToday = 0;
    }
    slots.push(cursor.toISOString());
    cursor = new Date(cursor.getTime() + spacing * 60_000);
    usedToday++;
  }
  return slots;
}

export function randomToken(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

export function firstNameOf(fullName: string | null | undefined): string | null {
  const t = fullName?.trim().split(/\s+/)[0];
  if (!t || t.length < 2) return null;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}
