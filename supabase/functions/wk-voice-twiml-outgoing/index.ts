// wk-voice-twiml-outgoing — TwiML response when the browser Voice SDK initiates a dial.
//
// FLOW:
//   1. Agent presses "Call" in the softphone — Voice SDK connects to Twilio.
//   2. Twilio POSTs to this URL (configured on the TwiML App) with form-encoded params:
//      To=<dialed number>, From=client:<identity>, CallSid=<sid>, ...
//   3. We validate the X-Twilio-Signature, log the call into wk_calls, and return TwiML
//      that bridges to the dialed number with the agent's caller-ID and recording on.
//
// AUTH: validates Twilio signature only. Public function (verify_jwt = false).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const PUBLIC_FN_BASE = Deno.env.get('PUBLIC_FN_BASE')
  ?? `${SUPABASE_URL}/functions/v1`;

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
    'raw',
    enc.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return signature === expected;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// CANONICAL: src/features/smsv2/lib/buildOutgoingTwiml.ts (vitest pins this).
// Edge functions can't import from src/, so the body is mirrored here.
// Keep them in sync — tests live in the canonical location.
function buildOutgoingTwiml(args: {
  to: string;
  callerIdE164: string | null;
  statusUrl: string;
  recordingUrl: string;
  transcriptionCallbackUrl: string | null;
}): string {
  const callerIdAttr = args.callerIdE164
    ? `callerId="${escapeXml(args.callerIdE164)}"`
    : '';

  // PR 29: timeout bumped from default 30 → 60s so the callee has a
  // full minute to pick up before the leg drops. Mirrors the canonical
  // src/features/smsv2/lib/buildOutgoingTwiml.ts.
  const dialBlock = [
    `<Dial ${callerIdAttr} answerOnBridge="true" timeout="60" record="record-from-answer-dual"`,
    `      recordingStatusCallback="${escapeXml(args.recordingUrl)}"`,
    `      recordingStatusCallbackEvent="completed"`,
    `      action="${escapeXml(args.statusUrl)}"`,
    `      method="POST">`,
    `  <Number>${escapeXml(args.to)}</Number>`,
    `</Dial>`,
  ].join('\n');

  const transcriptionBlock = args.transcriptionCallbackUrl
    ? [
        `<Start>`,
        `  <Transcription`,
        `    statusCallbackUrl="${escapeXml(args.transcriptionCallbackUrl)}"`,
        `    statusCallbackMethod="POST"`,
        `    track="both_tracks"`,
        `    languageCode="en-GB"`,
        `    enableAutomaticPunctuation="true"`,
        `    profanityFilter="false"`,
        `    speechModel="telephony"`,
        `    inboundTrackLabel="agent"`,
        `    outboundTrackLabel="caller"`,
        `    partialResults="false"`,
        `  />`,
        `</Start>`,
      ].join('\n')
    : '';

  const body = [transcriptionBlock, dialBlock].filter((s) => s.length > 0).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${body}\n</Response>`;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // Twilio computed its signature against the public URL it POSTed to, not
    // the internal proxy URL `req.url` returns inside the Edge Function. We
    // must reconstruct the same public URL Twilio used (matches the Voice
    // URL configured on the TwiML App).
    const url = `${SUPABASE_URL}/functions/v1/wk-voice-twiml-outgoing`;
    const formData = await req.formData();
    const params: Record<string, string> = {};
    formData.forEach((v, k) => { params[k] = v.toString(); });

    // Validate Twilio signature
    const sig = req.headers.get('x-twilio-signature') ?? '';
    if (!TWILIO_AUTH_TOKEN || !sig
        || !(await validateTwilioSignature(TWILIO_AUTH_TOKEN, sig, url, params))) {
      console.warn('wk-voice-twiml-outgoing: invalid signature');
      return new Response('<Response><Reject/></Response>', {
        status: 403,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const to = (params.To ?? '').trim();
    const fromClient = (params.From ?? '').trim();    // expected: "client:<uuid>"
    const callSid = params.CallSid ?? '';
    // PR 145 (Hugo 2026-04-28): REVERT PR 143's colon-suffix parsing.
    // Identity is once again the bare profile UUID. The colon was a SIP
    // URI delimiter that Twilio mis-parsed at bridge time, causing
    // 13224 invalid-phone-number rejections on EVERY outbound call from
    // the browser. See wk-voice-token PR 145 comment for the full audit.
    const identity = fromClient.startsWith('client:') ? fromClient.slice(7) : null;
    // Optional: our pre-minted wk_calls.id baked in by wk-calls-create. When
    // present we UPDATE the existing row instead of inserting a duplicate.
    const preMintedCallId = (params.CallId ?? '').trim();
    const preContactId = (params.ContactId ?? '').trim() || null;

    if (!to) {
      return new Response('<Response><Say>Missing destination.</Say></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // PR 46 (Hugo 2026-04-27): parallel-dial branch. wk-dialer-start
    // originates calls with From=<twilio_number> (NOT 'client:<uuid>').
    // When the contact picks up, Twilio fetches THIS endpoint for
    // instructions. The right TwiML is to bridge the answered contact
    // to the agent's browser softphone via <Dial><Client>agent_id</Client></Dial>.
    // Returning the legacy <Dial><Number>To</Number></Dial> here would
    // dial the contact a SECOND time — broken since day one and the
    // root cause of "agent never enters the call room" + "no audio
    // bridge" on parallel dial.
    if (!identity) {
      // Look up the agent_id from wk_calls (wk-dialer-start pre-inserts
      // a row keyed on the Twilio CallSid before originating).
      const { data: dialerCall } = await supabase
        .from('wk_calls')
        .select('agent_id, ai_coach_enabled, campaign_id')
        .eq('twilio_call_sid', callSid)
        .maybeSingle();

      if (dialerCall?.agent_id && dialerCall?.campaign_id) {
        const transcriptionCallbackUrl = dialerCall.ai_coach_enabled
          ? `${PUBLIC_FN_BASE}/wk-voice-transcription`
          : null;
        if (transcriptionCallbackUrl) {
          // pre-warm the transcription pod (same as the agent-initiated path)
          void fetch(`${transcriptionCallbackUrl}?warmup=1`, { method: 'GET' }).catch(() => null);
        }
        const transcriptionBlock = transcriptionCallbackUrl
          ? [
              '<Start>',
              '  <Transcription',
              `    statusCallbackUrl="${escapeXml(transcriptionCallbackUrl)}"`,
              '    statusCallbackMethod="POST"',
              '    track="both_tracks"',
              '    languageCode="en-GB"',
              '    enableAutomaticPunctuation="true"',
              '    profanityFilter="false"',
              '    speechModel="telephony"',
              '    inboundTrackLabel="agent"',
              '    outboundTrackLabel="caller"',
              '    partialResults="false"',
              '  />',
              '</Start>',
            ].join('\n')
          : '';
        // PR 145 (Hugo 2026-04-28): REVERT PR 143's wk_voice_sessions
        // lookup. Dial the bare agent_id Client identity (matches what
        // wk-voice-token grants in the JWT). The colon-suffixed form
        // produced 13224 errors at every bridge.
        const dialBlock = [
          '<Dial answerOnBridge="true" timeout="60"',
          `      action="${escapeXml(`${PUBLIC_FN_BASE}/wk-voice-status`)}"`,
          '      method="POST">',
          `  <Client>${escapeXml(dialerCall.agent_id)}</Client>`,
          '</Dial>',
        ].join('\n');
        const body = [transcriptionBlock, dialBlock].filter((s) => s.length > 0).join('\n');
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${body}\n</Response>`;
        return new Response(twiml, {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        });
      }
      // No matching wk_calls row + no client identity: nothing safe to
      // do. Return a polite hangup so Twilio doesn't loop.
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Resolve agent + caller-ID number (agent-initiated path)
    let callerIdE164: string | null = null;
    let agentId: string | null = null;
    let numberId: string | null = null;

    if (identity) {
      agentId = identity;
      const { data: profile } = await supabase
        .from('profiles')
        .select('default_caller_id_number_id')
        .eq('id', identity)
        .maybeSingle();
      if (profile?.default_caller_id_number_id) {
        const { data: num } = await supabase
          .from('wk_numbers')
          .select('id, e164')
          .eq('id', profile.default_caller_id_number_id)
          .maybeSingle();
        if (num) {
          callerIdE164 = num.e164;
          numberId = num.id;
        }
      }
      // Fallback: first voice-enabled number
      if (!callerIdE164) {
        const { data: anyNum } = await supabase
          .from('wk_numbers')
          .select('id, e164')
          .eq('voice_enabled', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (anyNum) {
          callerIdE164 = anyNum.e164;
          numberId = anyNum.id;
        }
      }
    }

    // Best-effort log into wk_calls (failures don't break the dial).
    // If wk-calls-create already minted a row (CallId param baked in), we
    // UPDATE it with the Twilio CallSid + status='in_progress'. Otherwise
    // we INSERT (covers legacy paths and direct-dial without pre-mint).
    let aiCoachEnabledForThisCall = false;
    try {
      if (preMintedCallId) {
        await supabase.from('wk_calls').update({
          twilio_call_sid: callSid,
          number_id: numberId,
          status: 'in_progress',
          to_e164: to || null,
        }).eq('id', preMintedCallId);
        // Read back the flag set by wk-calls-create at mint time.
        const { data: row } = await supabase
          .from('wk_calls')
          .select('ai_coach_enabled')
          .eq('id', preMintedCallId)
          .maybeSingle();
        aiCoachEnabledForThisCall = !!row?.ai_coach_enabled;
      } else {
        await supabase.from('wk_calls').insert({
          twilio_call_sid: callSid,
          agent_id: agentId,
          contact_id: preContactId,
          number_id: numberId,
          direction: 'outbound',
          status: 'in_progress',
          to_e164: to || null,
          started_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('wk_calls upsert failed (continuing):', e);
    }

    // Real-time transcription via Twilio's <Start><Transcription> verb —
    // delivers transcript chunks over plain HTTP POST to wk-voice-transcription
    // (no WebSocket). Earlier <Start><Stream> + Supabase WebSocket bridge
    // failed reliably with Twilio error 31920; the HTTP path is rock-solid.
    // wk-voice-transcription itself enforces ai_coach_enabled + killswitch.
    const transcriptionCallbackUrl = aiCoachEnabledForThisCall
      ? `${PUBLIC_FN_BASE}/wk-voice-transcription`
      : null;

    // Pre-warm wk-voice-transcription so its pod is hot before Twilio fires
    // the first transcription-content webhook. HTTP cold start is way more
    // forgiving than WebSocket (no handshake budget) but a warm pod still
    // lands the first transcript line ~1s sooner.
    if (transcriptionCallbackUrl) {
      void fetch(`${transcriptionCallbackUrl}?warmup=1`, { method: 'GET' }).catch(() => null);
    }

    const twiml = buildOutgoingTwiml({
      to,
      callerIdE164,
      statusUrl: `${PUBLIC_FN_BASE}/wk-voice-status`,
      recordingUrl: `${PUBLIC_FN_BASE}/wk-voice-recording`,
      transcriptionCallbackUrl,
    });
    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    console.error('wk-voice-twiml-outgoing error', e);
    return new Response('<Response><Say>System error.</Say></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
});
