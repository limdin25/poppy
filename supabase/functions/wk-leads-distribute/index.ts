// wk-leads-distribute — admin/system endpoint that bulk-assigns
// queued leads to agents.
//
// Modes (per campaign):
//   - manual:       no-op (admin assigns by hand from the CRM)
//   - round_robin:  rotate through active agents
//   - pull:         leave unassigned; agents pull on demand from /smsv2/dialer
//
// AUTH: Supabase JWT — caller must be an admin (workspace_role='admin'
// or hardcoded admin email). The RPC `wk_is_admin` enforces this.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface DistributeBody {
  campaign_id: string;
  mode?: 'manual' | 'round_robin' | 'pull';
  agent_ids?: string[];        // override active agents (admin pick)
  limit?: number;              // max leads to distribute this call
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) {
      return new Response(JSON.stringify({ error: 'Missing bearer token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userResp, error: userErr } = await supa.auth.getUser(jwt);
    if (userErr || !userResp?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Admin-only: re-check via JWT-scoped client so the RPC sees auth.uid()
    const supaJwt = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: isAdmin } = await supaJwt.rpc('wk_is_admin');
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: DistributeBody;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!body.campaign_id) {
      return new Response(JSON.stringify({ error: 'campaign_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const mode = body.mode ?? 'round_robin';
    const cap = Math.max(1, Math.min(500, body.limit ?? 50));

    if (mode === 'pull' || mode === 'manual') {
      return new Response(JSON.stringify({ assigned: 0, mode }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve eligible agents
    let agents: string[] = body.agent_ids ?? [];
    if (agents.length === 0) {
      const { data: profs } = await supa.from('profiles')
        .select('id')
        .eq('workspace_role', 'agent')
        .neq('agent_status', 'offline');
      agents = (profs ?? []).map((p: { id: string }) => p.id);
    }
    if (agents.length === 0) {
      return new Response(JSON.stringify({ assigned: 0, reason: 'no_agents' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pull unassigned queue rows (agent_id IS NULL, status='pending')
    const { data: pending } = await supa.from('wk_dialer_queue')
      .select('id')
      .eq('campaign_id', body.campaign_id)
      .eq('status', 'pending')
      .is('agent_id', null)
      .order('priority', { ascending: false })
      .order('attempts', { ascending: true })
      .limit(cap);

    let assigned = 0;
    for (let i = 0; i < (pending?.length ?? 0); i++) {
      const row = pending![i];
      const agent = agents[i % agents.length];
      const { error } = await supa.from('wk_dialer_queue')
        .update({ agent_id: agent })
        .eq('id', row.id)
        .eq('status', 'pending')
        .is('agent_id', null);
      if (!error) assigned++;
    }

    return new Response(JSON.stringify({
      assigned, mode, agents: agents.length,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('wk-leads-distribute error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
