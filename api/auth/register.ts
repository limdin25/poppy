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
    const { name, email, password, businessId, businessName } = await req.json() as {
      name?: string;
      email?: string;
      password?: string;
      businessId?: string;
      businessName?: string;
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
