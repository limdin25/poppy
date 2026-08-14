import { createClient } from '@supabase/supabase-js';
import { notifyBusinessOwner } from '../lib/notify.js';
import { handleBrrrCallEvent, handleBrrrTranscriptUpdate } from '../lib/brrr.js';
import { sendSMS } from '../../src/integrations/twilio/client.js';
import { getSmsFromNumber } from '../lib/channel-lookup.js';
import { firstText } from '../lib/anthropic-content.js';
import { callLLM } from '../lib/llm.js';
import {
  advanceSiteState,
  findSitePageByPhone,
  logSiteEvent,
  siteUrl,
} from '../lib/site-demo.js';
import { SITE_DEMO_SMS } from '../../src/core/site-demo/messages.js';

// Demo receptionist line: text the caller a recap after EVERY call (even hang-ups
// / dead calls), done system-side so it never depends on the agent remembering.
const CALLER_RECAP_BUSINESS_IDS = new Set(['f8b98eb2-192e-4c22-87fd-90c865123fe7']);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_API_KEY = process.env.RETELL_API_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

async function getModelForBusiness(businessId: string): Promise<string> {
  const { data } = await supabase
    .from('businesses')
    .select('ai_model')
    .eq('id', businessId)
    .single();
  if (data?.ai_model) return data.ai_model;
  const { data: setting } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'ai_model')
    .single();
  return setting?.value || 'claude-sonnet-4-6';
}

async function verifySignature(rawBody: string, signatureHeader: string): Promise<boolean> {
  if (!RETELL_API_KEY) return false;

  const match = signatureHeader.match(/v=(\d+),d=(.*)/);
  if (!match) return false;

  const timestamp = match[1];
  const digest = match[2];

  const fiveMinMs = 5 * 60 * 1000;
  if (Date.now() - parseInt(timestamp) > fiveMinMs) return false;

  const message = rawBody + timestamp;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(RETELL_API_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return computed === digest;
}

async function extractCallerInfo(transcript: string, businessName: string, businessId?: string): Promise<{
  caller_name?: string;
  caller_phone?: string;
  caller_email?: string;
  reason?: string;
  summary?: string;
  action_required?: string;
}> {
  const model = businessId ? await getModelForBusiness(businessId) : 'claude-sonnet-4-6';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Extract caller information from this phone call transcript for ${businessName}. Return JSON only with these fields: caller_name (string or null), caller_phone (string or null), caller_email (string or null), reason (brief reason for call), summary (2-3 sentence summary), action_required (what the business needs to do next, or null).\n\nTranscript:\n${transcript}`,
        },
      ],
    }),
  });

  const data = await res.json() as { content?: Array<{ text?: string }> };
  const text = firstText(data.content);
  if (!text) return {};
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
}

// Demo after-call step: in ONE AI call, write the "lead card" recap SMS AND
// detect whether the owner agreed an onboarding time for themselves (so we can
// book it as a real appointment). Returns the SMS text + booking details.
interface DemoRecap { sms: string; booked: boolean; iso?: string; label?: string }
async function buildDemoRecap(transcript: string, phone: string, businessId: string): Promise<DemoRecap> {
  const model = await getModelForBusiness(businessId);
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }).format(new Date());
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Today is ${today} (Europe/London). This was a DEMO call: a business owner tried our AI phone receptionist by role-playing one of their own customers booking an appointment, and MAY have agreed to a 15-minute ONBOARDING for themselves at the end. Do TWO things and return JSON ONLY:\n1. "sms": the follow-up SMS to the business owner, plain text, in EXACTLY this shape (keep blank lines + every label):\nThanks for calling, <owner's first name>!\n\nQuick recap, this is how I'll send you every lead:\n\nName: <the mock customer's name>\nPhone: ${phone}\nDate: <booking date, or "to confirm">\nTime: <booking time, or "to confirm">\n\nSummary: <1-2 short sentences on the job>\n\nGood luck with the job!\n2. Detect if the OWNER (not the mock customer) agreed a specific ONBOARDING day/time for themselves. "booked": true/false; "iso": full ISO-8601 with the correct +01:00 BST offset for that onboarding (empty if none); "label": short e.g. "Tuesday morning".\nReturn: {"sms":"...","booked":false,"iso":"","label":""}\nRules: use the phone exactly as ${phone}; if owner's first name unclear write just "Thanks for calling!"; keep the Name/Phone/Date/Time/Summary labels; no markdown.\n\nTranscript:\n${transcript}`,
      }],
    }),
  });
  const data = await res.json() as { content?: Array<{ text?: string }> };
  const m = firstText(data.content).match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m![0]);
    return { sms: (j.sms || '').trim(), booked: !!j.booked, iso: j.iso || undefined, label: j.label || undefined };
  } catch { return { sms: '', booked: false }; }
}

/**
 * A site-demo call WE placed, from the escalation ladder.
 *
 * Kept separate from the inbound flow because there is no business mapping and
 * no customer conversation to create: this is us ringing a lead about the
 * website we built them.
 *
 * The close is sent whatever was said, exactly as on the inbound side. Voice
 * consent is unreliable to parse, so the text does the closing rather than an
 * extraction guessing whether "yeah go on then" meant yes.
 */
async function handleSiteDemoOutboundCall(
  call: any,
  meta: Record<string, any>,
): Promise<{ ok: boolean; site_demo: boolean; skipped?: string }> {
  if (call.event && call.event !== 'call_ended') return { ok: true, site_demo: true, skipped: 'not_ended' };
  const pageId = String(meta.page_id || '');
  if (!pageId) return { ok: true, site_demo: true, skipped: 'no_page_id' };

  const durationSec = Math.round((call.duration_ms || 0) / 1000);
  const answered = durationSec > 5;

  await logSiteEvent(pageId, 'call_ended', {
    direction: 'outbound',
    duration_sec: durationSec,
    attempt: meta.attempt,
    answered,
  });

  // An unanswered dial is not engagement. Advancing on it would stand the
  // ladder down and silently end the funnel for a lead who never picked up.
  if (!answered) return { ok: true, site_demo: true, skipped: 'no_answer' };

  const { data: page } = await supabase
    .from('wk_site_pages')
    .select('id, slug, business_name, owner_first, contact_id, state')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) return { ok: true, site_demo: true, skipped: 'page_gone' };

  await advanceSiteState(page, 'engaged', { call: true });

  try {
    const smsFrom = await getSmsFromNumber('f8b98eb2-192e-4c22-87fd-90c865123fe7');
    const toNumber = call.to_number;
    if (smsFrom && toNumber) {
      const close = SITE_DEMO_SMS.afterCall({
        ownerFirst: page.owner_first,
        businessName: page.business_name,
        url: siteUrl(page.slug),
        demoNumber: '',
        checkoutUrl: siteUrl(page.slug),
      });
      await sendSMS(smsFrom, toNumber, close);
      await logSiteEvent(pageId, 'followup_sent', { stage: 'after_call_close' });
      await advanceSiteState(page, 'checkout_sent');
    }
  } catch (e) {
    console.error('[retell-webhook] site demo close SMS failed:', e);
  }

  return { ok: true, site_demo: true };
}

export const config = { runtime: 'edge' };

const DEAD_CALL_SUMMARY = 'No conversation, caller hung up.';

// A call is "dead" when the caller never actually said anything — the AI
// analysis on those produces junk like "Please provide a valid transcript",
// so we skip it and store a clean fixed summary instead.
function hasCallerSpeech(turns: Array<{ speaker?: string; role?: string; text?: string; content?: string }>): boolean {
  return (turns || []).some(
    (t) => (t.speaker === 'caller' || t.role === 'user') && ((t.text ?? t.content) || '').trim().length > 0,
  );
}

// CRM warm-up voice agent (inbound to 833) — capture the call into wk_* tables:
// upsert the contact, log a wk_calls row, and store a short AI summary as an
// activity. No heyelsie business/contacts/conversations rows. Idempotent on the
// Retell call id; the full capture runs on call_ended (transcript present).
async function handleCrmWarmupCall(
  call: any,
  transcript: string,
  event: string,
): Promise<{ ok: boolean; crm_warmup: boolean; skipped?: string }> {
  if (event !== 'call_ended') return { ok: true, crm_warmup: true, skipped: event };
  const callSid = call.call_id || call.telephony_identifier?.twilio_call_sid || '';
  const fromNumber = (call.from_number || '').trim();
  const toNumber = (call.to_number || '').trim();
  if (!callSid || !fromNumber) return { ok: true, crm_warmup: true, skipped: 'missing_ids' };

  try {
    // Idempotency — skip if we already logged this call.
    const { data: existingCall } = await supabase
      .from('wk_calls').select('id').eq('twilio_call_sid', callSid).maybeSingle();
    if (existingCall) return { ok: true, crm_warmup: true, skipped: 'duplicate' };

    // Upsert contact by phone.
    const { data: existing } = await supabase.from('wk_contacts').select('id, name').eq('phone', fromNumber).maybeSingle();
    let contactId: string;
    if (existing) {
      contactId = existing.id;
    } else {
      const { data: created } = await supabase.from('wk_contacts').insert({
        name: 'New lead', phone: fromNumber, custom_fields: { source: 'ai_voice_inbound' },
      }).select('id').single();
      contactId = created?.id;
      if (!contactId) return { ok: false, crm_warmup: true, skipped: 'contact_failed' };
    }

    // Short AI summary of the call (best-effort).
    let summary = 'Inbound AI call.';
    if (transcript && transcript.trim().length > 20) {
      try {
        const out = await callLLM('claude-sonnet-4-6',
          'Summarise this inbound sales call in 1–2 short sentences: what the caller wants and any next step. Plain text, no markdown.',
          [{ role: 'user', content: transcript.slice(0, 6000) }], 200);
        if (out.trim()) summary = out.trim();
      } catch { /* keep default */ }
    }

    const durationSec = Math.round((call.duration_ms || 0) / 1000);
    const startMs = call.start_timestamp || Date.now();
    const { data: insertedCall } = await supabase.from('wk_calls').insert({
      twilio_call_sid: callSid,
      contact_id: contactId,
      direction: 'inbound',
      status: 'completed',
      duration_sec: durationSec,
      from_e164: fromNumber,
      to_e164: toNumber || null,
      started_at: new Date(startMs).toISOString(),
      ended_at: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : new Date().toISOString(),
      agent_note: summary,
      ai_status: 'done',
    }).select('id').single();
    const callId: string | undefined = insertedCall?.id;

    // Retell keeps the recording + transcript + its own summary on the webhook
    // payload — mirror them into the CRM tables the inbox/past-call UI reads,
    // otherwise the Play button, Transcript modal, and AI summary stay empty.
    if (callId) {
      // Recording: Retell serves a public, permanent CloudFront URL. The UI's
      // player uses http(s) URLs directly (no signing), so store it as-is.
      const recordingUrl = (call.recording_url || '').trim();
      if (recordingUrl) {
        await supabase.from('wk_recordings').insert({
          call_id: callId, storage_path: recordingUrl, status: 'ready', duration_sec: durationSec,
        });
      }

      // Transcript: speaker-labelled turns power the Transcript modal / pane.
      const turns = Array.isArray(call.transcript_object) ? call.transcript_object : [];
      const transcriptRows = turns
        .filter((t: any) => t && typeof t.content === 'string' && t.content.trim())
        .map((t: any, i: number) => ({
          call_id: callId,
          speaker: t.role === 'user' ? 'caller' : t.role === 'agent' ? 'agent' : 'unknown',
          body: (t.content as string).trim(),
          ts: new Date(startMs + i * 1000).toISOString(),
        }));
      if (transcriptRows.length > 0) {
        await supabase.from('wk_live_transcripts').insert(transcriptRows);
      }
      // Full-text archival copy too (separate table).
      if (transcript && transcript.trim()) {
        await supabase.from('wk_transcripts').insert({
          call_id: callId, source: 'manual', body: transcript.trim(),
        });
      }

      // AI summary → wk_call_intelligence (the field the UI's summary reads).
      const sentimentRaw = String(call.call_analysis?.user_sentiment || '').toLowerCase();
      const sentiment = ['positive', 'neutral', 'negative', 'mixed'].includes(sentimentRaw) ? sentimentRaw : null;
      await supabase.from('wk_call_intelligence').upsert({
        call_id: callId, summary, sentiment, llm_model: 'claude-sonnet-4-6',
      }, { onConflict: 'call_id' });
    }

    await supabase.from('wk_activities').insert({
      contact_id: contactId, kind: 'call_inbound', title: 'AI answered a call', body: summary,
    });
    await supabase.from('wk_contacts').update({ last_contact_at: new Date().toISOString() }).eq('id', contactId);

    return { ok: true, crm_warmup: true };
  } catch (e) {
    // Never 500 the webhook — a rejected Supabase promise (network/DNS/timeout)
    // would propagate to the outer catch and trigger Retell retries.
    console.error('[crm-warmup]', e);
    return { ok: false, crm_warmup: true, skipped: 'error' };
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const rawBody = await req.text();

    const signature = req.headers.get('x-retell-signature') || '';
    if (!signature) {
      return new Response(JSON.stringify({ error: 'Missing signature' }), { status: 401 });
    }
    const valid = await verifySignature(rawBody, signature).catch(() => false);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const { event, call } = payload;

    // Live transcript turns for BRRR property calls only (the property agent
    // opts into transcript_updated; receptionist agents don't send it).
    if (event === 'transcript_updated') {
      const liveMeta = (call?.metadata || {}) as Record<string, any>;
      if (liveMeta.type === 'brrr_property') {
        const result = await handleBrrrTranscriptUpdate(call);
        return new Response(JSON.stringify(result), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, skipped: event }), { status: 200 });
    }

    if (event !== 'call_ended' && event !== 'call_analyzed') {
      return new Response(JSON.stringify({ ok: true, skipped: event }), { status: 200 });
    }

    // BRRR property-qualifier calls (outbound, admin-only) — branch out before
    // the inbound flow: they have no business mapping and must not create
    // contacts/conversations like a normal customer call.
    const callMeta = (call.metadata || {}) as Record<string, any>;

    // Site demo calls WE placed. Branched out before the BRRR check below,
    // which claims every outbound call and would otherwise try to process ours
    // as a property qualification.
    if (callMeta.type === 'site_demo') {
      const result = await handleSiteDemoOutboundCall(call, callMeta);
      return new Response(JSON.stringify(result), { status: 200 });
    }

    if (callMeta.type === 'brrr_property' || call.direction === 'outbound') {
      const result = await handleBrrrCallEvent(event, call);
      if (result.ok || callMeta.type === 'brrr_property') {
        return new Response(JSON.stringify(result), { status: 200 });
      }
      // outbound call that isn't a property call — fall through to normal flow
    }

    const agentId = call.agent_id;
    const transcript = call.transcript || '';
    const durationMs = call.duration_ms || 0;
    const fromNumber = call.from_number;
    const collectedVars = call.collected_dynamic_variables || {};

    // CRM warm-up voice agent (inbound to 833) — a self-contained lead-capture
    // flow on the wk_* tables. Branch out before the heyelsie business mapping
    // (this agent has no agents/channels row on purpose, so it would 404).
    if (agentId && agentId === process.env.CRM_WARMUP_AGENT_ID) {
      const result = await handleCrmWarmupCall(call, transcript, event);
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // Find business by retell_agent_id — check agents table first, then channels.config fallback
    let businessId: string | undefined;
    let elsieAgentId: string | undefined;

    const { data: agentRow } = await supabase
      .from('agents')
      .select('id, business_id')
      .eq('retell_agent_id', agentId)
      .single();

    if (agentRow) {
      businessId = agentRow.business_id;
      elsieAgentId = agentRow.id;
    } else {
      const { data: channels } = await supabase
        .from('channels')
        .select('business_id, id, config')
        .eq('type', 'voice');

      const channel = channels?.find(
        (ch: any) => ch.config?.retell_agent_id === agentId
      );
      if (channel) businessId = channel.business_id;
    }

    if (!businessId) {
      console.error('[retell-webhook] No agent/channel found for agent_id:', agentId);
      return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404 });
    }

    // For call_analyzed, update the existing call with analysis data
    if (event === 'call_analyzed') {
      const analysis = call.call_analysis || {};

      const { data: callRow } = await supabase
        .from('calls')
        .select('conversation_id, transcript')
        .eq('retell_call_id', call.call_id)
        .single();

      const isDead = !hasCallerSpeech(
        (callRow?.transcript as Array<{ speaker?: string; text?: string }>) || call.transcript_object || [],
      );
      const summary = isDead ? DEAD_CALL_SUMMARY : (analysis.call_summary || null);

      await supabase
        .from('calls')
        .update({
          ai_summary: summary,
          extracted_info: {
            sentiment: analysis.user_sentiment || null,
            successful: analysis.call_successful ?? null,
            ...analysis.custom_analysis_data,
          },
        })
        .eq('retell_call_id', call.call_id);

      // Update conversation preview with the summary
      if (summary) {
        if (callRow?.conversation_id) {
          await supabase
            .from('conversations')
            .update({ last_message_preview: summary })
            .eq('id', callRow.conversation_id);

          await supabase
            .from('messages')
            .update({ body: summary })
            .eq('content_type', 'call_summary')
            .match({ conversation_id: callRow.conversation_id });
        }
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // A/B voice rotation — flip the inbound agent on the line so each voice gets
    // exactly one call at a time (Emma → English → Emma → English…). The line is
    // found by the DIALLED number (call.to_number), NOT by which voice answered:
    // matching on the answering agent only ever matches one fixed voice, so the
    // rotation could flip away from it but never flip back, getting stuck.
    // Only runs when the channel has an ab_next_agent_id configured.
    const toNumber: string | undefined = call.to_number;
    if (toNumber) {
      const { data: abChannels } = await supabase
        .from('channels')
        .select('id, config, ab_next_agent_id, agent:ab_next_agent_id(retell_agent_id)')
        .eq('type', 'voice')
        .eq('config->>phone', toNumber);

      const abChannel = (abChannels || []).find(
        (c: any) => c.ab_next_agent_id && c.agent?.retell_agent_id,
      );

      if (abChannel) {
        const nextRetellId = (abChannel.agent as any).retell_agent_id as string;
        // Switch Retell to use the next A/B agent for the next inbound call.
        await fetch(`https://api.retellai.com/update-phone-number/${encodeURIComponent(toNumber)}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ inbound_agent_id: nextRetellId }),
        }).catch(() => {});
        // Now rotate: set ab_next_agent_id to the agent that JUST answered (so next call uses the other).
        const { data: justAnswered } = await supabase
          .from('agents')
          .select('id')
          .eq('retell_agent_id', agentId)
          .maybeSingle();
        if (justAnswered) {
          await supabase.from('channels')
            .update({ ab_next_agent_id: justAnswered.id })
            .eq('id', abChannel.id);
        }
      }
    }

    // Idempotency guard — Retell retries call_ended if we respond slowly (AI
    // extraction + outbound texts can exceed the webhook timeout). Claim the call
    // up-front so a retry can't reprocess it and re-text the caller.
    const { data: existingCall } = await supabase
      .from('calls').select('id').eq('retell_call_id', call.call_id).maybeSingle();
    if (existingCall) return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 });

    const { data: claimedCall } = await supabase.from('calls').insert({
      business_id: businessId,
      retell_call_id: call.call_id,
      agent_id: elsieAgentId || null,
      direction: call.direction || 'inbound',
      status: 'completed',
      duration_seconds: Math.round((call.duration_ms || 0) / 1000),
      recording_url: call.recording_url || null,
      started_at: call.start_timestamp ? new Date(call.start_timestamp).toISOString() : null,
      ended_at: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : null,
    }).select('id').single();
    const claimedCallId = claimedCall?.id || null;

    // call_ended: process the call
    const { data: business } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single();

    // Extract caller info via Claude — but not for dead calls (caller never
    // spoke): the extraction only returns "please provide a transcript" junk.
    const isDeadCall =
      !hasCallerSpeech(call.transcript_object || []) && !/(^|\n)\s*User:/i.test(transcript);
    const info = isDeadCall
      ? {}
      : await extractCallerInfo(transcript, business?.name || 'the business', businessId);

    // Use collected variables from Retell as fallback
    const callerName = info.caller_name || collectedVars.name || collectedVars.customer_name || null;
    const callerPhone = info.caller_phone || fromNumber || null;
    const callerEmail = info.caller_email || collectedVars.email || null;

    // Create or find contact
    let contactId: string | null = null;
    if (callerPhone) {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone', callerPhone)
        .single();

      if (existing) {
        contactId = existing.id;
        if (callerName) {
          await supabase.from('contacts').update({
            name: callerName,
            ...(callerEmail ? { email: callerEmail } : {}),
          }).eq('id', contactId);
        }
      } else {
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            business_id: businessId,
            phone: callerPhone,
            name: callerName,
            email: callerEmail,
          })
          .select('id')
          .single();
        contactId = newContact?.id || null;
      }
    }

    // Check if a booking was made during this call (booking tool runs mid-call)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentBooking } = await supabase
      .from('appointments')
      .select('id')
      .eq('business_id', businessId)
      .gte('created_at', fiveMinAgo)
      .eq('booked_via', 'voice')
      .ilike('title', `%${callerName || '___NOMATCH___'}%`)
      .limit(1)
      .maybeSingle();

    const hasBooking = !!recentBooking;

    // Thread calls from the same caller: reuse their existing voice conversation
    // instead of spawning a new chat for every call. Only create one when the
    // caller has no contact yet, or has no prior voice thread.
    const durationSec = Math.round(durationMs / 1000);
    const nowIso = new Date().toISOString();
    const summaryText = isDeadCall
      ? DEAD_CALL_SUMMARY
      : (info.summary || `Call lasted ${durationSec}s`);
    const preview = summaryText;
    const nextStatus = hasBooking ? 'closed' : 'open';

    let conversation: { id: string } | null = null;
    if (contactId) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id, unread_count')
        .eq('business_id', businessId)
        .eq('contact_id', contactId)
        .eq('channel', 'voice')
        .neq('status', 'archived')
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        const { data: updated } = await supabase
          .from('conversations')
          .update({
            last_message_at: nowIso,
            last_message_preview: preview,
            unread_count: (existing.unread_count || 0) + 1,
            status: nextStatus,
          })
          .eq('id', existing.id)
          .select('id')
          .single();
        conversation = updated ?? { id: existing.id };
      }
    }
    if (!conversation) {
      const { data: created } = await supabase
        .from('conversations')
        .insert({
          business_id: businessId,
          contact_id: contactId,
          agent_id: elsieAgentId || null,
          channel: 'voice',
          status: nextStatus,
          last_message_at: nowIso,
          last_message_preview: preview,
          unread_count: 1,
          ai_handling: false,
        })
        .select('id')
        .single();
      conversation = created ?? null;
    }

    // Transform transcript from Retell format {role,content} to UI format {speaker,text}
    const transcriptForUI = (call.transcript_object || []).map((t: any) => ({
      speaker: t.role === 'user' ? 'caller' : 'agent',
      text: t.content,
    }));

    // Fill the AI-derived fields onto the call row we claimed up-front.
    await supabase.from('calls').update({
      conversation_id: conversation?.id || null,
      contact_id: contactId,
      transcript: transcriptForUI,
      ai_summary: isDeadCall ? DEAD_CALL_SUMMARY : (info.summary || null),
      extracted_info: {
        reason: info.reason || null,
        action_required: info.action_required || null,
        collected_variables: collectedVars,
      },
    }).eq('id', claimedCallId);

    // Link appointment to conversation if booking happened
    if (hasBooking && recentBooking && conversation) {
      await supabase
        .from('appointments')
        .update({ conversation_id: conversation.id, contact_id: contactId })
        .eq('id', recentBooking.id);
    }

    // Create a call_summary message
    await supabase.from('messages').insert({
      conversation_id: conversation?.id || null,
      direction: 'inbound',
      sender: 'ai',
      content_type: 'call_summary',
      body: isDeadCall
        ? DEAD_CALL_SUMMARY
        : (info.summary || `Call with ${callerName || callerPhone || 'unknown caller'} lasted ${durationSec}s`),
      metadata: {
        retell_call_id: call.call_id,
        duration_seconds: durationSec,
        disconnection_reason: call.disconnection_reason,
      },
    });

    notifyBusinessOwner(businessId, 'call', {
      title: `Missed Call: ${callerName || callerPhone || 'Unknown'}`,
      body: [
        summaryText,
        callerPhone ? `Phone: ${callerPhone}` : null,
        info.action_required ? `Action: ${info.action_required}` : null,
      ].filter(Boolean).join('\n'),
    }).catch(() => {});

    // Auto after-call recap text to the caller — always fires (incl. dead/hang-up
    // calls). System-side so it doesn't depend on the agent sending it in-call.
    if (CALLER_RECAP_BUSINESS_IDS.has(businessId) && callerPhone) {
      try {
        const smsFrom = await getSmsFromNumber(businessId);
        if (smsFrom) {
          const bizName = business?.name || 'us';
          let recap: string;
          let booking: DemoRecap | null = null;
          if (isDeadCall) {
            recap = `Thanks for calling ${bizName}! Looks like we got cut off, call back any time and Elsie will pick straight up.`;
          } else {
            booking = await buildDemoRecap(transcript, callerPhone, businessId).catch(() => null);
            recap = (booking?.sms) || `Thanks for calling${callerName ? ', ' + callerName : ''}! Quick recap from Elsie: ${info.summary || summaryText}.`;
          }
          await sendSMS(smsFrom, callerPhone, recap);

          // Site demo: did the owner of a site we built just ring the number on
          // it? Then the close is the site's checkout, not the generic
          // onboarding pitch. It REPLACES that pitch rather than adding to it:
          // three texts after one call reads as spam.
          //
          // Sent whatever was said on the call. Voice consent is unreliable to
          // parse, so the text does the closing rather than an extraction
          // guessing whether "yeah go on then" was a yes.
          const sitePage = await findSitePageByPhone(callerPhone).catch(() => null);

          if (sitePage) {
            await logSiteEvent(sitePage.id, 'call_ended', {
              direction: 'inbound',
              dead: isDeadCall || undefined,
            });
            await advanceSiteState(sitePage, 'engaged', { call: true });
            if (!isDeadCall) {
              const close = SITE_DEMO_SMS.afterCall({
                ownerFirst: sitePage.owner_first,
                businessName: sitePage.business_name,
                url: siteUrl(sitePage.slug),
                demoNumber: '',
                checkoutUrl: siteUrl(sitePage.slug),
              });
              await sendSMS(smsFrom, callerPhone, close).catch(() => {});
              await logSiteEvent(sitePage.id, 'followup_sent', { stage: 'after_call_close' });
              await advanceSiteState(sitePage, 'checkout_sent');
            }
          }

          // Follow-up pitch — arrives right after the recap (only when they engaged).
          if (!isDeadCall && !sitePage) {
            const pitch = `P.S. If you liked how that felt, I can set Elsie up to answer YOUR calls too. Are you free tomorrow for a quick 15-min onboarding? Just reply with a time that suits and I'll sort it. Elsie`;
            await sendSMS(smsFrom, callerPhone, pitch).catch(() => {});
            // Capture an on-call onboarding agreement as a real appointment.
            if (booking?.booked && booking.iso && contactId) {
              try {
                const start = new Date(booking.iso);
                if (!isNaN(start.getTime())) {
                  const appt = {
                    business_id: businessId, contact_id: contactId, conversation_id: conversation?.id || null,
                    title: `Onboarding call — ${callerName || callerPhone}`,
                    description: `Onboarding agreed on the demo call. ${booking.label || ''}`.trim(),
                    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 30 * 60000).toISOString(),
                    status: 'confirmed', booked_via: 'voice',
                  };
                  const { data: ex } = await supabase.from('appointments').select('id').eq('business_id', businessId).eq('contact_id', contactId).limit(1).maybeSingle();
                  if (ex) await supabase.from('appointments').update(appt).eq('id', ex.id);
                  else await supabase.from('appointments').insert(appt);
                }
              } catch (e) { console.error('[retell-webhook] on-call booking failed:', e); }
            }
          }
        }
      } catch (e) {
        console.error('[retell-webhook] caller recap SMS failed:', e);
      }
    }

    return new Response(JSON.stringify({ ok: true, callId: call.call_id }), { status: 200 });
  } catch (err: any) {
    console.error('[retell-webhook] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
