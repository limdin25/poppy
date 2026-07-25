import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as supabase } from '../../src/integrations/supabase/client.js';
import { sendWelcomeEmail } from '../../src/integrations/resend/client.js';

// IMPORTANT: the shared supabaseAdmin client is used ONLY for admin/DB writes
// (service-role, bypasses RLS). signInWithPassword sets an in-memory user
// session on whatever client calls it — so we do that on a throwaway client
// created per request, never on the shared admin client (which would then send
// a user JWT on warm invocations and get blocked by RLS).

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { name, email, password, businessId, businessName, product, ref, crm_contact_id } = await req.json() as {
      name?: string;
      email?: string;
      password?: string;
      businessId?: string;
      businessName?: string;
      product?: string;   // 'reviews' → HeyElsie Reviews signup (go.heyelsie.com)
      ref?: string;       // referrer business id (referral attribution)
      crm_contact_id?: string; // link this CRM lead (wk_contacts) to the new account
    };

    if (!name || !email || !password) {
      return new Response(
        JSON.stringify({ error: 'name, email, and password are required' }),
        { status: 400 },
      );
    }

    // Create user with password FIRST (owner must exist before the business FK)
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (userError) {
      return new Response(JSON.stringify({ error: userError.message }), { status: 400 });
    }

    const userId = userData.user.id;

    // ── Accept a pending team invite (join an existing business) ──────────────
    // If this email was invited to a team (pending row, no user yet), link the new
    // user to that business instead of spinning up a fresh one. Matches by email
    // (invites are stored lowercased) so no token is needed.
    if (!businessId) {
      const { data: pendingInvite } = await supabase
        .from('team_members')
        .select('id, business_id')
        .eq('email', email.trim().toLowerCase())
        .is('user_id', null)
        .order('invited_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingInvite) {
        await supabase
          .from('team_members')
          .update({ user_id: userId, name, joined_at: new Date().toISOString() })
          .eq('id', pendingInvite.id);

        const authClient = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data: signInData, error: signInError } =
          await authClient.auth.signInWithPassword({ email, password });
        if (signInError) {
          return new Response(JSON.stringify({ error: signInError.message }), { status: 500 });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            joinedTeam: true,
            userId,
            businessId: pendingInvite.business_id,
            access_token: signInData.session?.access_token,
            refresh_token: signInData.session?.refresh_token,
          }),
          { status: 200 },
        );
      }
    }

    // Resolve the business: link an existing one, or create a fresh one now that the owner exists
    let bizId = businessId;
    if (bizId) {
      const { error: bizError } = await supabase
        .from('businesses')
        .update({ owner_id: userId })
        .eq('id', bizId);
      if (bizError) {
        return new Response(JSON.stringify({ error: bizError.message }), { status: 500 });
      }
    } else {
      const bName = (businessName && businessName.trim()) || `${name}'s Business`;
      const slug = `${bName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'business'}-${userId.slice(0, 8)}`;
      const { data: newBiz, error: createBizError } = await supabase
        .from('businesses')
        .insert({ owner_id: userId, name: bName, slug, billing_active: false, currency: 'GBP' })
        .select('id')
        .single();
      if (createBizError || !newBiz) {
        return new Response(JSON.stringify({ error: createBizError?.message || 'Failed to create business' }), { status: 500 });
      }
      bizId = newBiz.id;

      if (product === 'reviews') {
        // Reviews clients get the reviews product only (dashboard on go.heyelsie.com);
        // the receptionist stays hidden for them.
        await supabase.from('feature_flags').insert({ business_id: bizId, flag_key: 'reviews', enabled: true });
        await supabase.from('review_settings').insert({
          business_id: bizId,
          owner_first_name: name.split(/\s+/)[0],
          inbound_token: crypto.randomUUID().replace(/-/g, ''),
        });

        // Referral attribution: match a pending invite by email, else record
        // the ?ref= link click as a signed-up referral.
        const invitedMatch = await supabase
          .from('review_referrals')
          .select('id')
          .eq('invitee_email', email.trim().toLowerCase())
          .eq('status', 'invited')
          .limit(1)
          .maybeSingle();
        if (invitedMatch.data) {
          await supabase
            .from('review_referrals')
            .update({ invitee_business_id: bizId, status: 'signed_up' })
            .eq('id', invitedMatch.data.id);
        } else if (ref && /^[0-9a-f-]{36}$/i.test(ref) && ref !== bizId) {
          const { data: refBiz } = await supabase.from('businesses').select('id').eq('id', ref).maybeSingle();
          if (refBiz) {
            await supabase.from('review_referrals').insert({
              referrer_business_id: ref,
              invitee_email: email.trim().toLowerCase(),
              invitee_business_id: bizId,
              status: 'signed_up',
            });
          }
        }

        // CRM link (Hugo 2026-07-22): the subscribe link carries ?crm=<contact_id>.
        // Point that CRM lead at this new reviews account so the agent's pipeline
        // stays connected. This endpoint is UNAUTHENTICATED, so the update is
        // hard-guarded (adversarial review): only claim a lead that is currently
        // UNLINKED (is business_id null) AND whose email matches this new
        // account — so a caller can't relink someone else's or an already-linked
        // contact by guessing an id. Best-effort; never fail signup on it.
        if (crm_contact_id && /^[0-9a-f-]{36}$/i.test(crm_contact_id)) {
          await supabase.from('wk_contacts')
            .update({ business_id: bizId })
            .eq('id', crm_contact_id)
            .is('business_id', null)
            .ilike('email', email.trim());
        }
      } else {
        // New sign-ups land in the simple client portal (slim menu). Admins
        // unlock the full app per account in Admin → Feature Flags.
        await supabase.from('feature_flags').insert({ business_id: bizId, flag_key: 'simple_portal', enabled: true });
      }
    }

    // Create team_members entry so AuthProvider can find businessId
    const { error: teamError } = await supabase.from('team_members').insert({
      business_id: bizId,
      user_id: userId,
      email,
      name,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    if (teamError) {
      return new Response(JSON.stringify({ error: teamError.message }), { status: 500 });
    }

    // Sign in on a throwaway client so the shared admin client is never polluted
    const authClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: signInData, error: signInError } =
      await authClient.auth.signInWithPassword({ email, password });

    if (signInError) {
      return new Response(JSON.stringify({ error: signInError.message }), { status: 500 });
    }

    // Send welcome email (non-blocking — don't fail registration if email fails)
    const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
    sendWelcomeEmail(name, email, `${appUrl}/login`).catch(() => {});

    return new Response(
      JSON.stringify({
        ok: true,
        userId,
        businessId: bizId,
        access_token: signInData.session?.access_token,
        refresh_token: signInData.session?.refresh_token,
      }),
      { status: 200 },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
