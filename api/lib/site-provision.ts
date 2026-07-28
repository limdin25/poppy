// Turning a site-demo sale into a working account.
//
// Reuses the EXISTING provisioning ledger (claim/finish/fail_stripe_provision,
// migration 20260728000001). That ledger is generic infrastructure, not VSL
// specific, and idempotency is exactly the thing not worth reimplementing:
// Stripe retries, the success page also polls, and a double provision means a
// duplicate business for a paying customer.
//
// Everything else is this funnel's own, per the standalone rule.

import type Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../src/integrations/resend/client.js';
import { advanceSiteState, logSiteEvent } from './site-demo.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function notifyOwner(subject: string, html: string): Promise<void> {
  const to = process.env.DAILY_REPORT_EMAIL || 'hugodesouzax@gmail.com';
  await sendEmail(to, subject, html).catch(() => {});
}

/** Paginates admin.listUsers, because createUser does not return an id on the duplicate path. */
async function findUserByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const users = data.users as Array<{ id: string; email?: string | null }>;
    const hit = users.find((u) => (u.email || '').toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function provisionSiteSale(session: Stripe.Checkout.Session): Promise<void> {
  const pageId = session.metadata?.site_page_id;
  if (!pageId) return;

  // Claim BEFORE any read or write. Losing the claim means another delivery is
  // mid-flight or this session is already done, and both are no-ops rather than
  // errors: throwing would 500 and make Stripe retry a session needing nothing.
  const claimKey = `provision:${session.id}`;
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_stripe_provision', {
    p_key: claimKey,
  });
  if (claimErr) throw new Error(`site provision: could not claim ${claimKey}: ${claimErr.message}`);
  if (!claimed) return;

  try {
    await provisionClaimed(session, pageId, claimKey);
  } catch (err) {
    await supabase.rpc('fail_stripe_provision', { p_key: claimKey, p_error: (err as Error).message });
    throw err;
  }
}

async function provisionClaimed(
  session: Stripe.Checkout.Session,
  pageId: string,
  claimKey: string,
): Promise<void> {
  const { data: page } = await supabase.from('wk_site_pages').select('*').eq('id', pageId).maybeSingle();
  if (!page) {
    await supabase.rpc('finish_stripe_provision', { p_key: claimKey, p_business_id: null });
    return;
  }
  if (page.state === 'converted') {
    await supabase.rpc('finish_stripe_provision', {
      p_key: claimKey,
      p_business_id: page.business_id ?? null,
    });
    return;
  }

  const email = (session.customer_details?.email || '').trim().toLowerCase();
  const ownerName = page.owner_first || page.business_name;

  if (!email) {
    // The money is taken and we cannot make an account. A human has to
    // reconcile it, and no retry can conjure an email Stripe never captured,
    // so this is marked failed rather than left to loop.
    await notifyOwner(
      `Site demo sale with NO email: ${page.business_name}`,
      `A checkout completed for ${page.business_name} but Stripe returned no email. Session ${session.id}. Reconcile manually.`,
    );
    await supabase.rpc('fail_stripe_provision', {
      p_key: claimKey,
      p_error: 'Stripe returned no customer email',
    });
    return;
  }

  // Does this email already own a business? Never touch an existing business's
  // billing from here: the Stripe email is unverified, so auto-linking it is a
  // hijack risk. Flag it and stop.
  const { data: ownerRow } = await supabase
    .from('team_members')
    .select('business_id')
    .ilike('email', email)
    .eq('role', 'owner')
    .not('user_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (ownerRow?.business_id) {
    await notifyOwner(
      `Site demo sale needs manual link: ${page.business_name}`,
      `A checkout for ${page.business_name} used ${email}, which already owns business ${ownerRow.business_id}. Not auto-linked (unverified email). Session ${session.id}.`,
    );
    await recordConverted(page, session, null);
    await supabase.rpc('fail_stripe_provision', {
      p_key: claimKey,
      p_error: `email ${email} already owns business ${ownerRow.business_id}, needs manual link`,
    });
    return;
  }

  let userId = await findUserByEmail(email);
  if (!userId) {
    const { data: created, error: userErr } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: ownerName },
    });
    if (userErr || !created?.user) {
      // A race may have created it between the lookup and now.
      userId = await findUserByEmail(email);
      if (!userId) throw new Error(`site provision: could not create user for ${email}: ${userErr?.message}`);
    } else {
      userId = created.user.id;
    }
  }

  // Get or create. The slug is deterministic, so a resumed run must ADOPT what
  // a crashed run already made: inserting again hits businesses.slug UNIQUE,
  // which is what used to wedge a paying customer forever on the VSL side.
  const slug = `${String(page.slug).slice(0, 40)}-${userId.slice(0, 8)}`;
  const { data: existingBiz } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', slug)
    .eq('owner_id', userId)
    .maybeSingle();

  let businessId: string;
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
        plan: 'site_demo',
        billing_status: 'trialing',
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
      })
      .select('id')
      .single();
    if (newBiz) {
      businessId = newBiz.id;
    } else {
      const { data: raced } = await supabase
        .from('businesses')
        .select('id')
        .eq('slug', slug)
        .eq('owner_id', userId)
        .maybeSingle();
      if (!raced) throw new Error(`site provision: business insert failed: ${bizErr?.message}`);
      businessId = raced.id;
    }
  }

  // Upserts, not inserts: a resumed run re-enters here and each of these has a
  // UNIQUE constraint that would otherwise 23505. Errors are CHECKED, because
  // an unchecked team_members failure leaves the buyer permanently stuck at the
  // login screen with an account that has no membership.
  const { error: memberErr } = await supabase
    .from('team_members')
    .upsert(
      {
        business_id: businessId,
        user_id: userId,
        email,
        name: ownerName,
        role: 'owner',
        joined_at: new Date().toISOString(),
      },
      { onConflict: 'business_id,email', ignoreDuplicates: true },
    );
  if (memberErr) throw new Error(`site provision: team member failed: ${memberErr.message}`);

  // The flag that reveals the site editor on go.heyelsie.com. Without it they
  // pay and then have nowhere to go.
  const { error: flagErr } = await supabase
    .from('feature_flags')
    .upsert({ business_id: businessId, flag_key: 'site_demo', enabled: true }, {
      onConflict: 'business_id,flag_key',
    });
  if (flagErr) throw new Error(`site provision: feature flag failed: ${flagErr.message}`);

  // Link the CRM lead, unlinked only, so we never steal a contact already
  // attached to a different business.
  await supabase
    .from('wk_contacts')
    .update({ business_id: businessId })
    .eq('id', page.contact_id)
    .is('business_id', null);

  await recordConverted(page, session, businessId);

  await notifyOwner(
    `PAID: ${page.business_name} took the website and receptionist`,
    `${page.owner_first || 'The owner'} paid and started the trial. ${email}${page.town ? ` (${page.town})` : ''}. Session ${session.id}.`,
  );

  // Release the claim before any email, so a Resend failure can never undo
  // provisioning that actually succeeded.
  await supabase.rpc('finish_stripe_provision', { p_key: claimKey, p_business_id: businessId });
}

async function recordConverted(
  page: { id: string; contact_id: string; state: string } & Record<string, unknown>,
  session: Stripe.Checkout.Session,
  businessId: string | null,
): Promise<void> {
  await logSiteEvent(page.id, 'converted', {
    session_id: session.id,
    business_id: businessId,
  });
  await advanceSiteState(page, 'converted', businessId ? { business_id: businessId } : {});
}
