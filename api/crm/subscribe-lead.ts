// One-tap "subscribe on the call" — the CRM closer flow.
//
// A CRM agent, mid-call, taps "Send subscribe link". This:
//   1. creates the plumber's HeyElsie Reviews account from name + email (no
//      email confirmation — they're on the phone), OR reuses it if the email
//      already has one;
//   2. links the dialed CRM lead (wk_contacts) to that account;
//   3. opens a Stripe Checkout session for the chosen tier (10-day trial, card
//      on file) with metadata.business_id so the existing webhook
//      (api/webhooks/stripe.ts) marks THAT business active on payment;
//   4. returns the checkout URL for the agent to text/email.
//
// After payment, the after-call onboarding link (Phase 2) drops them straight
// into setup with the payment step already done.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { planByKey, REVIEW_PLANS } from '../lib/review-plans.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20' as any,
});

const GO_URL = process.env.GO_APP_URL || 'https://go.heyelsie.com';

export const config = { runtime: 'edge' };

// Only a signed-in CRM agent/admin can create accounts + checkout sessions.
async function requireCrmAgent(req: Request): Promise<{ userId: string; email: string } | Response> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_role')
    .eq('id', user.id)
    .maybeSingle();
  const role = (profile as { workspace_role?: string } | null)?.workspace_role;
  const isCrm = role === 'admin' || role === 'agent' || role === 'viewer';
  if (!isCrm) {
    const { data: admin } = await supabase
      .from('admin_users')
      .select('email')
      .eq('email', user.email ?? '')
      .maybeSingle();
    if (!admin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
  return { userId: user.id, email: user.email ?? '' };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const agent = await requireCrmAgent(req);
  if (agent instanceof Response) return agent;

  try {
    const body = (await req.json()) as {
      crm_contact_id?: string;
      business_name?: string;
      owner_name?: string;
      owner_email?: string;
      plan_key?: string;
    };
    const ownerName = (body.owner_name || '').trim();
    const email = (body.owner_email || '').trim().toLowerCase();
    const businessName = (body.business_name || ownerName || 'My business').trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'A valid owner_email is required' }), { status: 400 });
    }
    if (!ownerName) {
      return new Response(JSON.stringify({ error: 'owner_name is required' }), { status: 400 });
    }
    const plan = planByKey(body.plan_key) ?? REVIEW_PLANS.find((p) => p.popular) ?? REVIEW_PLANS[0];

    // ── Resolve or create the account ─────────────────────────────────────
    let businessId: string | null = null;

    // Already onboarded under this email? Reuse (don't double-create / re-charge).
    const { data: existingMember } = await supabase
      .from('team_members')
      .select('business_id')
      .eq('email', email)
      .maybeSingle();

    if (existingMember?.business_id) {
      businessId = existingMember.business_id as string;
    } else {
      // Fresh account — no email confirmation (they're on the phone with us).
      const { data: userData, error: userError } = await supabase.auth.admin.createUser({
        email,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { name: ownerName },
      });
      if (userError || !userData?.user) {
        // Most common cause: the email already exists in auth. Guide the agent.
        return new Response(JSON.stringify({
          error: 'account_exists',
          message: 'That email already has an account — send the onboarding link instead of subscribe.',
        }), { status: 409 });
      }
      const userId = userData.user.id;
      const slug = `${businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'business'}-${userId.slice(0, 8)}`;

      const { data: biz, error: bizError } = await supabase
        .from('businesses')
        .insert({ owner_id: userId, name: businessName, slug, billing_active: false, currency: 'GBP' })
        .select('id')
        .single();
      if (bizError || !biz) {
        return new Response(JSON.stringify({ error: bizError?.message || 'business create failed' }), { status: 500 });
      }
      businessId = biz.id as string;

      await Promise.all([
        supabase.from('team_members').insert({
          business_id: businessId, user_id: userId, email, name: ownerName, role: 'owner', joined_at: new Date().toISOString(),
        }),
        supabase.from('feature_flags').insert({ business_id: businessId, flag_key: 'reviews', enabled: true }),
        supabase.from('review_settings').insert({
          business_id: businessId,
          owner_first_name: ownerName.split(/\s+/)[0],
          inbound_token: crypto.randomUUID().replace(/-/g, ''),
        }),
        supabase.from('review_number_requests').insert({
          business_id: businessId,
          note: `Created by ${agent.email} via one-tap subscribe`,
        }),
      ]);
    }

    // CRM bridge: the sold lead now points at the live client account.
    if (body.crm_contact_id) {
      await supabase.from('wk_contacts').update({ business_id: businessId }).eq('id', body.crm_contact_id);
    }

    // ── Stripe customer + checkout session ────────────────────────────────
    const { data: business } = await supabase
      .from('businesses')
      .select('stripe_customer_id, billing_status')
      .eq('id', businessId)
      .single();

    // Already paying? Don't send another checkout — they just need onboarding.
    if (business?.billing_status === 'active') {
      return new Response(JSON.stringify({
        ok: true, businessId, alreadySubscribed: true,
      }), { status: 200 });
    }

    let customerId = (business as { stripe_customer_id?: string } | null)?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { business_id: businessId } });
      customerId = customer.id;
      await supabase.from('businesses').update({ stripe_customer_id: customerId }).eq('id', businessId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${GO_URL}/onboarding?paid=1`,
      cancel_url: `${GO_URL}/onboarding?cancelled=1`,
      metadata: { business_id: businessId },
      subscription_data: { trial_period_days: 10 },
      payment_method_collection: 'always',
    });

    return new Response(JSON.stringify({
      ok: true,
      businessId,
      plan: plan.key,
      checkoutUrl: session.url,
    }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
