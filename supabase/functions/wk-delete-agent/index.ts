// wk-delete-agent — admin soft-deletes an agent.
//
// "Soft" because the auth.users row stays (so historical wk_calls /
// wk_sms_messages / wk_audit_log FKs keep resolving to a real id) and we
// just blank the workspace fields so the agent can no longer sign in to
// the workspace and disappears from leaderboards / queues / lists.
//
// What this does (in order, all under the service-role client):
//   1. Verify caller is admin via wk_is_admin RPC.
//   2. Refuse self-delete (admin can't accidentally lock themselves out).
//   3. Refuse if target's workspace_role is 'admin' UNLESS the caller is
//      a super-admin (email in the admin_users allow-list table — the
//      same mechanism wk-voice-token / wk-spend-check use). PR (Hugo
//      2026-04-28): original rule blocked all admin→admin deletes from
//      the UI as a safety rail; new rule keeps that rail for every
//      workspace admin EXCEPT admin_users accounts, which may delete anyone.
//   4. profiles row: set workspace_role=NULL, agent_status='offline',
//      agent_extension=NULL. Keep id/email/name so historical refs work.
//   5. wk_voice_agent_limits: hide from leaderboard (show_on_leaderboard
//      = false). Don't delete — preserves spend history.
//   6. wk_dialer_queue: any row still assigned to this agent goes back
//      to the unassigned pool (agent_id=NULL). Pending rows stay pending
//      so the next agent picks them up. Dialing rows roll back to
//      pending so they don't get stuck.
//   7. wk_lead_assignments: rows assigned to this agent go back to
//      'unassigned' with agent_id=NULL.
//   8. wk_campaign_agents: hard-delete (this is just a join table for
//      "which agents may dial which campaigns" — the deleted agent
//      shouldn't appear in the picker).
//   9. Sign out any active sessions so the agent's browser stops
//      pointing at the workspace.
//  10. Audit-log the action.
//
// Body: { agent_id }
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

interface DeleteAgentBody {
  agent_id: string;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) return json(401, { error: 'Missing bearer token' });

    // Per-request client carrying the caller's JWT — used for the
    // wk_is_admin RPC which inspects auth.uid()/auth.email().
    const caller = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userResp, error: userErr } = await caller.auth.getUser(jwt);
    if (userErr || !userResp?.user) return json(401, { error: 'Invalid token' });
    const callerId = userResp.user.id;
    const callerEmail = userResp.user.email ?? '';

    const { data: isAdmin, error: adminErr } = await caller.rpc('wk_is_admin');
    if (adminErr) return json(500, { error: adminErr.message });
    if (!isAdmin) return json(403, { error: 'Admin only' });

    let body: DeleteAgentBody;
    try {
      body = (await req.json()) as DeleteAgentBody;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const agentId = (body.agent_id ?? '').trim();
    if (!agentId || !isUuid(agentId)) {
      return json(400, { error: 'Valid agent_id (uuid) required' });
    }
    if (agentId === callerId) {
      return json(400, { error: 'Cannot delete yourself' });
    }

    // Service-role client for privileged work
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // PR (Hugo 2026-04-28): super-admin override. Super-admin = email
    // exists in the admin_users allow-list table (same mechanism as
    // wk-voice-token / wk-spend-check). Only these accounts can delete
    // other admin accounts via the UI.
    const { data: superRow } = await admin
      .from('admin_users')
      .select('email')
      .ilike('email', callerEmail) // case-insensitive — admin_users.email has no lowercase constraint
      .maybeSingle();
    const isSuperAdmin = !!superRow;

    // Look up target — must exist and must NOT be an admin.
    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, email, name, workspace_role')
      .eq('id', agentId)
      .maybeSingle();
    if (targetErr) return json(500, { error: `Lookup: ${targetErr.message}` });
    if (!target) return json(404, { error: 'Agent not found' });
    if (target.workspace_role === 'admin' && !isSuperAdmin) {
      return json(403, {
        error:
          'Only the super-admin can delete other admins from the UI',
      });
    }

    // 1. Soft-delete the profile (clear workspace fields, keep PII for
    //    historical FK refs so wk_calls / wk_audit_log etc. don't dangle).
    const { error: profErr } = await admin
      .from('profiles')
      .update({
        workspace_role: null,
        agent_status: 'offline',
        agent_extension: null,
      })
      .eq('id', agentId);
    if (profErr) return json(500, { error: `Profile soft-delete: ${profErr.message}` });

    // 2. Hide from leaderboard (don't delete the row — preserves
    //    daily_spend_pence history for the report).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: limErr } = await (admin.from('wk_voice_agent_limits' as any) as any)
      .update({ show_on_leaderboard: false })
      .eq('agent_id', agentId);
    if (limErr) {
      // Non-fatal — log + continue.
      console.warn('[wk-delete-agent] limit hide failed:', limErr.message);
    }

    // 3. wk_dialer_queue — un-assign and roll any 'dialing' rows back
    //    to 'pending' so they get re-picked. Don't delete pending rows;
    //    they're still valid leads, just need to go back to the pool.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: queueDialingErr } = await (admin.from('wk_dialer_queue' as any) as any)
      .update({ agent_id: null, status: 'pending' })
      .eq('agent_id', agentId)
      .eq('status', 'dialing');
    if (queueDialingErr) {
      console.warn('[wk-delete-agent] queue dialing reset failed:', queueDialingErr.message);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: queueOtherErr } = await (admin.from('wk_dialer_queue' as any) as any)
      .update({ agent_id: null })
      .eq('agent_id', agentId)
      .neq('status', 'dialing');
    if (queueOtherErr) {
      console.warn('[wk-delete-agent] queue unassign failed:', queueOtherErr.message);
    }

    // 4. wk_lead_assignments — anything still assigned goes back to
    //    'unassigned' with agent_id NULL.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: laErr } = await (admin.from('wk_lead_assignments' as any) as any)
      .update({ agent_id: null, status: 'unassigned' })
      .eq('agent_id', agentId)
      .in('status', ['assigned', 'in_progress']);
    if (laErr) {
      console.warn('[wk-delete-agent] lead_assignments reset failed:', laErr.message);
    }

    // 5. wk_campaign_agents — drop their row(s). They no longer get to
    //    pick from those campaigns.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: caErr } = await (admin.from('wk_campaign_agents' as any) as any)
      .delete()
      .eq('agent_id', agentId);
    if (caErr) {
      console.warn('[wk-delete-agent] campaign_agents delete failed:', caErr.message);
    }

    // 6. Force any open sessions for this user to log out. Don't fail
    //    the whole call if signOut errors (it sometimes 404s when the
    //    user has no active sessions, which is fine).
    try {
      // Cast: signOut isn't on the @supabase/supabase-js type but is on
      // the live admin REST API.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.auth.admin as any).signOut?.(agentId);
    } catch (e) {
      console.warn('[wk-delete-agent] signOut skipped:', e);
    }

    // 7. Audit
    await admin.from('wk_audit_log').insert({
      actor_id: callerId,
      action: 'agent_deleted',
      entity_type: 'profile',
      entity_id: agentId,
      meta: { email: target.email, name: target.name, mode: 'soft' },
    });

    return json(200, {
      agent_id: agentId,
      email: target.email,
      mode: 'soft',
      ok: true,
    });
  } catch (e) {
    console.error('wk-delete-agent error', e);
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
