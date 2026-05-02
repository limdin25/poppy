import { createClient } from '@supabase/supabase-js';

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
    const { name, email, businessId } = await req.json() as { name?: string; email?: string; businessId?: string };

    if (!name || !email || !businessId) {
      return new Response(
        JSON.stringify({ error: 'name, email, and businessId are required' }),
        { status: 400 },
      );
    }

    // Create user with email confirm
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
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

    // Generate magic link for auto sign-in
    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });

    if (linkError) {
      return new Response(JSON.stringify({ error: linkError.message }), { status: 500 });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        userId,
        signInUrl: linkData.properties?.action_link,
      }),
      { status: 200 },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
