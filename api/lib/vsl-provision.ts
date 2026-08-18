// VSL sale provisioning — called by the Stripe webhook when a checkout session
// carries metadata.vsl_page_id (a lead who paid £1 straight from their video
// page; no account existed beforehand). Mirrors api/auth/register.ts's
// product='reviews' path, minus the password: they log in via go.heyelsie.com/
// continue (email → code), which is where the checkout success_url lands.
//
// SECURITY (adversarial review 2026-07-25): the email comes from Stripe's
// hosted page and is NOT verified as owned by the payer. So we NEVER mutate an
// existing business's billing from this path — that would let a stranger who
// types a real customer's email repoint/cancel their subscription. We only
// create BRAND-NEW accounts here; an email that already owns a business is
// flagged for manual review, never overwritten.
//
// IDEMPOTENCY: checkout.session.completed can be delivered more than once, and
// a run can die half-way (edge timeout, transient Supabase error). Both are
// handled by the stripe_provisioning ledger (20260728000001): we CLAIM the
// session before any write and only mark it done on success, so a crashed run
// is RESUMED rather than restarted. Every write below is therefore
// conflict-tolerant — the old code exploded on businesses.slug's UNIQUE
// constraint on every retry and wedged the customer permanently.
//
// This function is called from two places — the Stripe webhook and the
// /api/billing/session-status poller (the fallback that stops provisioning
// depending on the webhook alone). The claim is what makes that safe.

import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { sendEmail } from '../../src/integrations/resend/client.js';
import { VSL_PRICES, advanceVslState } from './vsl-settings.js';
import { notifyFunnelEvent } from './vsl-notify.js';
import { sendReviewsWelcome } from './reviews-welcome.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Find an existing auth user by email (createUser doesn't return the id on the
 *  duplicate-email path). Paginates admin.listUsers. */
async function findUserByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    // gotrue's own typings collapse users to never under this tsconfig; the
    // wire shape is stable.
    const users = data.users as Array<{ id: string; email?: string | null }>;
    const hit = users.find((u) => (u.email || '').toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

export async function provisionVslSale(session: Stripe.Checkout.Session): Promise<void> {
  const pageId = session.metadata?.vsl_page_id;
  if (!pageId) return;

  // Claim BEFORE any read/write. Losing the claim means either another delivery
  // is mid-flight or this session is already done — both are no-ops, not errors,
  // so return rather than throw (a throw would 500 and make Stripe retry a
  // session that needs nothing).
  const claimKey = `provision:${session.id}`;
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_stripe_provision', {
    p_key: claimKey,
  });
  if (claimErr) throw new Error(`VSL provision: could not claim ${claimKey}: ${claimErr.message}`);
  if (!claimed) return;

  try {
    await provisionClaimed(session, pageId, claimKey);
  } catch (err) {
    await supabase.rpc('fail_stripe_provision', {
      p_key: claimKey,
      p_error: (err as Error).message,
    });
    throw err;
  }
}

async function provisionClaimed(
  session: Stripe.Checkout.Session,
  pageId: string,
  claimKey: string,
): Promise<void> {
  const { data: page } = await supabase
    .from('wk_vsl_pages')
    .select('*')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) {
    await supabase.rpc('finish_stripe_provision', { p_key: claimKey, p_business_id: null });
    return;
  }

  // Legacy belt-and-braces: sessions provisioned BEFORE the ledger existed have
  // no ledger row, so they would claim cleanly and re-run. A crashed run never
  // reaches 'paid' (it's the last write), so this cannot block a resume.
  if (page.state === 'paid') {
    await supabase.rpc('finish_stripe_provision', {
      p_key: claimKey,
      p_business_id: page.business_id ?? null,
    });
    return;
  }

  const email = (session.customer_details?.email || '').trim().toLowerCase();
  const priceId = session.metadata?.price_id || '';
  const plan = VSL_PRICES[priceId]?.plan || 'reviews_starter';
  const ownerName = page.owner_first || page.business_name;

  if (!email) {
    // Can't provision without an email — but the money is taken. Alert Hugo to
    // reconcile manually rather than silently losing the customer. Marked
    // 'failed' (not 'done') because it genuinely needs a human; no retry can
    // conjure an email Stripe never captured.
    await notifyOwner(`⚠️ VSL sale with NO email: ${page.business_name}`,
      `A £1 checkout completed for ${page.business_name} but Stripe returned no email. Session ${session.id}. Reconcile manually.`);
    await supabase.rpc('fail_stripe_provision', {
      p_key: claimKey,
      p_error: 'Stripe returned no customer email',
    });
    return;
  }

  let businessId: string | null = null;

  // Does this email already OWN a business? If so we do NOT touch its billing
  // (unverified email — hijack risk). Flag for manual review and stop.
  const { data: ownerRow } = await supabase
    .from('team_members')
    .select('business_id')
    .ilike('email', email)
    .eq('role', 'owner')
    .not('user_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (ownerRow?.business_id) {
    await notifyOwner(`⚠️ VSL sale needs manual link: ${page.business_name}`,
      `A £1 checkout for ${page.business_name} used email ${email}, which already owns an existing business (${ownerRow.business_id}). We did NOT auto-link it (unverified email). Session ${session.id} — check Stripe and link/refund manually.`);
    // Still record the sale on the page + move the card so it's visible.
    await recordPaid(page, session, priceId, null);
    await supabase.rpc('fail_stripe_provision', {
      p_key: claimKey,
      p_error: `email ${email} already owns business ${ownerRow.business_id} — needs manual link`,
    });
    return;
  }

  // Fresh account. Reuse the auth user if one exists for this email (e.g. a
  // team member of someone else, or a half-provisioned retry), else create it.
  let userId = await findUserByEmail(email);
  if (!userId) {
    const { data: created, error: userErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: ownerName },
    });
    if (userErr || !created?.user) {
      // Maybe a race created it between the lookup and now — try once more.
      userId = await findUserByEmail(email);
      if (!userId) throw new Error(`VSL provision: could not create/find user for ${email}: ${userErr?.message}`);
    } else {
      userId = created.user.id;
    }
  }

  // Get-or-create. The slug is deterministic, so a resumed run must ADOPT the
  // row a crashed run already created — inserting again hits businesses.slug's
  // UNIQUE constraint, which is what used to wedge a paying customer forever.
  const slug = `${page.slug.slice(0, 40)}-${userId.slice(0, 8)}`;
  const { data: existingBiz } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', slug)
    .eq('owner_id', userId)
    .maybeSingle();

  if (existingBiz) {
    businessId = existingBiz.id;
  } else {
    const { data: newBiz, error: bizErr } = await supabase
      .from('businesses')
      .insert({
        owner_id: userId,
        name: page.business_name,
        slug,
        currency: 'GBP',
        plan,
        billing_status: 'trialing',
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
      })
      .select('id')
      .single();
    if (newBiz) {
      businessId = newBiz.id;
    } else {
      // Lost a race between the select and the insert — re-read rather than fail.
      const { data: raced } = await supabase
        .from('businesses')
        .select('id')
        .eq('slug', slug)
        .eq('owner_id', userId)
        .maybeSingle();
      if (!raced) throw new Error(`VSL provision: business insert failed: ${bizErr?.message}`);
      businessId = raced.id;
    }
  }

  // Reviews product wiring (mirrors register.ts). Upserts, not inserts: a
  // resumed run re-enters here and every one of these tables has a UNIQUE
  // constraint that would otherwise 23505. Errors are CHECKED — an unchecked
  // team_members failure used to leave the buyer permanently stuck at the
  // login screen (ReviewsApp gives an account with no membership no way in).
  const { error: flagErr } = await supabase
    .from('feature_flags')
    .upsert({ business_id: businessId, flag_key: 'reviews', enabled: true }, {
      onConflict: 'business_id,flag_key',
    });
  if (flagErr) throw new Error(`VSL provision: feature flag failed: ${flagErr.message}`);

  // ignoreDuplicates is MANDATORY here — a plain upsert would regenerate
  // inbound_token and silently break any Zapier/webhook trigger URL the client
  // has already been given (api/reviews/trigger.ts keys off it).
  const { error: settingsErr } = await supabase
    .from('review_settings')
    .upsert({
      business_id: businessId,
      owner_first_name: (page.owner_first || ownerName).split(/\s+/)[0],
      inbound_token: crypto.randomUUID().replace(/-/g, ''),
    }, { onConflict: 'business_id', ignoreDuplicates: true });
  if (settingsErr) throw new Error(`VSL provision: review settings failed: ${settingsErr.message}`);

  const { error: memberErr } = await supabase
    .from('team_members')
    .upsert({
      business_id: businessId,
      user_id: userId,
      email,
      name: ownerName,
      role: 'owner',
      joined_at: new Date().toISOString(),
    }, { onConflict: 'business_id,email', ignoreDuplicates: true });
  if (memberErr) throw new Error(`VSL provision: team member failed: ${memberErr.message}`);

  // Queue the sender number. Without this the client never appears in the admin
  // NEEDS NUMBER queue, review_settings.sms_from_number stays null, and the
  // send engine can never deliver a single request — a paid account that does
  // nothing. Both sibling provisioning paths already do this; this one didn't.
  await ensureNumberRequest(businessId, `£1 VSL sale — ${page.business_name} (${page.slug})`);

  // Link the CRM lead (unlinked only — same guard rationale as register.ts).
  await supabase
    .from('wk_contacts')
    .update({ business_id: businessId })
    .eq('id', page.contact_id)
    .is('business_id', null);

  await recordPaid(page, session, priceId, businessId);

  // The sale notification goes through the shared fan-out so it also raises a
  // bell entry and reaches the owning agent — not just Hugo's inbox.
  //
  // Deliberately HERE and not inside recordPaid: recordPaid also runs on the
  // manual-link path above, where the sale was explicitly NOT provisioned. A
  // "🎉 they paid" there would contradict the ⚠️ alert sent moments earlier.
  await notifyFunnelEvent({
    page,
    kind: 'vsl_paid',
    title: `💰 PAID — ${page.business_name}`,
    body: `${page.owner_first || 'The owner'} paid £1 and started the ${VSL_PRICES[priceId]?.label || 'Starter'} trial · ${email}${page.town ? ` · ${page.town}` : ''}`,
    meta: { email, price_id: priceId, business_id: businessId },
  });

  // The account exists and is complete — release the claim before the email, so
  // a Resend failure can never undo provisioning.
  await supabase.rpc('finish_stripe_provision', { p_key: claimKey, p_business_id: businessId });

  // Best-effort inline send; the every-minute cron sweeper is the real
  // guarantee. sendEmail THROWS on a Resend 429 — letting that propagate would
  // 500 the webhook, Stripe would retry, the ledger would short-circuit, and
  // the buyer would never get a welcome email at all.
  await sendReviewsWelcome(businessId).catch((e) =>
    console.error('[vsl-provision] welcome email deferred to cron:', (e as Error).message));
}

/** Queue an admin sender-number purchase, unless one is already pending.
 *  Shared by every provisioning path — a reviews account without one can never
 *  send (api/cron/review-requests.ts requires review_settings.sms_from_number). */
export async function ensureNumberRequest(businessId: string, note: string): Promise<void> {
  const { data: pending } = await supabase
    .from('review_number_requests')
    .select('id')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();
  if (pending) return;
  const { error } = await supabase
    .from('review_number_requests')
    .insert({ business_id: businessId, note });
  if (error) console.error('[provision] number request failed:', error.message);
}

async function recordPaid(
  page: { id: string; contact_id: string; state: string } & Record<string, unknown>,
  session: Stripe.Checkout.Session,
  priceId: string,
  businessId: string | null,
): Promise<void> {
  const { error: evErr } = await supabase.from('wk_vsl_events').insert({
    page_id: page.id,
    type: 'paid',
    meta: { session_id: session.id, price_id: priceId, business_id: businessId },
  });
  if (evErr) console.error('[vsl-provision] paid event insert failed:', evErr);
  await advanceVslState(page, 'paid', businessId ? { business_id: businessId } : {});
}

async function notifyOwner(subject: string, html: string): Promise<void> {
  const to = process.env.DAILY_REPORT_EMAIL || 'hugodesouzax@gmail.com';
  await sendEmail(to, subject, html).catch(() => {});
}
