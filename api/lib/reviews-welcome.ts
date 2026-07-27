// The email a reviews buyer gets after paying. Before this file existed they
// got nothing at all — charged £1, redirected to a page that asked for their
// email again, with no receipt, no credentials and no way back in if they
// closed the tab.
//
// SEND STRATEGY — inline attempt + cron sweeper, never inline-only.
// sendEmail THROWS on a Resend 429 (src/integrations/resend/client.ts:41). If
// that throw propagated out of the Stripe webhook the webhook would 500,
// Stripe would retry, the provisioning ledger would short-circuit ("already
// done"), and the welcome email would never be sent — for that customer,
// forever. So callers .catch() the inline attempt and drainReviewsWelcome()
// picks up anything that didn't land, from the existing every-minute
// /api/cron/notify-drain.
//
// The stamp (review_settings.welcome_email_sent_at) is written ONLY on a
// successful send, so it doubles as the idempotency key.

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../src/integrations/resend/client.js';
import { REVIEW_PLANS, TRIAL_DAYS, planByKey } from './review-plans.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const GO_URL = process.env.GO_APP_URL || 'https://go.heyelsie.com';

function firstName(name: string | null | undefined, email: string): string {
  const n = (name || '').trim().split(/\s+/)[0];
  return n || email.split('@')[0];
}

function chargeDate(): string {
  const d = new Date(Date.now() + TRIAL_DAYS * 86400000);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function welcomeHtml(opts: {
  first: string;
  business: string;
  planName: string;
  priceGbp: number;
  requests: number;
  actionLink: string | null;
}): string {
  const { first, business, planName, priceGbp, requests, actionLink } = opts;
  const cta = actionLink
    ? `<p style="margin:24px 0;"><a href="${actionLink}" style="background:#3C5A87;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">Set your password &amp; finish setup</a></p>`
    // No password to recover — "use Forgot password" would be a dead end for a
    // buyer who never set one. Point at the code door instead.
    : `<p style="margin:24px 0;"><a href="${GO_URL}/continue" style="background:#3C5A87;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">Finish setting up</a></p>`;

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#1c1c28;max-width:520px;margin:0 auto;">
    <h2 style="font-size:22px;margin:0 0 8px;">Welcome to HeyElsie Reviews, ${first} 👋</h2>
    <p style="margin:0 0 16px;">Your £1 is in and your ${TRIAL_DAYS}-day trial has started for <strong>${business}</strong>.</p>
    ${cta}
    <p style="margin:0 0 6px;"><strong>What happens next</strong></p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#374151;">
      <li>We're assigning your dedicated UK sending number — usually the same day.</li>
      <li>Connect your Google Business Profile from your dashboard, and upload your customer list.</li>
      <li>Your first review requests go out as soon as those two are done.</li>
    </ul>
    <div style="background:#f6f7f9;border-radius:8px;padding:14px 16px;margin:0 0 20px;color:#374151;font-size:14px;">
      <strong>Your plan:</strong> ${planName} — up to ${requests} review requests a month.<br>
      <strong>After your trial:</strong> £${priceGbp} + VAT a month, first charged on ${chargeDate()}.<br>
      Cancel any time before then from Billing and you won't be charged.
    </div>
    <p style="color:#6b7280;font-size:13px;margin:0 0 4px;">
      Signing in later? Go to <a href="${GO_URL}/continue" style="color:#3C5A87;">${GO_URL.replace('https://', '')}/continue</a> and we'll email you a 6-digit code — no password needed.
    </p>
    <p style="color:#6b7280;font-size:13px;margin:0;">Questions? Just reply to this email.</p>
  </div>`;
}

/** Send the welcome email for one business. Throws on send failure so the
 *  caller can decide (inline callers swallow; the drain records and moves on). */
export async function sendReviewsWelcome(businessId: string): Promise<void> {
  const { data: biz } = await supabase
    .from('businesses')
    .select('id, name, plan')
    .eq('id', businessId)
    .maybeSingle();
  if (!biz) return;

  const { data: settings } = await supabase
    .from('review_settings')
    .select('welcome_email_sent_at, owner_first_name')
    .eq('business_id', businessId)
    .maybeSingle();
  if (settings?.welcome_email_sent_at) return;   // already welcomed

  const { data: owner } = await supabase
    .from('team_members')
    .select('email, name')
    .eq('business_id', businessId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  if (!owner?.email) return;

  const plan = planByKey(biz.plan) ?? REVIEW_PLANS[0];

  // Set-password link, so a buyer who never chose one has a way in that isn't
  // the code door. Best-effort — mirrors api/admin/reviews/onboard.ts.
  let actionLink: string | null = null;
  try {
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: owner.email,
      options: { redirectTo: `${GO_URL}/reset-password?next=/onboarding` },
    });
    actionLink = linkData?.properties?.action_link ?? null;
  } catch { /* the code door still works; don't block the email on this */ }

  const first = settings?.owner_first_name || firstName(owner.name, owner.email);

  await sendEmail(
    owner.email,
    `Welcome to HeyElsie Reviews, ${first} — your account is ready`,
    welcomeHtml({
      first,
      business: biz.name,
      planName: plan.name,
      priceGbp: plan.priceGbp,
      requests: plan.requestsPerMonth,
      actionLink,
    }),
  );

  await supabase
    .from('review_settings')
    .update({ welcome_email_sent_at: new Date().toISOString() })
    .eq('business_id', businessId);
}

/** Sweep any paid reviews account that hasn't been welcomed yet.
 *  Runs from /api/cron/notify-drain, every minute. */
export async function drainReviewsWelcome(): Promise<{ sent: number }> {
  // The 7-day window matters: without it the very first run after deploy would
  // retro-blast every reviews account ever created.
  const since = new Date(Date.now() - 7 * 86400000).toISOString();

  const { data: rows } = await supabase
    .from('review_settings')
    .select('business_id, businesses!inner(id, created_at, stripe_subscription_id)')
    .is('welcome_email_sent_at', null)
    .gt('businesses.created_at', since)
    .not('businesses.stripe_subscription_id', 'is', null)   // never welcome an unpaid account
    .limit(10);

  if (!rows?.length) return { sent: 0 };

  let sent = 0;
  for (const row of rows as Array<{ business_id: string }>) {
    try {
      await sendReviewsWelcome(row.business_id);
      sent++;
    } catch (e) {
      console.error('[reviews-welcome] send failed for', row.business_id, (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 600));   // pace, same as vsl-notify
  }
  return { sent };
}
