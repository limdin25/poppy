// wk-spend-check — pre-dial gate.
//
// Frontend (softphone, dialer) calls this BEFORE every outbound dial.
// Returns: { allowed: bool, reason: string, daily_spend_pence, daily_limit_pence }
//
// AUTH: Supabase JWT — agent must be authenticated. The RPC enforces "you can
// only check your own spend (or admin can check anyone)".

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userResp, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userResp?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const callerId = userResp.user.id;
    const callerEmail = userResp.user.email ?? '';
    // Admin = email exists in the admin_users allow-list table
    const { data: adminRow } = await supabase
      .from('admin_users')
      .select('email')
      .ilike('email', callerEmail) // case-insensitive — admin_users.email has no lowercase constraint
      .maybeSingle();
    const isAdmin = !!adminRow;

    let body: { agent_id?: string };
    try { body = await req.json(); } catch { body = {}; }
    const targetAgentId = body.agent_id ?? callerId;

    // Non-admins may only check their own spend
    if (!isAdmin && targetAgentId !== callerId) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await supabase.rpc('wk_check_spend', { p_agent_id: targetAgentId });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('wk-spend-check error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
