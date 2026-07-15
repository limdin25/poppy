// wk-dialer-hangup-leg — manually cancel a single ringing/connected leg.
// PR 89, Hugo 2026-04-27.
//
// Body: { call_id: string }  -- wk_calls.id (NOT the Twilio SID)
//
// Flow:
//   1. Verify JWT, look up agent.
//   2. Load wk_calls row, confirm it belongs to this agent.
//   3. POST to Twilio /Calls/{sid}.json with Status=canceled (or
//      completed if already in_progress).
//   4. UPDATE wk_calls.status = 'canceled', ended_at = now().
//
// Hugo's complaint: "the hang-up button on the parallel dialer board
// does nothing." Fixed.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Body {
  call_id?: string;
}

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
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

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: userResp, error: userErr } = await supa.auth.getUser(jwt);
    if (userErr || !userResp?.user) return json(401, { error: 'Invalid token' });
    const agentId = userResp.user.id;

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }

    const callId = (body.call_id ?? '').trim();
    if (!callId) return json(400, { error: 'call_id required' });

    // Look up the call row.
    const { data: call, error: callErr } = await supa
      .from('wk_calls')
      .select('id, agent_id, contact_id, campaign_id, twilio_call_sid, status')
      .eq('id', callId)
      .maybeSingle();
    if (callErr) return json(500, { error: callErr.message });
    if (!call) return json(404, { error: 'Call not found' });

    const row = call as {
      id: string;
      agent_id: string | null;
      contact_id: string | null;
      campaign_id: string | null;
      twilio_call_sid: string | null;
      status: string;
    };
    // PR 123 (Hugo 2026-04-28): admins can hang up ANY leg for support
    // / debugging. Agents can only hang up their own. Without the
    // admin escape hatch, a stuck call belonging to another agent was
    // unkillable from the UI.
    let isAdmin = false;
    {
      const { data: roleRow } = await supa
        .from('profiles')
        .select('workspace_role')
        .eq('id', agentId)
        .maybeSingle();
      const role = (roleRow as { workspace_role?: string | null } | null)?.workspace_role;
      isAdmin = role === 'admin';
    }
    if (row.agent_id && row.agent_id !== agentId && !isAdmin) {
      return json(403, { error: 'Not your call' });
    }

    // Already terminal? No-op success.
    const TERMINAL = new Set([
      'completed', 'canceled', 'failed', 'no_answer',
      'busy', 'missed', 'voicemail',
    ]);
    if (TERMINAL.has(row.status)) {
      return json(200, { status: row.status, already_terminal: true });
    }

    // PR 123 (Hugo 2026-04-28): cancel the Twilio leg with retry logic.
    // Twilio's status verbs:
    //   - `canceled` works on queued/ringing legs (no billing).
    //   - `completed` works on in-progress legs (already connected).
    // The local `status` value can be stale (AMD may have flipped a
    // ringing leg to in_progress on Twilio's side without our webhook
    // landing yet), so try `canceled` first, fall back to `completed`
    // when Twilio rejects with "Call is not in-progress" or similar.
    if (row.twilio_call_sid && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      const verbs = row.status === 'in_progress' ? ['completed', 'canceled'] : ['canceled', 'completed'];
      for (const verb of verbs) {
        const tw = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${row.twilio_call_sid}.json`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ Status: verb }).toString(),
          }
        );
        if (tw.ok) break;
        const errText = await tw.text().catch(() => '');
        console.warn('[wk-dialer-hangup-leg] twilio rejected', verb, tw.status, errText);
        // If Twilio says the call is already terminal, stop retrying.
        if (tw.status === 404 || /not.*found/i.test(errText)) break;
      }
    }

    const { error: updErr } = await supa
      .from('wk_calls')
      .update({
        status: 'canceled',
        ended_at: new Date().toISOString(),
      })
      .eq('id', callId);
    if (updErr) return json(500, { error: updErr.message });

    // PR 129 (Hugo 2026-04-28): mark the queue row 'missed', NOT
    // 'pending'. Hugo's mental model: "I called them, that's done."
    // PR 123 reverted to 'pending' so the contact could be re-picked,
    // but that meant Done counter undercounted by every Cancel +
    // every no-answer auto-hangup. Now Cancel = a completed attempt
    // that lands in the Missed bucket. Hugo can manually retry from
    // /crm/contacts if needed.
    if (row.contact_id && row.campaign_id) {
      await supa
        .from('wk_dialer_queue')
        .update({ status: 'missed' })
        .eq('contact_id', row.contact_id)
        .eq('campaign_id', row.campaign_id)
        .eq('status', 'dialing');
    }

    return json(200, { status: 'canceled' });
  } catch (e) {
    console.error('[wk-dialer-hangup-leg] threw', e);
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
