// wk-voice-status — Twilio call lifecycle webhook.
//
// Twilio POSTs here on:
//   - statusCallback events (initiated, ringing, answered, completed)
//   - <Dial action=...> (when a Dial verb finishes — gives DialCallStatus, DialCallDuration)
//   - <Record action=...> (after recording verb finishes)
//
// We update wk_calls (status, duration, ended_at), enqueue a post-call AI job
// when a call completes, and on any DB failure write to wk_webhook_outbox so
// reconciliation can retry later.
//
// AUTH: validates Twilio signature only. Public function (verify_jwt = false).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
// Same env-overridable base the TwiML generators use to build callback
// URLs — the signature-validation URL must equal the URL Twilio was given.
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

// PR 46 (Hugo 2026-04-27): hang up a Twilio call by SID. Used when
// the parallel-dial winner orchestration cancels losing legs.
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
  }).catch((e) => console.warn('[wk-voice-status] hangup failed', callSid, e));
}

// PR 46 (Hugo 2026-04-27): when one leg of a parallel dial answers,
// claim the winner atomically, hang up the losing legs, and broadcast
// to the agent's frontend so LiveCallScreen takes over. Idempotent:
// if a winner is already claimed for this contact+agent, a second
// in-progress event is a no-op (claim returns null) and we do nothing.
//
// Why this lives in wk-voice-status (not wk-dialer-answer):
//   wk-dialer-start sets StatusCallback=wk-voice-status. Twilio sends
//   the in-progress event here, not to wk-dialer-answer. Rather than
//   re-pointing Twilio (and managing two endpoints with overlapping
//   responsibilities), wk-voice-status now owns winner orchestration
//   for any wk_calls row whose campaign_id is set.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runWinnerOrchestration(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: any,
  callSid: string,
  answeredBy: string | null,
): Promise<void> {
  // Machine-answered legs are NOT winners (let voicemail logic run).
  if (answeredBy && answeredBy.startsWith('machine')) return;

  // Resolve this call's row.
  const { data: thisCall } = await supa
    .from('wk_calls')
    .select('id, agent_id, contact_id, campaign_id, ai_coach_enabled')
    .eq('twilio_call_sid', callSid)
    .maybeSingle();

  if (!thisCall || !thisCall.campaign_id || !thisCall.agent_id) {
    // Not a parallel-dial leg (no campaign or no agent).
    return;
  }

  // Atomically claim the winner slot — only one row across racing legs
  // succeeds. If status already 'connected', this returns no row.
  const { data: claimed } = await supa
    .from('wk_dialer_queue')
    .update({ status: 'connected' })
    .eq('contact_id', thisCall.contact_id)
    .eq('agent_id', thisCall.agent_id)
    .eq('status', 'dialing')
    .select('id')
    .maybeSingle();

  if (!claimed) {
    // Another leg already won — hang this one up rather than letting
    // it ring through. Late events are ignored harmlessly.
    await twilioHangup(callSid);
    return;
  }

  // Mark this call as 'answered' so the UI shows the winner.
  await supa.from('wk_calls').update({
    status: 'in_progress',
    answered_at: new Date().toISOString(),
  }).eq('id', thisCall.id);

  // Hang up every other ringing leg for the same agent + campaign.
  // Capture each loser's contact_id so we can increment their
  // wk_dialer_queue.attempts counter (PR 54 — three-strikes rule).
  const { data: losers } = await supa.from('wk_calls')
    .select('twilio_call_sid, contact_id')
    .eq('agent_id', thisCall.agent_id)
    .eq('campaign_id', thisCall.campaign_id)
    .in('status', ['queued', 'ringing'])
    .neq('id', thisCall.id);

  for (const l of losers ?? []) {
    if (l.twilio_call_sid) await twilioHangup(l.twilio_call_sid);
  }

  // PR 54 (Hugo 2026-04-27): when losing legs are returned to the
  // queue, increment attempts + bump priority so they go to the
  // BACK. Old behaviour rolled them straight back to 'pending' with
  // no counter change → wk_pick_next_lead picked the same contact
  // again on the next burst. The wk_dialer_three_strikes RPC
  // (migration 20260430000019) handles attempts >= 3 → status='lost'
  // + auto-activity, so we don't need to special-case that here.
  const loserContactIds = (losers ?? [])
    .map((l: { twilio_call_sid: string | null; contact_id: string | null }) => l.contact_id)
    .filter((id: string | null): id is string => !!id);

  if (loserContactIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supa as any).rpc(
      'wk_dialer_strike_losers',
      {
        p_campaign_id: thisCall.campaign_id,
        p_contact_ids: loserContactIds,
      },
    );
    if (rpcErr) {
      console.warn('[wk-voice-status] strike-losers rpc failed', rpcErr);
      // Fallback to the old behaviour so dial still progresses if the
      // RPC isn't deployed yet.
      await supa.from('wk_dialer_queue')
        .update({ status: 'pending', agent_id: null })
        .eq('agent_id', thisCall.agent_id)
        .eq('campaign_id', thisCall.campaign_id)
        .eq('status', 'dialing');
    }
  } else {
    // No loser contacts (shouldn't happen for parallel dial > 1) —
    // still clear any leftover 'dialing' rows for safety.
    await supa.from('wk_dialer_queue')
      .update({ status: 'pending', agent_id: null })
      .eq('agent_id', thisCall.agent_id)
      .eq('campaign_id', thisCall.campaign_id)
      .eq('status', 'dialing');
  }

  // Broadcast — frontend morphs Parallel Dialer → Live Call screen.
  // ActiveCallContext listens on dialer:<agentId> and reads payload
  // to load contact context + show LiveCallScreen.
  await supa.channel(`dialer:${thisCall.agent_id}`)
    .send({
      type: 'broadcast',
      event: 'winner',
      payload: {
        call_id: thisCall.id,
        contact_id: thisCall.contact_id,
        twilio_call_sid: callSid,
        ai_coach_enabled: !!thisCall.ai_coach_enabled,
      },
    })
    .catch((e: unknown) => console.warn('[wk-voice-status] broadcast failed', e));
}

// PR 37: kick wk-jobs-worker fire-and-forget after queueing post-call
// jobs. Wrapped in EdgeRuntime.waitUntil so the call survives the
// 200 response — earlier void-fetch was being cancelled.
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
        console.warn('[wk-voice-status] kick wk-jobs-worker non-2xx', r.status);
      }
    })
    .catch((e) => {
      console.warn('[wk-voice-status] kick wk-jobs-worker failed', e);
    });
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === 'function') {
    er.waitUntil(promise);
  } else {
    void promise;
  }
}

// Map Twilio CallStatus → our wk_calls.status enum
function mapStatus(twilioStatus: string): string {
  switch (twilioStatus) {
    case 'queued':
    case 'initiated':
    case 'ringing':
      return 'ringing';
    case 'in-progress':
    case 'answered':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'busy':
      return 'busy';
    case 'no-answer':
      return 'no_answer';
    case 'canceled':
      return 'canceled';
    case 'failed':
      return 'failed';
    default:
      return twilioStatus;
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    // Use the public URL Twilio POSTed to, not req.url (proxied internal).
    const url = `${PUBLIC_FN_BASE}/wk-voice-status`;
    const formData = await req.formData();
    const params: Record<string, string> = {};
    formData.forEach((v, k) => { params[k] = v.toString(); });

    const sig = req.headers.get('x-twilio-signature') ?? '';
    if (!TWILIO_AUTH_TOKEN || !sig
        || !(await validateTwilioSignature(TWILIO_AUTH_TOKEN, sig, url, params))) {
      console.warn('wk-voice-status: invalid signature');
      return new Response('forbidden', { status: 403 });
    }

    const callSid = params.CallSid ?? '';
    // Twilio reports the final status under different keys depending on
    // which webhook fired (statusCallback vs Dial action vs Record action).
    const twilioStatus = (
      params.CallStatus ?? params.DialCallStatus ?? params.RecordingStatus ?? ''
    ).trim();
    const duration = parseInt(
      params.CallDuration ?? params.DialCallDuration ?? '0',
      10
    ) || 0;
    const answeredBy = params.AnsweredBy ?? null;        // 'human' | 'machine_*' (AMD)

    if (!callSid) {
      return new Response('ok', { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const mapped = mapStatus(twilioStatus);
    const isTerminal = ['completed', 'busy', 'no_answer', 'canceled', 'failed'].includes(mapped);
    const isAnswered = mapped === 'in_progress';

    const update: Record<string, unknown> = { status: mapped };
    if (duration > 0) update.duration_sec = duration;
    if (answeredBy) {
      // Map Twilio AnsweredBy values onto our 2-value enum.
      update.answered_by = answeredBy.startsWith('machine') ? 'machine' : 'human';
      // PR 123 (Hugo 2026-04-28): when AMD detects voicemail (machine_*)
      // mid-call, surface that on the leg's status so the parallel-dial
      // banner shows "Voicemail" on THIS leg specifically. Hugo's brief:
      // "show clear which one is the voicemail so the agent can press
      // the red button on it; leave the other two ringing."
      // We override mapped='in_progress' → 'voicemail'. Terminal status
      // (completed/canceled/etc.) keeps its mapped value.
      if (answeredBy.startsWith('machine') && mapped === 'in_progress') {
        update.status = 'voicemail';
      }
    }
    if (isTerminal) update.ended_at = new Date().toISOString();

    // PR 59 (Hugo 2026-04-27): capture both legs' Twilio CallSids so
    // wk-supervisor-join can target them when admin starts Listen /
    // Whisper. Twilio sends a webhook for the parent <Dial> call AND
    // a separate one for the spawned <Client> child leg. Differentiate
    // via the From / To params:
    //   - Parent call to PSTN: From=<our number>, To=<contact phone>
    //   - <Dial><Client> child: From=<our number>, To=client:<agent_uid>
    const fromParam = (params.From ?? '').toLowerCase();
    const toParam = (params.To ?? '').toLowerCase();
    if (toParam.startsWith('client:')) {
      update.agent_twilio_call_sid = callSid;
    } else if (fromParam && !fromParam.startsWith('client:')) {
      update.contact_twilio_call_sid = callSid;
    }

    const { error } = await supabase
      .from('wk_calls')
      .update(update)
      .eq('twilio_call_sid', callSid);

    if (error) {
      console.warn('wk_calls update failed, writing to outbox:', error.message);
      try {
        await supabase.from('wk_webhook_outbox').insert({
          event_kind: 'voice_status',
          payload: { callSid, params, mapped, duration, answeredBy },
          status: 'pending',
        });
      } catch (e2) {
        console.error('outbox insert also failed:', e2);
      }
    }

    // PR 46: when a parallel-dial leg picks up, run winner
    // orchestration BEFORE returning. Idempotent — if another leg
    // already claimed the winner, this is a no-op + hangs THIS leg.
    if (isAnswered) {
      try {
        await runWinnerOrchestration(supabase, callSid, answeredBy);
      } catch (e) {
        console.warn('[wk-voice-status] winner orchestration threw', e);
      }
    }

    // PR 129 (Hugo 2026-04-28): on terminal Twilio status, push the
    // matching wk_dialer_queue row out of 'dialing' so the Done
    // counter reflects reality and wk-dialer-tick doesn't later
    // revert it back to 'pending'. Mapping:
    //   completed (and was 'dialing', not winner) → 'missed'
    //     (rare — usually winner orchestration already moved it to
    //     'connected' on in_progress).
    //   no_answer / busy / failed / canceled → 'missed'
    // 'voicemail' is set on wk_calls earlier when AnsweredBy=machine
    // mid-call; the queue row is moved to 'voicemail' by the winner
    // orchestrator at that point. Don't double-write here.
    if (isTerminal) {
      try {
        const { data: callRow } = await supabase
          .from('wk_calls')
          .select('id, contact_id, campaign_id')
          .eq('twilio_call_sid', callSid)
          .maybeSingle();
        const cr = callRow as
          | { contact_id: string | null; campaign_id: string | null }
          | null;
        if (cr?.contact_id && cr?.campaign_id) {
          await supabase
            .from('wk_dialer_queue')
            .update({ status: 'missed' })
            .eq('contact_id', cr.contact_id)
            .eq('campaign_id', cr.campaign_id)
            .eq('status', 'dialing');
        }
      } catch (e) {
        console.warn('[wk-voice-status] queue terminal-update failed', e);
      }
    }

    // On terminal state → enqueue post-call AI + cost compute.
    if (isTerminal && mapped === 'completed') {
      try {
        await supabase.from('wk_jobs').insert([
          { kind: 'postcall_ai', payload: { call_sid: callSid }, status: 'pending' },
          { kind: 'compute_cost', payload: { call_sid: callSid }, status: 'pending' },
        ]);
      } catch (e) {
        console.warn('wk_jobs insert failed (non-fatal):', e);
      }
      // PR 37: also kick wk-jobs-worker so any pending recording_ingest
      // jobs from the recording webhook (which may have raced with this
      // status callback) get drained immediately. Wrapped in
      // EdgeRuntime.waitUntil so it survives the response.
      kickJobsWorker();
    }

    // Voicemail fallback for inbound calls: wk-voice-twiml-incoming's
    // Route 1 <Dial> carries action=<this URL>, so per TwiML semantics
    // verbs after </Dial> never run — Twilio continues with whatever WE
    // return here. If the agent leg wasn't answered, return the voicemail
    // TwiML (greeting + <Record> → wk-voicemail-transcribe) instead of
    // the empty <Response/>, which would hang up on the caller.
    const dialStatus = (params.DialCallStatus ?? '').trim();
    if (['no-answer', 'busy', 'failed', 'canceled'].includes(dialStatus)) {
      try {
        const { data: vmCall } = await supabase
          .from('wk_calls')
          .select('direction, number_id')
          .eq('twilio_call_sid', callSid)
          .maybeSingle();
        const vc = vmCall as { direction: string | null; number_id: string | null } | null;
        if (vc?.direction === 'inbound') {
          let greetingUrl: string | null = null;
          if (vc.number_id) {
            const { data: numRow } = await supabase
              .from('wk_numbers')
              .select('voicemail_greeting_url')
              .eq('id', vc.number_id)
              .maybeSingle();
            greetingUrl =
              (numRow as { voicemail_greeting_url: string | null } | null)
                ?.voicemail_greeting_url ?? null;
          }
          const voicemailUrl = `${PUBLIC_FN_BASE}/wk-voicemail-transcribe`;
          const statusUrl = `${PUBLIC_FN_BASE}/wk-voice-status`;
          const greeting = greetingUrl
            ? `<Play>${escapeXml(greetingUrl)}</Play>`
            : `<Say voice="alice">Sorry, no agents are available right now. Please leave a message after the beep.</Say>`;
          const vm = [
            greeting,
            `<Record maxLength="180" playBeep="true" finishOnKey="#"`,
            `        recordingStatusCallback="${escapeXml(voicemailUrl)}"`,
            `        recordingStatusCallbackEvent="completed"`,
            `        action="${escapeXml(statusUrl)}" method="POST"/>`,
          ].join('\n');
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${vm}\n</Response>`,
            { status: 200, headers: { 'Content-Type': 'text/xml' } }
          );
        }
      } catch (e) {
        console.warn('[wk-voice-status] voicemail fallback failed', e);
      }
    }

    // Twilio expects a 200 with empty TwiML on action callbacks.
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e) {
    console.error('wk-voice-status error', e);
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
});
