import { createClient } from '@supabase/supabase-js';
import { notifyBusinessOwner } from '../lib/notify.js';

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
  const text = data.content?.[0]?.text;
  if (!text) return {};
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
}

export const config = { runtime: 'edge' };

const DEAD_CALL_SUMMARY = 'No conversation — caller hung up.';

// A call is "dead" when the caller never actually said anything — the AI
// analysis on those produces junk like "Please provide a valid transcript",
// so we skip it and store a clean fixed summary instead.
function hasCallerSpeech(turns: Array<{ speaker?: string; role?: string; text?: string; content?: string }>): boolean {
  return (turns || []).some(
    (t) => (t.speaker === 'caller' || t.role === 'user') && ((t.text ?? t.content) || '').trim().length > 0,
  );
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

    if (event !== 'call_ended' && event !== 'call_analyzed') {
      return new Response(JSON.stringify({ ok: true, skipped: event }), { status: 200 });
    }

    const agentId = call.agent_id;
    const transcript = call.transcript || '';
    const durationMs = call.duration_ms || 0;
    const fromNumber = call.from_number;
    const collectedVars = call.collected_dynamic_variables || {};

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

    // Create call record
    await supabase.from('calls').insert({
      business_id: businessId,
      conversation_id: conversation?.id || null,
      contact_id: contactId,
      agent_id: elsieAgentId || null,
      retell_call_id: call.call_id,
      direction: call.direction || 'inbound',
      status: 'completed',
      duration_seconds: durationSec,
      transcript: transcriptForUI,
      recording_url: call.recording_url || null,
      ai_summary: isDeadCall ? DEAD_CALL_SUMMARY : (info.summary || null),
      extracted_info: {
        reason: info.reason || null,
        action_required: info.action_required || null,
        collected_variables: collectedVars,
      },
      started_at: call.start_timestamp ? new Date(call.start_timestamp).toISOString() : null,
      ended_at: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : null,
    });

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

    return new Response(JSON.stringify({ ok: true, callId: call.call_id }), { status: 200 });
  } catch (err: any) {
    console.error('[retell-webhook] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
