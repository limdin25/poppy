// wk-voicemail-drop — agent-pressed voicemail drop on the speed dialer.
//
// Body: { call_id: string }  -- wk_calls.id (NOT the Twilio SID)
//
// The agent's ear hears the voicemail greeting and taps "Drop VM". We
// replace the CONTACT (child) leg's TwiML with <Play>{campaign recording}
// </Play><Hangup/>: the leg leaves the bridge, the message lands in the
// voicemail box, and Twilio runs the <Dial> action on the agent leg —
// which returns an empty <Response/> and frees the agent instantly.
//
// CANONICAL LOGIC: api/lib/voicemail-drop.ts (`executeVoicemailDrop`,
// vitest-pinned in tests/voicemail-drop.test.ts). Deno deploy can't import
// from api/, so the decision logic is mirrored here. Change both together.

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

const json = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Mirror of buildDropTwiml (api/lib/voicemail-drop.ts).
function buildDropTwiml(recordingUrl: string): string {
  const url = recordingUrl.trim();
  if (!url) throw new Error('recordingUrl is required');
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`recordingUrl must be an http(s) URL: ${url}`);
  return `<Response><Play>${escapeXml(url)}</Play><Hangup/></Response>`;
}

const TERMINAL = new Set([
  'completed', 'canceled', 'failed', 'no_answer', 'busy', 'missed', 'voicemail',
]);

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

    let body: { call_id?: string };
    try {
      body = (await req.json()) as { call_id?: string };
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }
    const callId = (body.call_id ?? '').trim();
    if (!callId) return json(400, { error: 'call_id required' });

    const { data: call, error: callErr } = await supa
      .from('wk_calls')
      .select('id, agent_id, campaign_id, status, twilio_call_sid, contact_twilio_call_sid, voicemail_dropped')
      .eq('id', callId)
      .maybeSingle();
    if (callErr) return json(500, { error: callErr.message });
    if (!call) return json(404, { error: 'Call not found' });
    const row = call as {
      id: string;
      agent_id: string | null;
      campaign_id: string | null;
      status: string;
      twilio_call_sid: string | null;
      contact_twilio_call_sid: string | null;
      voicemail_dropped: boolean;
    };

    // Same admin escape hatch as wk-dialer-hangup-leg (PR 123).
    let isAdmin = false;
    {
      const { data: roleRow } = await supa
        .from('profiles')
        .select('workspace_role')
        .eq('id', agentId)
        .maybeSingle();
      isAdmin = (roleRow as { workspace_role?: string | null } | null)?.workspace_role === 'admin';
    }

    if (row.agent_id && row.agent_id !== agentId && !isAdmin) {
      return json(403, { error: 'Not your call' });
    }
    if (row.voicemail_dropped) return json(200, { ok: true, already_dropped: true });
    if (TERMINAL.has(row.status)) return json(409, { error: `Call already ended (${row.status})` });
    if (!row.campaign_id) return json(400, { error: 'Call has no campaign' });

    const { data: campaign } = await supa
      .from('wk_dialer_campaigns')
      .select('voicemail_recording_url, voicemail_drop_enabled')
      .eq('id', row.campaign_id)
      .maybeSingle();
    const camp = campaign as { voicemail_recording_url: string | null; voicemail_drop_enabled: boolean } | null;
    if (!camp?.voicemail_recording_url) {
      return json(400, { error: 'No voicemail recording uploaded for this campaign' });
    }
    if (!camp.voicemail_drop_enabled) {
      return json(400, { error: 'Voicemail drop is disabled for this campaign' });
    }

    const authHeader = 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    // Contact (child) leg SID: Option A capture (wk-voice-status), else
    // Option B — derive from Twilio via ParentCallSid.
    let contactSid = row.contact_twilio_call_sid;
    if (!contactSid) {
      if (!row.twilio_call_sid) return json(409, { error: 'Call has no Twilio SID yet' });
      const lookup = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json?ParentCallSid=${row.twilio_call_sid}`,
        { headers: { Authorization: authHeader } },
      );
      if (lookup.ok) {
        const j = (await lookup.json()) as { calls?: Array<{ sid?: string }> };
        contactSid = j.calls?.[0]?.sid ?? null;
      }
      if (!contactSid) return json(409, { error: 'Contact leg not found — has the call connected?' });
    }

    const tw = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${contactSid}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ Twiml: buildDropTwiml(camp.voicemail_recording_url) }).toString(),
      },
    );
    if (!tw.ok) {
      const detail = await tw.text().catch(() => '');
      console.warn('[wk-voicemail-drop] twilio rejected', tw.status, detail);
      return json(502, { error: 'Twilio rejected the drop', detail });
    }

    const { error: updErr } = await supa
      .from('wk_calls')
      .update({ voicemail_dropped: true, voicemail_dropped_at: new Date().toISOString() })
      .eq('id', callId);
    if (updErr) return json(500, { error: updErr.message, dropped: true });

    return json(200, { ok: true, contact_call_sid: contactSid });
  } catch (e) {
    console.error('[wk-voicemail-drop] threw', e);
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
