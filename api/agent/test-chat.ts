import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { buildBusinessContext, generateAIReply } from '../lib/ai-reply.js';
import { callLLM } from '../lib/llm.js';
import { notifyBusinessOwner } from '../lib/notify.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

interface AutomationEvent {
  type: 'system_note' | 'follow_up' | 'confirmation' | 'reminder' | 'owner_alert';
  message: string;
  label: string;
  delaySec: number;
}

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) {
    const h = Math.round(seconds / 3600);
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  const d = Math.round(seconds / 86400);
  return d === 1 ? '1 day' : `${d} days`;
}

async function classifyBooking(
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>,
  businessName: string,
  timezone: string,
): Promise<{ confirmed: boolean; service?: string; datetime?: string; datetime_iso?: string; customer_name?: string }> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });

  const prompt = `You detect confirmed bookings in conversations.

A booking is CONFIRMED only when:
- The assistant explicitly confirms an appointment is booked
- A specific date AND time are agreed
- Both customer and assistant agree

NOT confirmed: just discussing, asking about availability, mentioning prices.

Today: ${today}. Timezone: ${timezone}. Business: ${businessName}.

Respond with ONLY valid JSON, no other text:
If confirmed: {"confirmed":true,"service":"name","customer_name":"if known","datetime":"Thu 8 May, 8:00 PM","datetime_iso":"2026-05-08T20:00:00"}
If not: {"confirmed":false}`;

  const raw = await callLLM('claude-haiku-4-5-20251001', prompt, conversation, 300);
  try {
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* fall through */ }
  return { confirmed: false };
}

async function generateFollowUps(
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>,
  businessName: string,
  count: number,
  tone: string,
  customPrompt?: string | null,
): Promise<string[]> {
  const prompt = customPrompt
    ? `Write ${count} follow-up messages for ${businessName} using this template: "${customPrompt}".
Replace {name} with "there". Tone: ${tone}. Each under 200 chars. Plain text.
Each message MUST be different. Respond with ONLY a JSON array: [{"message":"..."}]`
    : `The customer stopped responding to ${businessName}. Write ${count} follow-up messages.

Rules:
- Reference the SPECIFIC topic from the conversation (service asked about, price discussed, question raised)
- Tone: ${tone}
- Each under 200 chars, plain text, no markdown
- Each message MUST be different and specific to this conversation
- Do NOT write generic "just following up" or "checking in" messages

Respond with ONLY a JSON array, nothing else: [{"message":"..."}]`;

  const raw = await callLLM('claude-haiku-4-5-20251001', prompt, conversation, 600);
  try {
    const match = raw.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.map((f: { message: string }) => f.message).filter(Boolean);
    }
  } catch { /* fall through */ }
  return [];
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const { agentId, messages } = await req.json() as {
    agentId?: string;
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!agentId || !messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'agentId and messages required' }), { status: 400 });
  }

  const { data: agent } = await supabase
    .from('agents')
    .select('agent_type, business_id')
    .eq('id', agentId)
    .eq('business_id', auth.businessId)
    .single();

  if (!agent) {
    return new Response(JSON.stringify({ error: 'Agent not found' }), { status: 404 });
  }

  const channelMap: Record<string, string> = {
    whatsapp: 'whatsapp',
    email: 'email',
    sms: 'whatsapp',
    instagram: 'whatsapp',
  };
  const channel = channelMap[agent.agent_type] || 'whatsapp';

  const [{ data: biz }, { data: agentSettings }] = await Promise.all([
    supabase.from('businesses').select('name, timezone').eq('id', auth.businessId).single(),
    supabase.from('agents').select(
      'follow_up_enabled, follow_up_max_attempts, follow_up_delay_hours, follow_up_tone, follow_up_prompt, confirmation_enabled, reminder_enabled, reminder_times_seconds, owner_confirmation_enabled',
    ).eq('id', agentId).single(),
  ]);

  const businessName = biz?.name || 'the business';
  const timezone = biz?.timezone || 'Europe/London';

  const systemPrompt = await buildBusinessContext(auth.businessId, { channel, agentId });
  if (!systemPrompt) {
    return new Response(JSON.stringify({ error: 'Could not build context' }), { status: 500 });
  }

  const chatMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant');
  const reply = await generateAIReply(systemPrompt, chatMessages, auth.businessId, agentId);

  const fullConvo = [...chatMessages, { role: 'assistant' as const, content: reply }];
  const automations: AutomationEvent[] = [];

  const booking = await classifyBooking(fullConvo, businessName, timezone);

  if (booking.confirmed) {
    const svc = booking.service || 'Appointment';
    const dt = booking.datetime || 'scheduled time';
    const dtIso = booking.datetime_iso;
    const customerName = booking.customer_name || 'Test Customer';

    let startTime: string;
    let endTime: string;
    if (dtIso) {
      startTime = new Date(dtIso).toISOString();
      endTime = new Date(new Date(dtIso).getTime() + 60 * 60 * 1000).toISOString();
    } else {
      startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      endTime = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    }

    const { data: appointment, error: aptErr } = await supabase
      .from('appointments')
      .insert({
        business_id: auth.businessId,
        title: `${svc} - ${customerName}`,
        description: `TEST BOOKING created via agent test chat.\nService: ${svc}\nCustomer: ${customerName}`,
        starts_at: startTime,
        ends_at: endTime,
        status: 'confirmed',
        booked_via: 'web',
      })
      .select('id')
      .single();

    if (appointment && !aptErr) {
      automations.push({
        type: 'system_note',
        message: `Booking created in database: ${svc} - ${customerName}, ${dt}`,
        label: 'System',
        delaySec: 0,
      });

      if (agentSettings?.confirmation_enabled !== false) {
        automations.push({
          type: 'confirmation',
          message: `Your ${svc} with ${businessName} is confirmed for ${dt}. We look forward to seeing you!`,
          label: 'Confirmation sent to customer',
          delaySec: 0,
        });
      }

      if (agentSettings?.reminder_enabled !== false && agentSettings?.reminder_times_seconds?.length) {
        const sorted = [...agentSettings.reminder_times_seconds].sort((a: number, b: number) => b - a);
        for (const sec of sorted) {
          automations.push({
            type: 'reminder',
            message: `Reminder: You have ${svc} with ${businessName} coming up. See you ${dt}!`,
            label: `Reminder · ${formatDelay(sec)} before`,
            delaySec: 0,
          });
        }
      }

      const notifyResult = await notifyBusinessOwner(auth.businessId, 'booking', {
        title: `New booking: ${svc} - ${customerName}`,
        body: `${svc} booked for ${dt}.\nCustomer: ${customerName}\nBooked via: Agent test chat`,
      });

      if (notifyResult.sent.length > 0) {
        automations.push({
          type: 'owner_alert',
          message: `Owner notified via ${notifyResult.sent.join(', ')}`,
          label: 'Owner notification sent',
          delaySec: 0,
        });
      } else {
        automations.push({
          type: 'system_note',
          message: 'Owner notification skipped (not configured or disabled)',
          label: 'System',
          delaySec: 0,
        });
      }
    } else {
      automations.push({
        type: 'system_note',
        message: `Booking creation failed: ${aptErr?.message || 'unknown error'}`,
        label: 'System error',
        delaySec: 0,
      });
    }
  } else if (agentSettings?.follow_up_enabled !== false) {
    const maxAttempts = agentSettings?.follow_up_max_attempts || 2;
    const rawDelays: number[] = agentSettings?.follow_up_delay_hours || [7200, 86400];
    const isLegacy = rawDelays.length > 0 && rawDelays.every((d: number) => d <= 48);
    const delays = isLegacy ? rawDelays.map((d: number) => d * 3600) : rawDelays;
    const tone = agentSettings?.follow_up_tone || 'friendly';

    const followUpMsgs = await generateFollowUps(
      fullConvo, businessName, maxAttempts, tone, agentSettings?.follow_up_prompt,
    );

    const fallbacks = [
      `Hi! Still thinking about what we discussed? Let us know if you have questions about ${businessName}.`,
      `Hello! Just wanted to check in. We'd love to help whenever you're ready.`,
      `Hi there! We're still here if you'd like to continue. Let us know!`,
    ];

    for (let i = 0; i < maxAttempts; i++) {
      const delaySec = delays[i] || delays[delays.length - 1] || 7200;
      automations.push({
        type: 'follow_up',
        message: followUpMsgs[i] || fallbacks[i % fallbacks.length],
        label: `Follow-up ${i + 1} · After ${formatDelay(delaySec)}`,
        delaySec,
      });
    }
  }

  return new Response(JSON.stringify({ reply, channel: channel.toUpperCase(), automations }), { status: 200 });
}
