import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import { hashOnboardingCode } from '../lib/onboarding.js';

export const config = { runtime: 'edge' };

// New hires always join as a capped 'agent' — never admin, never uncapped.
// This route is public (the hire has no account yet), so the role is hard-
// coded here and can never be escalated from the request body.
const AGENT_DAILY_LIMIT_PENCE = 1000; // £10/day default cap

/**
 * Public step 2: verify the emailed code, then create the CRM agent account
 * (auth user + profiles.workspace_role='agent' + spend-limit row). After this
 * the agent shows in Settings → Agents & spend and can log into the CRM.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { signupId, code, password } = (await req.json()) as {
      signupId?: string;
      code?: string;
      password?: string;
    };
    if (!signupId || !code) return Response.json({ error: 'Missing code' }, { status: 400 });
    if (!password || String(password).length < 8) {
      return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const { data: s } = await supabaseAdmin
      .from('wk_agent_signups')
      .select('*')
      .eq('id', signupId)
      .single();
    if (!s) return Response.json({ error: 'Onboarding not found. Please start again.' }, { status: 404 });
    if (s.status === 'created') {
      return Response.json({ error: 'This account has already been created — please log in.' }, { status: 409 });
    }
    if (s.status !== 'code_sent') {
      return Response.json({ error: 'Please request a new code.' }, { status: 400 });
    }
    if (s.code_expires_at && new Date(s.code_expires_at).getTime() < Date.now()) {
      return Response.json({ error: 'Your code has expired. Please start again.' }, { status: 400 });
    }
    if ((s.attempts ?? 0) >= 5) {
      return Response.json({ error: 'Too many attempts. Please start again.' }, { status: 429 });
    }

    const expected = await hashOnboardingCode(String(code), s.email);
    if (expected !== s.code_hash) {
      await supabaseAdmin
        .from('wk_agent_signups')
        .update({ attempts: (s.attempts ?? 0) + 1 })
        .eq('id', signupId);
      return Response.json({ error: 'That code is not right. Please try again.' }, { status: 400 });
    }

    // Defence in depth: onboarding could have been closed after the code was sent.
    const { data: agr } = await supabaseAdmin
      .from('wk_agent_agreement')
      .select('onboarding_open')
      .eq('id', 1)
      .single();
    if (agr && agr.onboarding_open === false) {
      return Response.json({ error: 'Onboarding is currently closed.' }, { status: 403 });
    }

    const email = String(s.email);
    const name = String(s.name);

    // 1) Create the auth user, or recover an existing one and rotate the password.
    let userId: string | null = null;
    const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createErr) {
      const msg = (createErr.message || '').toLowerCase();
      const exists = msg.includes('already') || msg.includes('registered') || msg.includes('exists');
      if (!exists) return Response.json({ error: createErr.message }, { status: 500 });
      let found: { id: string } | null = null;
      const PER = 200;
      for (let page = 1; page <= 50; page++) {
        const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PER });
        if (listErr) return Response.json({ error: listErr.message }, { status: 500 });
        const users = (list?.users ?? []) as Array<{ id: string; email?: string | null }>;
        const u = users.find((x) => (x.email || '').toLowerCase() === email);
        if (u) { found = { id: u.id }; break; }
        if (users.length < PER) break;
      }
      if (!found) return Response.json({ error: 'Email exists but lookup failed' }, { status: 500 });
      userId = found.id;
      const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (pwErr) return Response.json({ error: `Password set failed: ${pwErr.message}` }, { status: 500 });
    } else {
      userId = createData.user?.id ?? null;
    }
    if (!userId) return Response.json({ error: 'No user id returned' }, { status: 500 });

    // 2) Profile as a workspace agent.
    const { error: profErr } = await supabaseAdmin
      .from('profiles')
      .upsert(
        { id: userId, email, name, workspace_role: 'agent', agent_status: 'offline' },
        { onConflict: 'id' },
      );
    if (profErr) return Response.json({ error: `Profile: ${profErr.message}` }, { status: 500 });

    // 3) Spend-limit row (mirrors wk-create-agent) so they show on the roster.
    const { error: limErr } = await supabaseAdmin
      .from('wk_voice_agent_limits')
      .upsert(
        {
          agent_id: userId,
          daily_limit_pence: AGENT_DAILY_LIMIT_PENCE,
          daily_spend_pence: 0,
          is_admin: false,
          show_on_leaderboard: true,
        },
        { onConflict: 'agent_id' },
      );
    if (limErr) return Response.json({ error: `Limit: ${limErr.message}` }, { status: 500 });

    // 4) Close out the signup (clear the code hash — it's spent).
    await supabaseAdmin
      .from('wk_agent_signups')
      .update({ status: 'created', agent_id: userId, code_hash: null })
      .eq('id', signupId);

    return Response.json({ ok: true, email });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Server error' }, { status: 500 });
  }
}
