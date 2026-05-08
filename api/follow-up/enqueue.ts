import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

export const config = { runtime: 'edge' };

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

interface ConversationForFollowUp {
  id: string
  business_id: string
  contact_id: string
  channel: string
  last_message_at: string
  agent_id: string | null
}

async function classifyAndGenerateFollowUp(
  conversationId: string,
  businessId: string,
  businessName: string,
  contactName: string,
  channel: string,
  tone: string,
  attemptNumber: number,
): Promise<{ reason: string; message: string }> {
  const { data: messages } = await supabase
    .from('messages')
    .select('direction, body, sender')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(10);

  const history = (messages || []).reverse().map(m =>
    `${m.direction === 'inbound' ? 'Customer' : (m.sender === 'ai' ? 'AI' : 'Staff')}: ${m.body || '(no text)'}`
  ).join('\n');

  const model = await getModelForBusiness(businessId);

  const toneGuide = tone === 'professional'
    ? 'Keep it polite and businesslike. No emojis.'
    : tone === 'casual'
      ? 'Be very informal and chatty. Use emojis sparingly.'
      : 'Be warm and friendly. One emoji is fine.';

  const attemptGuide = attemptNumber === 1
    ? 'This is the first follow-up. Be gentle — a light nudge.'
    : attemptNumber === 2
      ? 'This is a second follow-up. Be helpful but not pushy.'
      : 'This is a final follow-up. Let them know you are here if they need you, no pressure.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: `You are a follow-up message generator for ${businessName}. Classify why this conversation didn't result in a booking and write a follow-up message.

${toneGuide}
${attemptGuide}

Respond with EXACTLY this JSON format:
{"reason":"one_of: unanswered_question, interested_no_booking, outside_area, outside_hours, price_inquiry, general","message":"the follow-up message text"}

Rules:
- Use the customer's first name (${contactName}) naturally
- Keep it under 160 characters for SMS, under 300 for WhatsApp/email
- Channel is ${channel}
- Never mention you are an AI
- Reference specifics from the conversation when possible`,
      messages: [{ role: 'user', content: `Conversation history:\n${history}\n\nGenerate the follow-up.` }],
    }),
  });

  const data = await res.json() as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text || '';

  try {
    const parsed = JSON.parse(text);
    return {
      reason: parsed.reason || 'general',
      message: parsed.message || `Hi ${contactName}! Just following up from ${businessName}. Would you still like to book? We're here to help.`,
    };
  } catch {
    return {
      reason: 'general',
      message: `Hi ${contactName}! Just following up from ${businessName}. Would you still like to book? We're here to help.`,
    };
  }
}

function resolveChannel(
  conversationChannel: string,
  preferredChannel: string,
  hasWhatsApp: boolean,
  hasPhone: boolean,
  hasEmail: boolean,
): string {
  if (preferredChannel !== 'same_channel') {
    if (preferredChannel === 'whatsapp' && hasWhatsApp) return 'whatsapp';
    if (preferredChannel === 'sms' && hasPhone) return 'sms';
    if (preferredChannel === 'email' && hasEmail) return 'email';
  }

  if (conversationChannel === 'whatsapp' && hasWhatsApp) return 'whatsapp';
  if (conversationChannel === 'email' && hasEmail) return 'email';
  if (conversationChannel === 'sms' && hasPhone) return 'sms';
  if (conversationChannel === 'voice' && hasPhone) return 'sms';

  if (hasWhatsApp) return 'whatsapp';
  if (hasPhone) return 'sms';
  if (hasEmail) return 'email';

  return 'sms';
}

export default async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: staleConversations } = await supabase
    .from('conversations')
    .select('id, business_id, contact_id, channel, last_message_at, agent_id')
    .lte('last_message_at', oneHourAgo)
    .gte('last_message_at', fortyEightHoursAgo)
    .eq('status', 'open');

  if (!staleConversations?.length) {
    return new Response(JSON.stringify({ enqueued: 0 }), { status: 200 });
  }

  const businessIds = [...new Set(staleConversations.map(c => c.business_id))];

  const { data: allSettings } = await supabase
    .from('follow_up_settings')
    .select('*')
    .in('business_id', businessIds)
    .eq('enabled', true);

  const settingsMap = new Map((allSettings || []).map(s => [s.business_id, s]));

  const conversationIds = staleConversations.map(c => c.id);
  const { data: existingQueue } = await supabase
    .from('follow_up_queue')
    .select('conversation_id, attempt_number')
    .in('conversation_id', conversationIds)
    .neq('status', 'cancelled');

  const existingAttempts = new Map<string, Set<number>>();
  for (const q of existingQueue || []) {
    if (!existingAttempts.has(q.conversation_id)) {
      existingAttempts.set(q.conversation_id, new Set());
    }
    existingAttempts.get(q.conversation_id)!.add(q.attempt_number);
  }

  const { data: appointments } = await supabase
    .from('appointments')
    .select('conversation_id')
    .in('conversation_id', conversationIds)
    .neq('status', 'cancelled');

  const bookedIds = new Set((appointments || []).map(a => a.conversation_id));

  const { data: lastMessages } = await supabase
    .from('messages')
    .select('conversation_id, direction')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false });

  const lastMsgDirection = new Map<string, string>();
  for (const m of lastMessages || []) {
    if (!lastMsgDirection.has(m.conversation_id)) {
      lastMsgDirection.set(m.conversation_id, m.direction);
    }
  }

  let enqueued = 0;

  for (const conv of staleConversations as ConversationForFollowUp[]) {
    if (bookedIds.has(conv.id)) continue;

    const settings = settingsMap.get(conv.business_id);
    if (!settings) continue;

    if (lastMsgDirection.get(conv.id) === 'inbound') continue;

    const attempts = existingAttempts.get(conv.id) || new Set<number>();
    const nextAttempt = attempts.size + 1;
    if (nextAttempt > (settings.max_attempts as number)) continue;

    const rawDelays = (settings.delay_hours as number[]) || [7200, 86400];
    const isLegacyHours = rawDelays.length > 0 && rawDelays.every(d => d <= 100);
    const delaySeconds = isLegacyHours ? rawDelays.map(h => h * 3600) : rawDelays;
    const delayForAttempt = delaySeconds[nextAttempt - 1] || delaySeconds[delaySeconds.length - 1] || 86400;

    const lastMessageTime = new Date(conv.last_message_at).getTime();
    const scheduledAt = new Date(lastMessageTime + delayForAttempt * 1000);

    if (scheduledAt.getTime() > Date.now()) continue;

    const { data: contact } = await supabase
      .from('contacts')
      .select('name, phone, email, whatsapp')
      .eq('id', conv.contact_id)
      .single();

    if (!contact) continue;

    const { data: biz } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', conv.business_id)
      .single();

    // Check if the conversation's agent has a custom follow-up prompt
    let agentFollowUpPrompt: string | null = null;
    if ((conv as any).agent_id) {
      const { data: agentRow } = await supabase
        .from('agents')
        .select('follow_up_prompt')
        .eq('id', (conv as any).agent_id)
        .single();
      agentFollowUpPrompt = agentRow?.follow_up_prompt || null;
    }

    const channel = resolveChannel(
      conv.channel,
      settings.preferred_channel as string,
      !!contact.whatsapp,
      !!contact.phone,
      !!contact.email,
    );

    const contactName = contact.name?.split(' ')[0] || 'there';

    let reason: string;
    let message: string;

    if (agentFollowUpPrompt) {
      reason = 'custom_prompt';
      message = agentFollowUpPrompt.replace(/\{name\}/g, contactName);
    } else {
      const generated = await classifyAndGenerateFollowUp(
        conv.id,
        conv.business_id,
        biz?.name || 'us',
        contactName,
        channel,
        settings.tone as string,
        nextAttempt,
      );
      reason = generated.reason;
      message = generated.message;
    }

    await supabase.from('follow_up_queue').insert({
      business_id: conv.business_id,
      conversation_id: conv.id,
      contact_id: conv.contact_id,
      attempt_number: nextAttempt,
      scheduled_at: new Date().toISOString(),
      channel,
      reason,
      message,
      status: 'pending',
    });

    enqueued++;
  }

  return new Response(JSON.stringify({ checked: staleConversations.length, enqueued }), { status: 200 });
}
