// wk-dialer-answer — first-answer-wins handler for the parallel dialer.
//
// Twilio fires its status webhook on every call. When the FIRST leg of a
// parallel-dial set picks up (CallStatus=in-progress, AnsweredBy=human|null),
// we:
//   1. Atomically claim the winning slot (UPDATE ... WHERE status='dialing'
//      RETURNING — only one row succeeds across all racing legs).
//   2. Hang up every losing leg via Twilio REST.
//   3. Patch the winning Twilio call's TwiML to bridge into the agent's
//      <Client> (the browser softphone) so the agent hears the lead.
//   4. Broadcast `dialer:winner` so the frontend morphs Parallel Dialer →
//      Live Call screen with pre-fetched context.
//
// AUTH: Twilio HMAC-SHA1 signature. verify_jwt = false.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN  = Deno.env.get('TWILIO_AUTH_TOKEN')  ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-twilio-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) data += key + params[key];
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return signature === expected;
}

async function twilioHangup(callSid: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const form = new URLSearchParams({ Status: 'completed' });
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  }).catch((e) => console.warn('hangup failed', callSid, e));
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const url = req.url;
    const formData = await req.formData();
    const params: Record<string, string> = {};
    formData.forEach((v, k) => { params[k] = v.toString(); });

    const sig = req.headers.get('x-twilio-signature') ?? '';
    if (!TWILIO_AUTH_TOKEN || !sig
        || !(await validateTwilioSignature(TWILIO_AUTH_TOKEN, sig, url, params))) {
      console.warn('wk-dialer-answer: invalid signature');
      return new Response('forbidden', { status: 403 });
    }

    const callSid = params.CallSid ?? '';
    const callStatus = (params.CallStatus ?? '').toLowerCase();
    const answeredBy = (params.AnsweredBy ?? '').toLowerCase();

    // Only act when the leg has actually been picked up by a human.
    // Twilio sends "in-progress" once the call is connected; AMD adds
    // AnsweredBy=human on later events. Machine-answered legs are NOT
    // winners — they keep going for voicemail leave-message logic.
    const isWinner =
      (callStatus === 'in-progress' || callStatus === 'answered')
      && (answeredBy === 'human' || answeredBy === '');

    if (!isWinner) {
      return new Response('ok', { status: 200 });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Find the dialing call row + queue row + agent + campaign
    const { data: thisCall } = await supa.from('wk_calls')
      .select('id, agent_id, contact_id, campaign_id, ai_coach_enabled')
      .eq('twilio_call_sid', callSid).maybeSingle();

    if (!thisCall) {
      return new Response('ok', { status: 200 });
    }

    // Atomically claim winner: only one queue row per (agent, campaign)
    // can flip from 'dialing' → 'connected' for a given dial burst.
    const { data: claimed } = await supa
      .from('wk_dialer_queue')
      .update({ status: 'connected' })
      .eq('contact_id', thisCall.contact_id)
      .eq('agent_id', thisCall.agent_id)
      .eq('status', 'dialing')
      .select('id')
      .maybeSingle();

    if (!claimed) {
      // Another leg already won — hang this one up.
      await twilioHangup(callSid);
      return new Response('ok', { status: 200 });
    }

    // Mark this call as the active one for the agent
    await supa.from('wk_calls').update({
      status: 'answered',
      answered_at: new Date().toISOString(),
    }).eq('id', thisCall.id);

    // Hang up every other in-flight leg for the same agent in this
    // campaign. PR 123 (Hugo 2026-04-28): widened from `eq('queued')`
    // to `in (queued, ringing, voicemail)` — previously a sibling that
    // had advanced to ringing or hit voicemail kept ringing the contact
    // for up to 60s after the winner connected.
    if (thisCall.agent_id && thisCall.campaign_id) {
      const { data: losers } = await supa.from('wk_calls')
        .select('twilio_call_sid')
        .eq('agent_id', thisCall.agent_id)
        .eq('campaign_id', thisCall.campaign_id)
        .in('status', ['queued', 'ringing', 'voicemail'])
        .neq('id', thisCall.id);

      for (const l of losers ?? []) {
        if (l.twilio_call_sid) await twilioHangup(l.twilio_call_sid);
      }

      // Roll losing queue rows back to pending so they're re-dialed later
      await supa.from('wk_dialer_queue')
        .update({ status: 'pending', agent_id: null })
        .eq('agent_id', thisCall.agent_id)
        .eq('campaign_id', thisCall.campaign_id)
        .eq('status', 'dialing');
    }

    // Realtime broadcast — frontend morphs Parallel Dialer → Live Call.
    // PR 96: include campaign_id so the live-call screen can thread it
    // into MidCallSmsSender → wk_campaign_numbers resolution.
    await supa.channel(`dialer:${thisCall.agent_id}`)
      .send({
        type: 'broadcast',
        event: 'winner',
        payload: {
          call_id: thisCall.id,
          contact_id: thisCall.contact_id,
          campaign_id: thisCall.campaign_id ?? null,
          twilio_call_sid: callSid,
          ai_coach_enabled: !!thisCall.ai_coach_enabled,
        },
      })
      .catch((e) => console.warn('broadcast failed', e));

    // No TwiML returned to Twilio — this is a status callback, not a TwiML
    // request. The original outbound TwiML (wk-voice-twiml-outgoing) has
    // already bridged the agent's <Client> on answerOnBridge.
    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('wk-dialer-answer error', e);
    return new Response('error', { status: 500 });
  }
});
