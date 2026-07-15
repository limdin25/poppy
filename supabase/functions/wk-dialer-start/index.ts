// wk-dialer-start — boots a parallel/power dialer session for an agent.
//
// Frontend calls this when agent clicks "▶ Start" on /smsv2/dialer.
// We:
//   1. Verify agent JWT + spend gate
//   2. Pull N leads atomically (N = campaign.parallel_lines, capped at 5)
//   3. For each lead, originate a Twilio call from one of our numbers to the
//      contact, with a TwiML pointing to wk-voice-twiml-outgoing.
//      The agent's browser <Client> is connected via the TwiML App, so when
//      one leg picks up, wk-dialer-answer hangs the others up and bridges
//      the winner to the agent.
//
// AUTH: Supabase JWT.
//
// NOTE: Phase 1 ships with `mode='power'` (one line at a time). The parallel
// orchestration of 2-5 lines is wired via parallel_lines + wk-dialer-answer
// but full UI is Phase 2 polish.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const PUBLIC_FN_BASE = Deno.env.get('PUBLIC_FN_BASE') ?? `${SUPABASE_URL}/functions/v1`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface StartBody {
  campaign_id: string;
  lines?: number;          // override campaign.parallel_lines (1-5)
  parallel_lines?: number; // PR 46 alias — older clients send this name
}

async function originateTwilioCall(
  to: string,
  from: string,
  twimlUrl: string,
  statusUrl: string
): Promise<{ sid: string } | { error: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { error: 'twilio creds not set' };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const form = new URLSearchParams({
    To: to,
    From: from,
    Url: twimlUrl,
    Method: 'POST',
    StatusCallback: statusUrl,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: 'initiated ringing answered completed',
    MachineDetection: 'Enable',
    Record: 'true',
    RecordingChannels: 'dual',
    RecordingStatusCallback: `${PUBLIC_FN_BASE}/wk-voice-recording`,
    RecordingStatusCallbackEvent: 'completed',
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!resp.ok) return { error: `twilio ${resp.status}: ${await resp.text()}` };
  const data = await resp.json();
  return { sid: data.sid };
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
    const agentId = userResp.user.id;

    let body: StartBody;
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

    // Spend + killswitch gate
    const { data: spend } = await supa.rpc('wk_check_spend', { p_agent_id: agentId });
    if (!(spend as { allowed?: boolean })?.allowed) {
      return new Response(JSON.stringify({ blocked: true, ...(spend as object) }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve campaign + agent's caller-ID + per-campaign assignments.
    //
    // PR 57 (Hugo 2026-04-27): when wk_campaign_numbers has rows for
    // this campaign, we ONLY use those numbers (priority ASC). Falls
    // back to the agent's default caller-ID and finally to any voice-
    // enabled workspace number when the campaign hasn't been
    // configured yet.
    //
    // wk_campaign_agents gating: when ANY rows exist for the
    // campaign, the dialing agent MUST be in that list. When no rows
    // exist (legacy / unconfigured), any signed-in agent may dial —
    // so existing campaigns keep working without a forced setup
    // step.
    const [{ data: campaign }, { data: profile }, campNumsRes, campAgentsRes] = await Promise.all([
      supa.from('wk_dialer_campaigns')
          .select('id, parallel_lines, ai_coach_enabled, is_active')
          .eq('id', body.campaign_id).maybeSingle(),
      supa.from('profiles')
          .select('default_caller_id_number_id').eq('id', agentId).maybeSingle(),
      supa.from('wk_campaign_numbers')
          .select('number_id, priority')
          .eq('campaign_id', body.campaign_id)
          .order('priority', { ascending: true }),
      supa.from('wk_campaign_agents')
          .select('agent_id')
          .eq('campaign_id', body.campaign_id),
    ]);
    if (!campaign || !campaign.is_active) {
      return new Response(JSON.stringify({ error: 'campaign not active' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Agent gating (PR 57).
    const agentAssignments = (campAgentsRes.data ?? []) as { agent_id: string }[];
    if (agentAssignments.length > 0) {
      const allowed = new Set(agentAssignments.map((r) => r.agent_id));
      if (!allowed.has(agentId)) {
        return new Response(JSON.stringify({
          error: 'Agent not assigned to this campaign',
          reason: 'not_in_wk_campaign_agents',
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Resolve from-number with the new priority chain.
    let from: string | null = null;
    const campNums = (campNumsRes.data ?? []) as { number_id: string; priority: number }[];
    if (campNums.length > 0) {
      // PR 57: pick the highest-priority assigned number that is
      // voice + sms enabled and exists in wk_numbers.
      const numIds = campNums.map((r) => r.number_id);
      const { data: nums } = await supa.from('wk_numbers')
        .select('id, e164, voice_enabled')
        .in('id', numIds);
      const byId = new Map((nums ?? []).map((n) => [n.id as string, n]));
      // Walk in campNums order (already sorted priority ASC) and
      // pick the first voice-enabled one we resolve.
      for (const cn of campNums) {
        const n = byId.get(cn.number_id);
        if (n?.voice_enabled && n.e164) {
          from = n.e164 as string;
          break;
        }
      }
    }
    // Fallback: agent's default caller-ID (legacy).
    if (!from && profile?.default_caller_id_number_id) {
      const { data: num } = await supa.from('wk_numbers')
        .select('e164').eq('id', profile.default_caller_id_number_id).maybeSingle();
      from = num?.e164 ?? null;
    }
    // Fallback: any voice-enabled workspace number.
    if (!from) {
      const { data: anyNum } = await supa.from('wk_numbers')
        .select('e164').eq('voice_enabled', true)
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      from = anyNum?.e164 ?? null;
    }
    if (!from) {
      return new Response(JSON.stringify({ error: 'no voice-enabled number' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PR 126 (Hugo 2026-04-28): power dialer only. Hugo's call:
    // "let's launch this with just a normal one number after the other.
    // No parallel — too complex." We hard-cap lines to 1 server-side
    // regardless of what the body / campaign says. The parallel_lines
    // column stays in the schema but is effectively ignored. Frontend
    // dropdown was also removed in this PR. Simpler, more reliable.
    const lines = 1;
    const twimlUrl = `${PUBLIC_FN_BASE}/wk-voice-twiml-outgoing`;
    const statusUrl = `${PUBLIC_FN_BASE}/wk-voice-status`;

    const fired: Array<{ contact_id: string; phone: string; sid?: string; error?: string }> = [];

    for (let i = 0; i < lines; i++) {
      const { data: picked } = await supa.rpc('wk_pick_next_lead', {
        p_agent_id: agentId,
        p_campaign_id: body.campaign_id,
      });
      const row = (picked as { queue_id: string; contact_id: string }[])?.[0];
      if (!row) break;

      const { data: contact } = await supa.from('wk_contacts')
        .select('phone').eq('id', row.contact_id).maybeSingle();
      if (!contact?.phone) continue;

      const result = await originateTwilioCall(contact.phone, from, twimlUrl, statusUrl);
      if ('error' in result) {
        fired.push({ contact_id: row.contact_id, phone: contact.phone, error: result.error });
        // Roll back the queue claim
        await supa.from('wk_dialer_queue')
          .update({ status: 'pending' }).eq('id', row.queue_id);
        continue;
      }

      // Link the call SID to the queue + log a wk_calls row
      await supa.from('wk_calls').insert({
        twilio_call_sid: result.sid,
        agent_id: agentId,
        contact_id: row.contact_id,
        campaign_id: body.campaign_id,
        direction: 'outbound',
        status: 'queued',
        ai_coach_enabled: !!campaign.ai_coach_enabled,
        from_e164: from,
        to_e164: contact.phone,
        started_at: new Date().toISOString(),
      });

      fired.push({ contact_id: row.contact_id, phone: contact.phone, sid: result.sid });
    }

    return new Response(JSON.stringify({
      campaign_id: body.campaign_id, lines, fired,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('wk-dialer-start error', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
