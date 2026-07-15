// wk-voice-recording — Twilio recording webhook.
//
// Twilio POSTs here when a recording completes (recordingStatusCallback="completed"):
//   RecordingSid, RecordingUrl, RecordingDuration, CallSid, ...
//
// We:
//   1. Validate signature.
//   2. Insert wk_recordings row pointing at Twilio's media URL (storage_path
//      stays NULL until wk-jobs-worker downloads + uploads to Supabase storage).
//   3. Enqueue a wk_jobs row (kind='recording_ingest') so the worker grabs the
//      audio asynchronously — keeps this webhook fast and idempotent.
//
// AUTH: validates Twilio signature only. Public function (verify_jwt = false).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
// Same env-overridable base the TwiML generators use to build the
// recordingStatusCallback URL — the signature-validation URL must equal
// the URL Twilio was given.
const PUBLIC_FN_BASE = Deno.env.get('PUBLIC_FN_BASE')
  ?? `${SUPABASE_URL}/functions/v1`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-twilio-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// PR 37 (Hugo 2026-04-27): the original PR 30 kick was a void fetch
// (fire-and-forget). On Deno Deploy the in-flight request is
// cancelled the moment serve() returns, so the worker barely has
// time to start before being killed — Hugo wasn't seeing recordings
// because the worker never actually ran.
//
// Fix: wrap the fetch in EdgeRuntime.waitUntil so the runtime keeps
// the worker invocation alive past the webhook's 200 response. Same
// pattern wk-voice-transcription uses for its OpenAI streaming.
function kickJobsWorker(): void {
  const url = `${SUPABASE_URL}/functions/v1/wk-jobs-worker`;
  const promise = fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
    .then((r) => {
      if (!r.ok) {
        console.warn('[wk-voice-recording] kick wk-jobs-worker non-2xx', r.status);
      }
    })
    .catch((e) => {
      console.warn('[wk-voice-recording] kick wk-jobs-worker failed', e);
    });
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === 'function') {
    er.waitUntil(promise);
  } else {
    void promise;
  }
}

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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // Use the public URL Twilio POSTed to, not req.url (proxied internal).
    const url = `${PUBLIC_FN_BASE}/wk-voice-recording`;
    const formData = await req.formData();
    const params: Record<string, string> = {};
    formData.forEach((v, k) => { params[k] = v.toString(); });

    const sig = req.headers.get('x-twilio-signature') ?? '';
    if (!TWILIO_AUTH_TOKEN || !sig
        || !(await validateTwilioSignature(TWILIO_AUTH_TOKEN, sig, url, params))) {
      console.warn('wk-voice-recording: invalid signature');
      return new Response('forbidden', { status: 403 });
    }

    const callSid = params.CallSid ?? '';
    const recordingSid = params.RecordingSid ?? '';
    const recordingUrl = params.RecordingUrl ?? '';     // Twilio media URL (no extension)
    const recordingDuration = parseInt(params.RecordingDuration ?? '0', 10) || 0;
    const recordingChannels = parseInt(params.RecordingChannels ?? '1', 10) || 1;

    if (!recordingSid || !recordingUrl) {
      return new Response('ok', { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Resolve the wk_calls row by sid (best-effort — the call row may not
    // exist yet if a webhook arrives out of order; the recording can still
    // be ingested and linked later).
    let callId: string | null = null;
    if (callSid) {
      const { data: call } = await supabase
        .from('wk_calls')
        .select('id')
        .eq('twilio_call_sid', callSid)
        .maybeSingle();
      callId = call?.id ?? null;
    }

    // Recording row needs a non-null call_id (FK NOT NULL). If we couldn't
    // resolve the parent call, write to outbox and let the worker retry.
    if (!callId) {
      // supabase-js returns DB errors in { error } — it does not throw.
      const { error: outboxErr } = await supabase.from('wk_webhook_outbox').insert({
        event_kind: 'voice_recording',
        payload: { callSid, recordingSid, recordingUrl, recordingDuration, recordingChannels },
        status: 'pending',
      });
      if (outboxErr) console.error('outbox insert failed:', outboxErr.message);
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // Insert recording row (idempotent on twilio_sid).
    const { error: recErr } = await supabase
      .from('wk_recordings')
      .upsert({
        call_id: callId,
        twilio_sid: recordingSid,
        twilio_media_url: recordingUrl,
        duration_sec: recordingDuration,
        channels: recordingChannels,
        status: 'pending',
      }, { onConflict: 'twilio_sid' });

    if (recErr) {
      console.warn('wk_recordings upsert failed, writing to outbox:', recErr.message);
      const { error: outboxErr } = await supabase.from('wk_webhook_outbox').insert({
        event_kind: 'voice_recording',
        payload: { callSid, recordingSid, recordingUrl, recordingDuration, recordingChannels },
        status: 'pending',
      });
      if (outboxErr) console.error('outbox insert also failed:', outboxErr.message);
    } else {
      // Enqueue ingest job (download Twilio media → upload to Supabase storage)
      const { error: jobErr } = await supabase.from('wk_jobs').insert({
        kind: 'recording_ingest',
        payload: { recording_sid: recordingSid, call_sid: callSid },
        status: 'pending',
      });
      if (jobErr) console.warn('wk_jobs insert failed (non-fatal):', jobErr.message);
      // PR 30 (Hugo 2026-04-27): no scheduler hits wk-jobs-worker so
      // pending recording_ingest jobs were sitting forever — that's
      // why the Calls page showed durations + transcripts but no
      // playable audio. Kick the worker fire-and-forget right now so
      // the Twilio media → Supabase storage upload happens within
      // seconds of the recording webhook. fetch is unawaited; if it
      // fails the next webhook (or a manual retry) will drain the row.
      kickJobsWorker();
    }

    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    console.error('wk-voice-recording error', e);
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
});
