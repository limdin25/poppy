// Closer flow: admin onboards a client sold on the phone in minutes.
// Creates the auth user + business + reviews flags/settings, queues the
// sender-number request, links the CRM lead if given, emails the client a
// set-password link, and returns the tier payment link for the closer to send.

import { createClient } from '@supabase/supabase-js';
import { requireAdminAny } from '../../lib/require-admin.js';
import { sendEmail } from '../../../src/integrations/resend/client.js';
import { planByKey, REVIEW_PLANS } from '../../lib/review-plans.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const admin = await requireAdminAny(req);
  if (admin instanceof Response) return admin;

  try {
    const { business_name, owner_name, owner_email, plan_key, crm_contact_id } = (await req.json()) as {
      business_name?: string; owner_name?: string; owner_email?: string; plan_key?: string; crm_contact_id?: string;
    };
    if (!business_name || !owner_name || !owner_email) {
      return new Response(JSON.stringify({ error: 'business_name, owner_name, owner_email required' }), { status: 400 });
    }
    const email = owner_email.trim().toLowerCase();
    const plan = planByKey(plan_key) ?? REVIEW_PLANS[0];
    const goUrl = process.env.GO_APP_URL || 'https://go.heyelsie.com';

    // Auth user (random password; they set their own via the emailed link)
    const tempPassword = crypto.randomUUID();
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name: owner_name },
    });
    if (userError) return new Response(JSON.stringify({ error: userError.message }), { status: 400 });
    const userId = userData.user.id;

    const slug = `${business_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'business'}-${userId.slice(0, 8)}`;
    const { data: biz, error: bizError } = await supabase
      .from('businesses')
      .insert({ owner_id: userId, name: business_name, slug, billing_active: false, currency: 'GBP' })
      .select('id')
      .single();
    if (bizError || !biz) return new Response(JSON.stringify({ error: bizError?.message || 'business create failed' }), { status: 500 });

    await Promise.all([
      supabase.from('team_members').insert({
        business_id: biz.id, user_id: userId, email, name: owner_name, role: 'owner', joined_at: new Date().toISOString(),
      }),
      supabase.from('feature_flags').insert({ business_id: biz.id, flag_key: 'reviews', enabled: true }),
      supabase.from('review_settings').insert({
        business_id: biz.id,
        owner_first_name: owner_name.split(/\s+/)[0],
        inbound_token: crypto.randomUUID().replace(/-/g, ''),
      }),
      supabase.from('review_number_requests').insert({
        business_id: biz.id,
        note: `Created by ${admin.email} via closer onboarding`,
      }),
    ]);

    // CRM bridge: the sold lead now points at the live client account.
    if (crm_contact_id) {
      await supabase.from('wk_contacts').update({ business_id: biz.id }).eq('id', crm_contact_id);
    }

    // Set-password link so the client can log straight into go.heyelsie.com
    let actionLink: string | null = null;
    try {
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${goUrl}/onboarding` },
      });
      actionLink = linkData?.properties?.action_link ?? null;
    } catch { /* link is best-effort; closer can trigger a reset later */ }

    await sendEmail(email, `Welcome to HeyElsie Reviews, ${owner_name.split(/\s+/)[0]}!`, `
    <div style="font-family:sans-serif;line-height:1.6;color:#1c1c28;max-width:520px;margin:0 auto;">
      <h2>Your review engine is being set up</h2>
      <p>Great speaking with you — your HeyElsie Reviews account for <strong>${business_name}</strong> is ready. Set your password and finish the 10-minute setup:</p>
      ${actionLink ? `<p><a href="${actionLink}" style="background:#3C5A87;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">Set password &amp; continue setup</a></p>` : `<p>Log in at <a href="${goUrl}">${goUrl}</a> using "Forgot password" with this email address.</p>`}
      <p style="color:#6b7280;font-size:14px;">You'll connect your Google profile, upload your customer list, and reviews start arriving within days.</p>
    </div>`).catch(() => {});

    await supabase.from('admin_audit_log').insert({
      admin_email: admin.email,
      action: 'reviews_client_onboarded',
      target_type: 'business',
      target_id: biz.id,
      metadata: { plan: plan.key, crm_contact_id: crm_contact_id ?? null },
    });

    return new Response(JSON.stringify({
      ok: true,
      businessId: biz.id,
      paymentLink: plan.paymentLink,
      setPasswordLink: actionLink,
    }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
