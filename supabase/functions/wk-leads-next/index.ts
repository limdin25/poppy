// wk-leads-next — atomic SKIP-LOCKED next-lead picker for the dialer.
//
// Frontend calls this when:
//   - Auto-advance timer fires after a post-call outcome
//   - Agent clicks "📞 Now" to skip the wait
//   - Parallel dialer wants to grab N leads at once (call N times)
//
// Returns the contact + queue row, with the queue marked 'dialing'.
// Pre-fetches contact, recent SMS, recent calls so the live-call screen
// renders with full context BEFORE the actual Twilio dial begins.
//
// AUTH: Supabase JWT.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface NextBody {
  campaign_id?: string | null;
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

    const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userResp, error: userErr } = await supabaseService.auth.getUser(jwt);
    if (userErr || !userResp?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const agentId = userResp.user.id;

    let body: NextBody;
    try { body = await req.json(); } catch { body = {}; }

    // Pick next lead atomically
    const { data: picked, error: pickErr } = await supabaseService.rpc('wk_pick_next_lead', {
      p_agent_id: agentId,
      p_campaign_id: body.campaign_id ?? null,
    });
    if (pickErr) {
      return new Response(JSON.stringify({ error: pickErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const row = (picked as { queue_id: string; contact_id: string; campaign_id: string; attempts: number }[])?.[0];
    if (!row) {
      return new Response(JSON.stringify({ empty: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Pre-fetch context in parallel
    const [contactRes, callsRes, intelRes] = await Promise.all([
      supabaseService
        .from('wk_contacts')
        .select('id, name, phone, email, pipeline_column_id, deal_value_pence, is_hot, custom_fields, last_contact_at')
        .eq('id', row.contact_id)
        .maybeSingle(),
      supabaseService
        .from('wk_calls')
        .select('id, direction, status, duration_sec, agent_note, started_at, ended_at')
        .eq('contact_id', row.contact_id)
        .order('started_at', { ascending: false })
        .limit(5),
      supabaseService
        .from('wk_call_intelligence')
        .select('summary, sentiment, talk_ratio, next_steps')
        .in('call_id', [])
        .limit(0), // placeholder; loaded by frontend per-call
    ]);

    return new Response(JSON.stringify({
      queue_id:    row.queue_id,
      campaign_id: row.campaign_id,
      attempts:    row.attempts,
      contact:     contactRes.data,
      recent_calls: callsRes.data ?? [],
      _intel_unused: intelRes.data ?? [],
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('wk-leads-next error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
