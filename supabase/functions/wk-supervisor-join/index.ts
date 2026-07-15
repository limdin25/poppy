// wk-supervisor-join — admin Listen / Whisper on a live call.
// PR 59 (Hugo 2026-04-27).
//
// Body: { call_id: string, mode: 'listen' | 'whisper' }
//
// Flow when admin clicks Listen or Whisper in WatchAgentModal:
//   1. Verify the caller is an admin via wk_is_admin RPC.
//   2. Look up wk_calls row → grab agent_twilio_call_sid +
//      contact_twilio_call_sid (populated by wk-voice-status when
//      Twilio's call lifecycle webhook lands).
//   3. Generate / reuse conference_friendly_name = 'crm-call-<id>'.
//   4. Modify both legs (Twilio REST POST /Calls/{sid}.json with
//      Twiml=...) to redirect into that named Conference. This pulls
//      them out of the existing direct <Dial><Client> bridge and
//      puts them in the Conference room.
//   5. Originate a new outbound call to client:<admin_uid> with
//      TwiML that joins the same Conference with the supervisor flags:
//        - listen:  muted="true"  coaching="false"
//        - whisper: muted="false" coaching="true" callSidToCoach=<agent_sid>
//   6. Return { ok: true, conference_name }. The admin's browser
//      Twilio Device receives the incoming Client call automatically.
//
// On call hangup the existing wk-voice-status terminal path naturally
// drops the Conference (endConferenceOnExit on the agent's leg).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const TWIML_APP_SID = Deno.env.get('TWILIO_TWIML_APP_SID') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

interface JoinBody {
  call_id: string;
  mode: 'listen' | 'whisper';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function legTwiml(conferenceName: string, recordEnabled: boolean): string {
  // The contact + agent legs join a fresh Conference. startConferenceOnEnter
  // is true on both so audio flows the moment they're together.
  // endConferenceOnExit is true ONLY on the agent leg (set by
  // putAgentInConference below) so when the agent hangs up everyone is
  // disconnected. The admin doesn't end the conference on leave.
  // Recording is on the FIRST participant to enter — we set it on the
  // agent's TwiML below.
  void recordEnabled; // recording is on the agent leg, not here
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true">
    <Conference startConferenceOnEnter="true" endConferenceOnExit="false" beep="false">${escapeXml(conferenceName)}</Conference>
  </Dial>
</Response>`;
}

function agentLegTwiml(conferenceName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true">
    <Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false" record="record-from-start">${escapeXml(conferenceName)}</Conference>
  </Dial>
</Response>`;
}

async function modifyCall(callSid: string, twiml: string): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const body = new URLSearchParams({ Twiml: twiml });
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Twilio modify ${callSid} failed: ${r.status} ${t}`);
  }
}

async function originateAdminCall(
  adminUid: string,
  conferenceName: string,
  mode: 'listen' | 'whisper',
  agentCallSid: string,
): Promise<string> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  const muted = mode === 'listen';
  const coaching = mode === 'whisper';

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference
      startConferenceOnEnter="false"
      endConferenceOnExit="false"
      beep="false"
      muted="${muted ? 'true' : 'false'}"
      coach="${coaching ? agentCallSid : ''}"
    >${escapeXml(conferenceName)}</Conference>
  </Dial>
</Response>`;

  const form = new URLSearchParams({
    To: `client:${adminUid}`,
    From: `client:${adminUid}`,
    Twiml: twiml,
    // Some Twilio accounts require ApplicationSid for Client→Client calls.
    // If TWIML_APP_SID is set we include it as a hint; harmless otherwise.
    ...(TWIML_APP_SID ? { ApplicationSid: TWIML_APP_SID } : {}),
  });
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Twilio originate admin call failed: ${r.status} ${t}`);
  }
  const data = await r.json();
  return data.sid as string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const auth = req.headers.get('authorization') ?? '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) return json(401, { error: 'Missing bearer token' });

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const caller = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userResp, error: userErr } = await caller.auth.getUser(jwt);
    if (userErr || !userResp?.user) return json(401, { error: 'Invalid token' });

    const { data: isAdmin, error: adminErr } = await caller.rpc('wk_is_admin');
    if (adminErr) return json(500, { error: adminErr.message });
    if (!isAdmin) return json(403, { error: 'Admin only' });

    const adminUid = userResp.user.id;

    let body: JoinBody;
    try {
      body = (await req.json()) as JoinBody;
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }
    if (!body.call_id) return json(400, { error: 'call_id required' });
    if (body.mode !== 'listen' && body.mode !== 'whisper') {
      return json(400, { error: 'mode must be listen or whisper' });
    }

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return json(503, { error: 'Twilio creds not set on edge function secrets' });
    }

    // Resolve the live call's leg SIDs.
    const { data: call, error: callErr } = await supa
      .from('wk_calls')
      .select('id, agent_twilio_call_sid, contact_twilio_call_sid, twilio_call_sid, conference_friendly_name, status')
      .eq('id', body.call_id)
      .maybeSingle();
    if (callErr) return json(500, { error: callErr.message });
    if (!call) return json(404, { error: 'Call not found' });
    if (!['queued', 'ringing', 'answered', 'in_progress'].includes((call.status as string) ?? '')) {
      return json(400, { error: `Call is not live (status=${call.status})` });
    }

    // Resolve which SID is the contact leg vs the agent leg. For
    // dialer-originated calls wk_calls.twilio_call_sid is the
    // contact's Twilio CallSid (set by wk-dialer-start). The agent's
    // <Client> leg SID lands later when wk-voice-status sees the
    // <Client> child call. Some calls only have one SID populated.
    const contactSid =
      (call.contact_twilio_call_sid as string | null) ??
      (call.twilio_call_sid as string | null) ??
      null;
    const agentSid = (call.agent_twilio_call_sid as string | null) ?? null;

    if (!contactSid || !agentSid) {
      return json(409, {
        error: 'Both legs not yet wired for supervision',
        contact_sid_present: !!contactSid,
        agent_sid_present: !!agentSid,
        hint: 'wk-voice-status records leg SIDs as Twilio sends them. Try again in 1-2s after the call connects.',
      });
    }

    // Conference name: stable per call so re-joining a session works.
    const conferenceName =
      (call.conference_friendly_name as string | null) ?? `crm-call-${call.id}`;

    // Persist the conference name + ensure leg SIDs are stored before
    // we push Twilio (idempotent re-runs OK).
    await supa
      .from('wk_calls')
      .update({ conference_friendly_name: conferenceName })
      .eq('id', call.id);

    // Move both legs into the Conference. The agent leg's TwiML sets
    // record-from-start so the recording continues from the moment
    // the conference assembles. endConferenceOnExit is on the agent
    // leg only.
    await modifyCall(contactSid, legTwiml(conferenceName, false));
    await modifyCall(agentSid, agentLegTwiml(conferenceName));

    // Originate the admin's browser leg into the same conference.
    const adminCallSid = await originateAdminCall(
      adminUid,
      conferenceName,
      body.mode,
      agentSid,
    );

    return json(200, {
      ok: true,
      conference_name: conferenceName,
      admin_call_sid: adminCallSid,
      mode: body.mode,
    });
  } catch (e) {
    console.error('[wk-supervisor-join] threw', e);
    return json(500, { error: e instanceof Error ? e.message : 'Internal error' });
  }
});
