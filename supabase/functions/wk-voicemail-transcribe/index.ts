// wk-voicemail-transcribe — Twilio voicemail recording webhook.
//
// wk-voice-twiml-incoming's voicemail <Record> posts here when the caller's
// message finishes recording (recordingStatusCallback="completed"):
//   RecordingSid, RecordingUrl, RecordingDuration, CallSid, ...
//
// We:
//   1. Validate signature (fail-closed).
//   2. Insert a wk_recordings row pointing at Twilio's media URL — same shape
//      as wk-voice-recording (storage_path stays NULL until wk-jobs-worker
//      downloads + uploads to Supabase storage).
//   3. Enqueue a wk_jobs row (kind='recording_ingest') and kick the worker.
//   4. Mark the wk_calls row status='voicemail' if it's still unanswered.
//
// v1 records only — no transcription yet, despite the name; the name matches
// the callback URL wk-voice-twiml-incoming already points at.
//
// AUTH: validates Twilio signature only. Public function (verify_jwt = false).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
// Same env-overridable base wk-voice-twiml-incoming uses to build the
// recordingStatusCallback URL — the signature-validation URL must equal
// the URL Twilio was given.
const PUBLIC_FN_BASE = Deno.env.get('PUBLIC_FN_BASE')
  ?? `${SUPABASE_URL}/functions/v1`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-twilio-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Kick wk-jobs-worker so the ingest runs now (no scheduler polls it).
// Wrapped in EdgeRuntime.waitUntil so the runtime keeps the invocation
// alive past this webhook's 200 response — a bare void fetch gets
// cancelled the moment serve() returns on Deno Deploy.
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
        console.warn('[wk-voicemail-transcribe] kick wk-jobs-worker non-2xx', r.status);
      }
    })
    .catch((e) => {
      console.warn('[wk-voicemail-transcribe] kick wk-jobs-worker failed', e);
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

  // --- Pre-auth: parse + validate signature. Failures here must NOT
  // return 200 (that would let unauthenticated malformed POSTs succeed).
  // Use the public URL Twilio POSTed to, not req.url (proxied internal).
  const url = `${PUBLIC_FN_BASE}/wk-voicemail-transcribe`;
  const params: Record<string, string> = {};
  try {
    const formData = await req.formData();
    formData.forEach((v, k) => { params[k] = v.toString(); });
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const sig = req.headers.get('x-twilio-signature') ?? '';
  if (!TWILIO_AUTH_TOKEN || !sig
      || !(await validateTwilioSignature(TWILIO_AUTH_TOKEN, sig, url, params))) {
    console.warn('wk-voicemail-transcribe: invalid signature');
    return new Response('forbidden', { status: 403 });
  }

  // --- Post-auth processing: exceptions here return 200 TwiML so Twilio
  // doesn't retry-spam a signed request we simply failed to process.
  try {
    const callSid = params.CallSid ?? '';
    const recordingSid = params.RecordingSid ?? '';
    const recordingUrl = params.RecordingUrl ?? '';     // Twilio media URL (no extension)
    const recordingDuration = parseInt(params.RecordingDuration ?? '0', 10) || 0;
    const recordingChannels = parseInt(params.RecordingChannels ?? '1', 10) || 1;

    if (!recordingSid || !recordingUrl) {
      return new Response('ok', { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Resolve the wk_calls row by sid.
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
      kickJobsWorker();
    }

    // This recording is a voicemail — the <Record> only runs when nobody
    // answered — so flag the call. Guarded to unanswered statuses so we
    // never stomp a leg the status webhook already marked completed.
    const { error: vmErr } = await supabase
      .from('wk_calls')
      .update({ status: 'voicemail' })
      .eq('twilio_call_sid', callSid)
      .in('status', ['in_progress', 'ringing', 'no_answer', 'missed']);
    if (vmErr) console.warn('wk_calls voicemail update failed (non-fatal):', vmErr.message);

    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    console.error('wk-voicemail-transcribe error', e);
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
});
