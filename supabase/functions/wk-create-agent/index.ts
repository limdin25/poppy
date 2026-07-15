// wk-create-agent — admin creates an agent account with email + password.
//
// The agent then signs in at /signin with those credentials normally.
// No magic link, no email — admin shares the password directly with the agent.
//
// Body: { email, password, name, extension?, role?, daily_limit_pence? }
//   role defaults to 'agent', daily_limit_pence defaults to 1000 (£10).
//   role='admin' marks is_admin=true (uncapped spend).
//
// AUTH: Supabase JWT of an admin (verified via wk_is_admin RPC).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CreateAgentBody {
  email: string;
  password: string;
  name: string;
  extension?: string;
  role?: 'agent' | 'admin' | 'viewer';
  daily_limit_pence?: number;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) return json(401, { error: 'Missing bearer token' });

    // Per-request client carrying the caller's JWT — used for admin check
    const caller = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userResp, error: userErr } = await caller.auth.getUser(jwt);
    if (userErr || !userResp?.user) return json(401, { error: 'Invalid token' });

    const { data: isAdmin, error: adminErr } = await caller.rpc('wk_is_admin');
    if (adminErr) return json(500, { error: adminErr.message });
    if (!isAdmin) return json(403, { error: 'Admin only' });

    let body: CreateAgentBody;
    try {
      body = (await req.json()) as CreateAgentBody;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';
    const name = (body.name ?? '').trim();
    const extension = (body.extension ?? '').trim() || null;
    const role = body.role ?? 'agent';
    const limitPence =
      typeof body.daily_limit_pence === 'number' && body.daily_limit_pence >= 0
        ? body.daily_limit_pence
        : 1000;

    if (!email || !email.includes('@')) return json(400, { error: 'Valid email required' });
    if (password.length < 8) return json(400, { error: 'Password must be ≥ 8 chars' });
    if (!name) return json(400, { error: 'Name required' });
    if (!['agent', 'admin', 'viewer'].includes(role)) return json(400, { error: 'Bad role' });

    // Service-role client for privileged work
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1) Create the auth user (or recover an existing one with same email)
    let userId: string | null = null;
    const { data: createData, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createErr) {
      const msg = createErr.message ?? '';
      const alreadyExists =
        msg.toLowerCase().includes('already') ||
        msg.toLowerCase().includes('registered') ||
        msg.toLowerCase().includes('exists');
      if (!alreadyExists) return json(500, { error: msg });

      // Reuse existing — look it up and rotate the password to what admin
      // typed. PR (Hugo 2026-04-28): listUsers defaults to page=1 perPage=50.
      // Once auth.users grows past 50 rows, older accounts (e.g. an agent
      // soft-deleted earlier and now being recreated) drop off page 1 and
      // the lookup falsely 500'd with "Email exists but lookup failed".
      // Page through until we find the email or run out of pages.
      let existing: { id: string; email?: string | null } | null = null;
      const PER_PAGE = 200;
      for (let page = 1; page <= 100; page++) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({
          page,
          perPage: PER_PAGE,
        });
        if (listErr) return json(500, { error: listErr.message });
        const found = list?.users?.find(
          (u) => (u.email ?? '').toLowerCase() === email
        );
        if (found) {
          existing = { id: found.id, email: found.email };
          break;
        }
        if (!list?.users || list.users.length < PER_PAGE) break;
      }
      if (!existing) return json(500, { error: 'Email exists but lookup failed' });
      userId = existing.id;
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password });
      if (pwErr) return json(500, { error: `Password rotate failed: ${pwErr.message}` });
    } else {
      userId = createData.user?.id ?? null;
    }

    if (!userId) return json(500, { error: 'No user id returned' });

    // 2) Upsert profile + workspace_role
    //    profiles row may already exist if an account was created earlier — we
    //    just stamp the workspace fields. If it doesn't exist (e.g. when auth
    //    was just created and the trigger hasn't run), insert one.
    const { error: profileErr } = await admin
      .from('profiles')
      .upsert(
        {
          id: userId,
          email,
          name,
          workspace_role: role,
          agent_extension: extension,
          agent_status: 'offline',
        },
        { onConflict: 'id' }
      );
    if (profileErr) return json(500, { error: `Profile upsert: ${profileErr.message}` });

    // 3) Spend limit row (one per agent). show_on_leaderboard is reset to
    //    true here because wk-delete-agent flips it to false on soft-delete;
    //    a recreated agent should be visible on the leaderboard again.
    const { error: limitErr } = await admin
      .from('wk_voice_agent_limits')
      .upsert(
        {
          agent_id: userId,
          daily_limit_pence: limitPence,
          daily_spend_pence: 0,
          is_admin: role === 'admin',
          show_on_leaderboard: true,
        },
        { onConflict: 'agent_id' }
      );
    if (limitErr) return json(500, { error: `Limit upsert: ${limitErr.message}` });

    // 4) Audit
    await admin.from('wk_audit_log').insert({
      actor_id: userResp.user.id,
      action: 'agent_created',
      entity_type: 'profile',
      entity_id: userId,
      meta: { email, role, extension },
    });

    return json(200, {
      user_id: userId,
      email,
      role,
      extension,
      daily_limit_pence: limitPence,
    });
  } catch (e) {
    console.error('wk-create-agent error', e);
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
