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
// IDEMPOTENCY: checkout.session.completed can be delivered more than once.
// Provisioning is guarded on the page already being 'paid' AND throws on any
// unexpected failure so the webhook returns 5xx and Stripe retries (rather than
// a paying customer ending up with no account).

import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { sendEmail } from '../../src/integrations/resend/client.js';
import { VSL_PRICES, advanceVslState } from './vsl-settings.js';
import { notifyFunnelEvent } from './vsl-notify.js';

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
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function provisionVslSale(session: Stripe.Checkout.Session): Promise<void> {
  const pageId = session.metadata?.vsl_page_id;
  if (!pageId) return;

  const { data: page } = await supabase
    .from('wk_vsl_pages')
    .select('*')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) return;

  // Idempotency: a duplicate delivery for an already-provisioned page is a
  // no-op. (State is the guard; paid_at is stamped by advanceVslState.)
  if (page.state === 'paid') return;

  const email = (session.customer_details?.email || '').trim().toLowerCase();
  const priceId = session.metadata?.price_id || '';
  const plan = VSL_PRICES[priceId]?.plan || 'reviews_starter';
  const ownerName = page.owner_first || page.business_name;

  if (!email) {
    // Can't provision without an email — but the money is taken. Alert Hugo to
    // reconcile manually rather than silently losing the customer.
    await notifyOwner(`⚠️ VSL sale with NO email: ${page.business_name}`,
      `A £1 checkout completed for ${page.business_name} but Stripe returned no email. Session ${session.id}. Reconcile manually.`);
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

  const slug = `${page.slug.slice(0, 40)}-${userId.slice(0, 8)}`;
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
  if (bizErr || !newBiz) throw new Error(`VSL provision: business insert failed: ${bizErr?.message}`);
  businessId = newBiz.id;

  // Reviews product wiring (mirrors register.ts). These are additive; if a
  // retry re-enters we've already returned at the state==='paid' guard.
  await supabase.from('feature_flags').insert({ business_id: businessId, flag_key: 'reviews', enabled: true });
  await supabase.from('review_settings').insert({
    business_id: businessId,
    owner_first_name: (page.owner_first || ownerName).split(/\s+/)[0],
    inbound_token: crypto.randomUUID().replace(/-/g, ''),
  });
  await supabase.from('team_members').insert({
    business_id: businessId,
    user_id: userId,
    email,
    name: ownerName,
    role: 'owner',
    joined_at: new Date().toISOString(),
  });

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
