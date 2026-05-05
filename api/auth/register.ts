import { createClient } from '@supabase/supabase-js';
import { sendWelcomeEmail } from '../../src/integrations/resend/client';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { name, email, password, businessId } = await req.json() as {
      name?: string;
      email?: string;
      password?: string;
      businessId?: string;
    };

    if (!name || !email || !password || !businessId) {
      return new Response(
        JSON.stringify({ error: 'name, email, password, and businessId are required' }),
        { status: 400 },
      );
    }

    // Create user with password
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

    // Link user to business as owner
    const { error: bizError } = await supabase
      .from('businesses')
      .update({ owner_id: userId })
      .eq('id', businessId);

    if (bizError) {
      return new Response(JSON.stringify({ error: bizError.message }), { status: 500 });
    }

    // Create team_members entry so AuthProvider can find businessId
    const { error: teamError } = await supabase.from('team_members').insert({
      business_id: businessId,
      user_id: userId,
      email,
      name,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });

    if (teamError) {
      return new Response(JSON.stringify({ error: teamError.message }), { status: 500 });
    }

    // Sign in the user to get a session
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      return new Response(JSON.stringify({ error: signInError.message }), { status: 500 });
    }

    // Send welcome email (non-blocking — don't fail registration if email fails)
    const appUrl = process.env.APP_URL || 'https://poppy-henna.vercel.app';
    sendWelcomeEmail(name, email, `${appUrl}/login`).catch(() => {});

    return new Response(
      JSON.stringify({
        ok: true,
        userId,
        access_token: signInData.session?.access_token,
        refresh_token: signInData.session?.refresh_token,
      }),
      { status: 200 },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
