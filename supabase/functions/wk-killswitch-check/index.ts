// wk-killswitch-check — read or toggle kill switches.
//
// GET-style: { action: 'state' } → returns the full kill-switch state map
//   (used by the dashboard live indicator + every dialer tick).
// POST-style: { action: 'set', kind, scope_agent_id, active, reason }
//   → admin-only flip. Audit-logged.
//
// AUTH: Supabase JWT. Toggling requires admin (enforced by RPC).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SetBody {
  action: 'set';
  kind: 'all_dialers' | 'agent_dialer' | 'ai_coach' | 'outbound';
  scope_agent_id: string | null;
  active: boolean;
  reason?: string;
}

interface StateBody {
  action: 'state';
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
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Per-request client carries the user JWT so the RPCs see auth.uid()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userResp, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userResp?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body: SetBody | StateBody;
    try { body = await req.json(); } catch { body = { action: 'state' }; }

    if (body.action === 'state' || !('action' in body)) {
      const { data, error } = await supabase.rpc('wk_killswitch_state');
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
    }

    if (body.action === 'set') {
      const { data, error } = await supabase.rpc('wk_set_killswitch', {
        p_kind: body.kind,
        p_scope_agent_id: body.scope_agent_id,
        p_active: body.active,
        p_reason: body.reason ?? null,
      });
      if (error) {
        const status = error.message?.includes('forbidden') ? 403 : 500;
        return new Response(JSON.stringify({ error: error.message }), {
          status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: data }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('wk-killswitch-check error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
