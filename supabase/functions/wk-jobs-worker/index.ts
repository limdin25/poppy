// wk-jobs-worker — pulls pending wk_jobs rows and dispatches them.
//
// Runs from pg_cron every 30s (configured in the migration as a separate task).
// Uses SELECT ... FOR UPDATE SKIP LOCKED so multiple invocations don't double-process.
//
// JOB KINDS handled here (Phase 1 stubs — full implementations land in later steps):
//   - recording_ingest   download Twilio media, upload to call-recordings bucket,
//                        update wk_recordings.storage_path + ingest_status
//   - postcall_ai        Whisper + GPT-4o-mini summary  → wk_transcripts +
//                        wk_call_intelligence  (delegates to wk-ai-postcall when
//                        that function ships)
//   - compute_cost       pull Twilio price + sum AI costs → wk_voice_call_costs
//                        and increment wk_voice_agent_limits.daily_spend_pence
//   - send_sms           outcome automation → sends a Twilio SMS inline and
//                        records it in wk_sms_messages
//   - outbox_retry       replays a wk_webhook_outbox row that failed earlier
//
// AUTH: callable only by service role (verify_jwt = false but we check the
// Authorization bearer matches SUPABASE_SERVICE_ROLE_KEY).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const BATCH_SIZE = 10;
const RECORDING_BUCKET = 'call-recordings';

// Same normaliser as wk-sms-send — UK national (07…) → +44 so Twilio accepts it.
function normalizeE164(raw: string): string {
  let s = (raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return '+' + s.slice(2);
  if (s.startsWith('0')) return '+44' + s.slice(1);
  return '+' + s;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

// ---- recording_ingest ------------------------------------------------------

async function handleRecordingIngest(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<void> {
  const recordingSid = String(payload.recording_sid ?? '');
  if (!recordingSid) throw new Error('missing recording_sid');

  const { data: rec, error: recErr } = await supabase
    .from('wk_recordings')
    .select('id, call_id, twilio_media_url, storage_path')
    .eq('twilio_sid', recordingSid)
    .maybeSingle();

  if (recErr || !rec) throw new Error(`recording not found: ${recErr?.message ?? recordingSid}`);
  if (rec.storage_path) return;                              // already ingested

  // Twilio media URL is unauthenticated for the .mp3 form; we still authenticate
  // to be safe and follow Twilio's recommendation.
  const mediaUrl = `${rec.twilio_media_url}.mp3`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const resp = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } });
  if (!resp.ok) throw new Error(`twilio media fetch failed: ${resp.status}`);
  const blob = await resp.arrayBuffer();

  const path = `${rec.call_id ?? 'orphan'}/${recordingSid}.mp3`;
  const { error: upErr } = await supabase.storage
    .from(RECORDING_BUCKET)
    .upload(path, blob, { contentType: 'audio/mpeg', upsert: true });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  await supabase
    .from('wk_recordings')
    .update({
      storage_path: path,
      status: 'ready',
      size_bytes: blob.byteLength,
      ingested_at: new Date().toISOString(),
    })
    .eq('id', rec.id);
}

// ---- postcall_ai (stub — full implementation in wk-ai-postcall) ------------

async function handlePostcallAi(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<void> {
  // Placeholder: real implementation calls Whisper + GPT-4o-mini.
  // For Phase 1 step B, we only mark the call as "queued for AI" so the UI
  // can show a "Transcribing…" badge.
  const callSid = String(payload.call_sid ?? '');
  if (!callSid) return;
  await supabase
    .from('wk_calls')
    .update({ ai_status: 'queued' })
    .eq('twilio_call_sid', callSid);
}

// ---- compute_cost (stub — full implementation in wk-spend-record) ----------

async function handleComputeCost(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<void> {
  const callSid = String(payload.call_sid ?? '');
  if (!callSid) return;
  // Placeholder row so the spend banner doesn't show NULL.
  // wk-spend-record will replace this with real numbers once it ships.
  const { data: call } = await supabase
    .from('wk_calls')
    .select('id, agent_id, duration_sec')
    .eq('twilio_call_sid', callSid)
    .maybeSingle();
  if (!call) return;
  const estPence = Math.max(1, Math.round(((call.duration_sec ?? 0) / 60) * 4)); // ~4p/min placeholder
  // total_pence is a generated column — only insert the components.
  await supabase.from('wk_voice_call_costs').upsert({
    call_id: call.id,
    carrier_cost_pence: estPence,
    ai_cost_pence: 0,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'call_id' });
}

// ---- send_sms --------------------------------------------------------------
//
// PR 9 (2026-04-26): the outcome-card pipeline was firing — the
// wk_apply_outcome RPC enqueues a `send_sms` job after each click — but
// this handler was a stub, so the SMS never actually went out. Now it:
//   1. Reads contact (phone, name) and agent (name) for merge fields.
//   2. Substitutes {name} / {agent} in the template body.
//   3. Sends the SMS via Twilio inline and records it in wk_sms_messages
//      (there is no separate sms-send function in this project).
//
// From-number precedence (mirrors wk-sms-send):
//   1. explicit from_e164 in the job payload
//   2. campaign_id → first wk_campaign_numbers row (priority ASC) whose
//      wk_numbers row is channel='sms', sms_enabled and is_active
//   3. workspace default — first sms_enabled wk_numbers row (no is_active
//      filter, exactly like wk-sms-send — the two paths must route alike)
//
// Throws on any error so the job worker retries with backoff (up to 5).

async function handleSendSms(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<void> {
  const contactId = String(payload.contact_id ?? '');
  const agentId = String(payload.agent_id ?? '');
  const rawBody = String(payload.body ?? '');
  if (!contactId) throw new Error('send_sms: missing contact_id');
  if (!rawBody) throw new Error('send_sms: missing body');

  // Nurture auto-cancel: a scheduled follow-up carries the time it was queued.
  // If the lead sent an inbound message since then, they're already engaged —
  // skip the drip so we don't nag someone who replied.
  const skipIfInboundAfter = String(payload.skip_if_inbound_after ?? '').trim();
  if (skipIfInboundAfter) {
    const { data: reply } = await supabase
      .from('wk_sms_messages')
      .select('id')
      .eq('contact_id', contactId)
      .eq('direction', 'inbound')
      .gt('created_at', skipIfInboundAfter)
      .limit(1)
      .maybeSingle();
    if (reply) {
      console.log(`[wk-jobs-worker] send_sms skipped — lead ${contactId} replied since ${skipIfInboundAfter}`);
      return;
    }
  }

  // Resolve contact + agent in parallel.
  const [contactRes, agentRes] = await Promise.all([
    // wk_contacts is the source of truth for the smsv2 / live-call surface.
    supabase
      .from('wk_contacts' as never)
      .select('phone, name')
      .eq('id', contactId)
      .maybeSingle(),
    agentId
      ? supabase
          .from('profiles')
          .select('name')
          .eq('id', agentId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const contactRow = contactRes.data as { phone?: string; name?: string } | null;
  if (!contactRow?.phone) {
    throw new Error(`send_sms: contact ${contactId} has no phone number`);
  }
  // Normalise to E.164 — UK leads are stored in national format (07…) which
  // Twilio rejects with 21211. wk-sms-send does this; queued sends must too
  // (adversarial review 2026-07-25).
  const phone = normalizeE164(contactRow.phone);
  const contactFirstName = (contactRow.name ?? '').trim().split(/\s+/)[0] || '';
  const agentName = (
    (agentRes.data as { name?: string } | null)?.name ?? ''
  ).trim();
  const agentFirstName = agentName.split(/\s+/)[0] || '';

  // Substitute merge fields. Accepts {x} and {{x}} for first_name /
  // agent_first_name (PR 87 unification: if value missing, drop
  // placeholder, never send literal {agent_first_name}). Also accepts
  // legacy {name} / {agent} from seed data.
  const body = rawBody
    .replace(/\{\{?\s*name\s*\}?\}/gi, contactFirstName)
    .replace(/\{\{?\s*first_name\s*\}?\}/gi, contactFirstName)
    .replace(/\{\{?\s*agent\s*\}?\}/gi, agentFirstName)
    .replace(/\{\{?\s*agent_first_name\s*\}?\}/gi, agentFirstName)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  // Resolve sender number. Precedence (mirrors wk-sms-send):
  //   1. explicit from_e164 (caller pinned)
  //   2. campaign_id → first wk_campaign_numbers row whose wk_numbers
  //      row is channel='sms', sms_enabled and is_active (priority ASC)
  //   3. workspace default — first sms_enabled wk_numbers row (no
  //      is_active filter — identical to wk-sms-send's fallback)
  let fromE164 = String(payload.from_e164 ?? '').trim();
  // Security: an explicit from_e164 must be a CRM-owned, SMS-enabled number
  // (mirrors wk-sms-send). Stops a queued job from sending SMS that spoofs a
  // client's receptionist caller-ID. The auto-select paths below are safe by
  // construction (they only pick sms_enabled wk_numbers rows).
  if (fromE164) {
    const { data: ownedNumber } = await supabase
      .from('wk_numbers')
      .select('e164')
      .eq('e164', fromE164)
      .eq('channel', 'sms')
      .eq('sms_enabled', true)
      .maybeSingle();
    if (!ownedNumber) {
      throw new Error(`send_sms: from_e164 ${fromE164} is not a CRM-owned SMS-enabled number`);
    }
  }
  const campaignId = String(payload.campaign_id ?? '');

  if (!fromE164 && campaignId) {
    const { data: pinned } = await supabase
      .from('wk_campaign_numbers' as never)
      .select('priority, number_id, wk_numbers(id, e164, channel, sms_enabled, is_active)')
      .eq('campaign_id', campaignId)
      .order('priority', { ascending: true });
    const pinnedRows = (pinned ?? []) as Array<{
      priority: number;
      number_id: string;
      wk_numbers: { id: string; e164: string; channel: string; sms_enabled: boolean; is_active: boolean } | null;
    }>;
    for (const r of pinnedRows) {
      const n = r.wk_numbers;
      if (n && n.channel === 'sms' && n.sms_enabled && n.is_active) {
        fromE164 = n.e164;
        break;
      }
    }
  }

  if (!fromE164) {
    const { data: defaultNum } = await supabase
      .from('wk_numbers')
      .select('e164')
      .eq('sms_enabled', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    fromE164 = ((defaultNum as { e164?: string } | null)?.e164 as string | undefined) ?? '';
  }
  if (!fromE164) {
    throw new Error('send_sms: no SMS-enabled number configured (wk_numbers)');
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('send_sms: Twilio creds not set on edge function secrets');
  }

  // C2: honour the global kill switch + daily SMS cap before spending. Throwing
  // stops a draining broadcast the moment the switch flips or the cap is hit.
  const { data: gate } = await supabase.rpc('wk_outbound_sms_allowed');
  if (gate && (gate as { allowed?: boolean }).allowed === false) {
    throw new Error(`send_sms: outbound blocked (${(gate as { reason?: string }).reason ?? 'blocked'})`);
  }

  // POST to Twilio Messages.create.
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth64 = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const form = new URLSearchParams({
    To: phone,
    From: fromE164,
    Body: body,
  });
  const twResp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth64}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!twResp.ok) {
    const errText = await twResp.text();
    throw new Error(`send_sms: Twilio ${twResp.status}: ${errText.slice(0, 200)}`);
  }
  const twJson = await twResp.json() as { sid?: string; status?: string };

  // Persist the outbound row (mirrors wk-sms-send). The message has left
  // Twilio at this point, so an insert failure must NOT throw — a retry
  // would double-send. Log and mark the job done instead.
  const broadcastId = String(payload.broadcast_id ?? '').trim() || null;
  const { error: insErr } = await supabase
    .from('wk_sms_messages')
    .insert({
      contact_id: contactId,
      direction: 'outbound',
      channel: 'sms',
      body,
      twilio_sid: twJson.sid ?? null,
      external_id: twJson.sid ?? null,
      from_e164: fromE164,
      to_e164: phone,
      status: twJson.status ?? 'queued',
      created_by: agentId || null,
      broadcast_id: broadcastId,
    } as never);
  if (insErr) {
    console.error('[wk-jobs-worker] send_sms db insert failed (twilio sent though)', insErr);
  }

  // Count this send against its broadcast (if any) for live progress.
  if (broadcastId) {
    await supabase.rpc('wk_broadcast_tally', {
      p_broadcast_id: broadcastId,
      p_sent: 1,
      p_failed: 0,
    });
  }
  if (insErr) return;

  // Bump wk_contacts.last_contact_at so the inbox sorts correctly.
  await supabase
    .from('wk_contacts')
    .update({ last_contact_at: new Date().toISOString() } as never)
    .eq('id', contactId);
}

// ---- ai_reply --------------------------------------------------------------
// The CRM AI warm-up reply is generated in Node (reuses api/lib/llm.ts), so
// this handler just delegates to the app route. The route re-checks all guards
// and drafts/sends. Auth = the service key (both sides hold it).
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.heyelsie.com';

async function handleAiReply(payload: Record<string, unknown>): Promise<void> {
  // Authenticate with CRM_JOBS_KEY — the app route can't compare against this
  // runtime's injected service key (format mismatch with Vercel's env).
  const outboundKey = Deno.env.get('CRM_JOBS_KEY') || SUPABASE_SERVICE_KEY;
  const res = await fetch(`${APP_URL}/api/crm/ai-reply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${outboundKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contact_id: payload.contact_id,
      to_e164: payload.to_e164,
      from_e164: payload.from_e164,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ai_reply: app route ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------

async function processJob(
  supabase: SupabaseClient,
  job: Job
): Promise<void> {
  switch (job.kind) {
    case 'recording_ingest': return handleRecordingIngest(supabase, job.payload);
    case 'postcall_ai':      return handlePostcallAi(supabase, job.payload);
    case 'compute_cost':     return handleComputeCost(supabase, job.payload);
    case 'send_sms':         return handleSendSms(supabase, job.payload);
    case 'ai_reply':         return handleAiReply(job.payload);
    default:
      throw new Error(`unknown job kind: ${job.kind}`);
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // Service-role bearer check. Also accepts CRM_JOBS_KEY — the Vercel cron
  // pump can't know the runtime-injected service key (key-format mismatch:
  // legacy JWT on Vercel vs sb_secret injected here), so both sides share a
  // dedicated key instead.
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const crmJobsKey = Deno.env.get('CRM_JOBS_KEY') ?? '';
  if (token !== SUPABASE_SERVICE_KEY && (!crmJobsKey || token !== crmJobsKey)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Atomic claim of pending jobs using SKIP LOCKED via RPC.
  // (We rely on an RPC `wk_claim_jobs(batch_size int)` defined in the migration.)
  const { data: jobs, error } = await supabase.rpc('wk_claim_jobs', {
    batch_size: BATCH_SIZE,
  });

  if (error) {
    console.error('wk_claim_jobs failed:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const claimed: Job[] = (jobs as Job[]) ?? [];
  const results: Array<{ id: string; ok: boolean; err?: string }> = [];

  for (const job of claimed) {
    try {
      await processJob(supabase, job);
      await supabase
        .from('wk_jobs')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('id', job.id);
      results.push({ id: job.id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const nextAttempts = (job.attempts ?? 0) + 1;
      const dead = nextAttempts >= 5;
      await supabase
        .from('wk_jobs')
        .update({
          status: dead ? 'dead' : 'pending',
          attempts: nextAttempts,
          last_error: msg,
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      // A permanently-failed broadcast send counts against its broadcast so
      // progress reaches 100% (sent + failed = total) instead of stalling.
      if (dead && job.kind === 'send_sms') {
        const bId = String((job.payload as Record<string, unknown>)?.broadcast_id ?? '').trim();
        if (bId) {
          await supabase.rpc('wk_broadcast_tally', { p_broadcast_id: bId, p_sent: 0, p_failed: 1 });
        }
      }
      results.push({ id: job.id, ok: false, err: msg });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
