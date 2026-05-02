import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_WEBHOOK_SECRET = process.env.RETELL_WEBHOOK_SECRET!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

function verifyRetellSignature(body: string, signature: string): boolean {
  const hash = crypto
    .createHmac('sha256', RETELL_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

async function extractCallerInfo(transcript: string, businessName: string): Promise<{
  caller_name?: string;
  caller_phone?: string;
  caller_email?: string;
  reason?: string;
  summary?: string;
  action_required?: string;
}> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Extract caller information from this phone call transcript for ${businessName}. Return JSON with: caller_name (string or null), caller_phone (string or null), caller_email (string or null), reason (brief reason for call), summary (2-3 sentence summary), action_required (what the business needs to do next, or null).`,
        },
        { role: 'user', content: transcript },
      ],
    }),
  });

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return content ? JSON.parse(content) : {};
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const rawBody = await req.text();

    // Verify signature
    const signature = new URL(req.url).searchParams.get('signature') ||
      (req.headers as any).get?.('x-retell-signature') || '';

    if (RETELL_WEBHOOK_SECRET && !verifyRetellSignature(rawBody, signature)) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const { event, call } = payload;

    if (event !== 'call_ended' && event !== 'call_analyzed') {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
    }

    const agentId = call.agent_id;
    const transcript = call.transcript || '';
    const callDuration = call.call_duration_ms;
    const fromNumber = call.from_number;

    // Find business by agent_id
    const { data: channel } = await supabase
      .from('channels')
      .select('business_id, config')
      .eq('provider_id', agentId)
      .single();

    if (!channel) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404 });
    }

    const businessId = channel.business_id;

    // Get business name for context
    const { data: business } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', businessId)
      .single();

    // Extract caller info via OpenAI
    const info = await extractCallerInfo(transcript, business?.name || 'the business');

    // Create or find contact
    let contactId: string | null = null;
    if (info.caller_phone || fromNumber) {
      const phone = info.caller_phone || fromNumber;
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone', phone)
        .single();

      if (existing) {
        contactId = existing.id;
        // Update name if we now have it
        if (info.caller_name) {
          await supabase.from('contacts').update({ name: info.caller_name }).eq('id', contactId);
        }
      } else {
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            business_id: businessId,
            phone,
            name: info.caller_name || null,
            email: info.caller_email || null,
          })
          .select('id')
          .single();
        contactId = newContact?.id || null;
      }
    }

    // Create conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .insert({
        business_id: businessId,
        contact_id: contactId,
        channel: 'voice',
        status: 'closed',
        summary: info.summary || null,
        action_required: info.action_required || null,
      })
      .select('id')
      .single();

    // Create call record
    await supabase.from('calls').insert({
      business_id: businessId,
      conversation_id: conversation?.id,
      contact_id: contactId,
      direction: 'inbound',
      from_number: fromNumber,
      duration_ms: callDuration,
      transcript,
      reason: info.reason || null,
      retell_call_id: call.call_id,
    });

    // Create message record
    await supabase.from('messages').insert({
      conversation_id: conversation?.id,
      role: 'system',
      content: info.summary || `Call lasted ${Math.round((callDuration || 0) / 1000)}s`,
      channel: 'voice',
      metadata: { retell_call_id: call.call_id, duration_ms: callDuration },
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
