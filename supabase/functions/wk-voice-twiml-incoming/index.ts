// wk-voice-twiml-incoming — TwiML response when an inbound PSTN call hits a Twilio number.
//
// FLOW:
//   1. Caller dials our Twilio number — Twilio POSTs to this URL.
//   2. We validate the X-Twilio-Signature, look up the called number in wk_numbers,
//      pick a routing target (assigned agent → ring their browser <Client>;
//      otherwise fall back to voicemail).
//   3. We log the inbound leg into wk_calls and return TwiML.
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

// Mirror of wk-sms-incoming's phoneVariants (canonical + tests:
// api/lib/callback-attribution.ts). Formats Twilio might send vs what
// wk_contacts.phone might hold.
function phoneVariants(raw: string): { e164: string; digits: string; variants: string[] } {
  const trimmed = raw.replace(/^whatsapp:/, '').trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  const e164 = trimmed.startsWith('+') ? trimmed : `+${digits}`;
  const variants = Array.from(new Set([trimmed, e164, digits].filter(Boolean)));
  return { e164, digits, variants };
}

const CALLBACK_TAG = 'called-back';
const CALLBACK_WINDOW_DAYS = 30;

// Find the "Call back" column (the seeded Voicemail column,
// requires_followup=true) — preferring the pipeline the contact is
// already in, falling back to any pipeline's.
// deno-lint-ignore no-explicit-any
async function resolveCallbackColumnId(supabase: any, currentColumnId: string | null): Promise<string | null> {
  if (currentColumnId) {
    const { data: cur } = await supabase
      .from('wk_pipeline_columns')
      .select('pipeline_id')
      .eq('id', currentColumnId)
      .maybeSingle();
    if (cur?.pipeline_id) {
      const { data: vm } = await supabase
        .from('wk_pipeline_columns')
        .select('id')
        .eq('pipeline_id', cur.pipeline_id)
        .ilike('name', 'voicemail')
        .limit(1)
        .maybeSingle();
      if (vm?.id) return vm.id as string;
    }
  }
  const { data: anyVm } = await supabase
    .from('wk_pipeline_columns')
    .select('id')
    .ilike('name', 'voicemail')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (anyVm?.id as string | undefined) ?? null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // Use the public URL Twilio POSTed to, not req.url (proxied internal).
    // PUBLIC_FN_BASE matches the callback URLs we hand Twilio below and
    // the validation URL in wk-voicemail-transcribe.
    const url = `${PUBLIC_FN_BASE}/wk-voice-twiml-incoming`;
    const formData = await req.formData();
    const params: Record<string, string> = {};
    formData.forEach((v, k) => { params[k] = v.toString(); });

    const sig = req.headers.get('x-twilio-signature') ?? '';
    if (!TWILIO_AUTH_TOKEN || !sig
        || !(await validateTwilioSignature(TWILIO_AUTH_TOKEN, sig, url, params))) {
      console.warn('wk-voice-twiml-incoming: invalid signature');
      return new Response('<Response><Reject/></Response>', {
        status: 403,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const to = (params.To ?? '').trim();          // our Twilio number (E.164)
    const from = (params.From ?? '').trim();      // caller's number
    const callSid = params.CallSid ?? '';

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Look up the called number in wk_numbers (so we know how to route)
    const { data: num } = await supabase
      .from('wk_numbers')
      .select('id, e164, assigned_agent_id, voicemail_greeting_url')
      .eq('e164', to)
      .maybeSingle();

    // Voicemail-drop callback attribution (VM drop B8) — runs at the very
    // start, BEFORE routing to an agent or voicemail, so a MISSED callback
    // is flagged exactly like an answered one. If this caller was
    // voicemail-dropped in the last 30 days: permanent 'called-back' tag +
    // move to the Callback/Voicemail column. Canonical decision logic +
    // tests: api/lib/callback-attribution.ts (mirrored here — Deno can't
    // import api/). NOTE: this only fires for numbers whose Twilio Voice
    // URL points at this function — repointing a CRM number's inbound URL
    // here is a go-live step, not a code dependency.
    let contactId: string | null = null;
    try {
      const { variants: fromVariants } = phoneVariants(from);
      const { data: contactRow } = await supabase
        .from('wk_contacts')
        .select('id, pipeline_column_id')
        .in('phone', fromVariants)
        .limit(1)
        .maybeSingle();
      if (contactRow?.id) {
        contactId = contactRow.id as string;
        const since = new Date(Date.now() - CALLBACK_WINDOW_DAYS * 86_400_000).toISOString();
        const { data: droppedCall } = await supabase
          .from('wk_calls')
          .select('id')
          .eq('contact_id', contactId)
          .eq('direction', 'outbound')
          .eq('voicemail_dropped', true)
          .gte('started_at', since)
          .limit(1)
          .maybeSingle();
        if (droppedCall) {
          // .select() makes the upsert report whether it actually inserted:
          // [] = tag already existed. The column move runs only on the FIRST
          // callback — later inbound touches (or webhook retries) must not
          // clobber manual pipeline moves like an agent dragging the card
          // to Qualified.
          const { data: tagIns, error: tagErr } = await supabase
            .from('wk_contact_tags')
            .upsert(
              { contact_id: contactId, tag: CALLBACK_TAG },
              { onConflict: 'contact_id,tag', ignoreDuplicates: true },
            )
            .select('contact_id');
          if (tagErr) console.warn('[wk-voice-twiml-incoming] called-back tag failed:', tagErr.message);
          const isFirstCallback = Boolean(tagIns && tagIns.length > 0);
          if (isFirstCallback) {
            const columnId = await resolveCallbackColumnId(
              supabase,
              (contactRow.pipeline_column_id as string | null) ?? null,
            );
            if (columnId && columnId !== contactRow.pipeline_column_id) {
              const { error: moveErr } = await supabase
                .from('wk_contacts')
                .update({ pipeline_column_id: columnId })
                .eq('id', contactId);
              if (moveErr) console.warn('[wk-voice-twiml-incoming] callback column move failed:', moveErr.message);
            }
            console.log(`[wk-voice-twiml-incoming] dropped contact ${contactId} called back — tagged + moved`);
          }
        }
      }
    } catch (e) {
      console.warn('[wk-voice-twiml-incoming] callback attribution failed (continuing):', e);
    }

    let agentId: string | null = num?.assigned_agent_id ?? null;
    let agentClientIdentity: string | null = null;

    // 2026-05-21 (Hugo): always ring the assigned agent if their profile
    // exists. The old `agent_status !== 'offline'` gate sent calls to
    // voicemail whenever the agent hadn't manually toggled to 'available',
    // which was almost never. Now: if the number has an assigned agent,
    // we ring them; if their browser isn't open / doesn't pick up within
    // <Dial timeout="25">, wk-voice-status (the Dial action) returns the
    // voicemail TwiML.
    // Identity = profile UUID (matches what wk-voice-token grants — same
    // value the agent's Device registers under).
    if (agentId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', agentId)
        .maybeSingle();
      if (profile) {
        agentClientIdentity = profile.id;
      }
    }

    // Best-effort log into wk_calls
    try {
      await supabase.from('wk_calls').insert({
        twilio_call_sid: callSid,
        agent_id: agentId,
        contact_id: contactId,
        number_id: num?.id ?? null,
        direction: 'inbound',
        status: 'in_progress',
        from_e164: from,
        to_e164: to,
        started_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('wk_calls insert failed (continuing):', e);
    }

    const statusUrl = `${PUBLIC_FN_BASE}/wk-voice-status`;
    const recordingUrl = `${PUBLIC_FN_BASE}/wk-voice-recording`;
    const voicemailUrl = `${PUBLIC_FN_BASE}/wk-voicemail-transcribe`;

    // Route 1: agent online → ring their browser. Because <Dial> carries
    // an action URL, Twilio NEVER falls through to verbs after </Dial> —
    // it continues the call with whatever the action URL returns. So the
    // voicemail fallback for unanswered/busy/failed agent legs lives in
    // wk-voice-status, which returns the voicemail TwiML (greeting +
    // <Record> → wk-voicemail-transcribe) when DialCallStatus is not
    // 'completed'/'answered' on an inbound leg.
    if (agentClientIdentity) {
      const dial = [
        `<Dial answerOnBridge="true" timeout="25"`,
        `      record="record-from-answer-dual"`,
        `      recordingStatusCallback="${escapeXml(recordingUrl)}"`,
        `      recordingStatusCallbackEvent="completed"`,
        `      action="${escapeXml(statusUrl)}"`,
        `      method="POST">`,
        `  <Client>${escapeXml(agentClientIdentity)}</Client>`,
        `</Dial>`,
      ].join('\n');
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${dial}\n</Response>`;
      return new Response(twiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // Route 2: nobody to ring → voicemail straight away.
    const greeting = num?.voicemail_greeting_url
      ? `<Play>${escapeXml(num.voicemail_greeting_url)}</Play>`
      : `<Say voice="alice">Thanks for calling. Please leave a message after the beep.</Say>`;
    const vm = [
      greeting,
      `<Record maxLength="180" playBeep="true" finishOnKey="#"`,
      `        recordingStatusCallback="${escapeXml(voicemailUrl)}"`,
      `        recordingStatusCallbackEvent="completed"`,
      `        action="${escapeXml(statusUrl)}" method="POST"/>`,
    ].join('\n');
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${vm}\n</Response>`;
    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    console.error('wk-voice-twiml-incoming error', e);
    return new Response('<Response><Say>System error.</Say></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
});
