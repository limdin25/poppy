import { createClient } from '@supabase/supabase-js';
import { sendSMS } from '../../src/integrations/twilio/client.js';
import { buildBusinessContext, getConversationHistory, generateAIReply, stripMarkdown } from '../lib/ai-reply.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

// Demo line: over text, Elsie sells the onboarding rather than acting as a
// generic receptionist. Scoped to the demo business.
const DEMO_BUSINESS_ID = 'f8b98eb2-192e-4c22-87fd-90c865123fe7';
const DEMO_SMS_PROMPT = `You are Elsie — the friendly assistant behind an AI phone receptionist. You're texting a small-business owner who just tried you out on a demo call.

Your goal: warmly get them booked for a quick 15-minute onboarding so Elsie can start answering their real calls.

Style: text like a helpful human — short, warm, casual, 1-2 sentences max. Never use markdown, bullet points, or placeholders like [Name].

- If they seem keen, ask what time suits for a quick onboarding and suggest tomorrow.
- If they give a day/time, confirm it warmly and say you'll send an invite over.
- If they ask about price or how it works, answer briefly and honestly, then steer back to booking.
- If they're hesitant, reassure them — it's quick and no commitment.
Never be pushy. Sign off as Elsie now and then.`;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

// If a firm onboarding date+time has been agreed over text, create a real
// appointment so the team sees it on the dashboard's Appointments page.
async function maybeBookOnboarding(
  businessId: string, contactId: string | null, conversationId: string | null,
  name: string | null, phone: string, history: Array<{ role: string; content: string }>,
): Promise<string | null> {
  try {
    if (!conversationId) return null;
    const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }).format(new Date());
    const chat = history.map((h) => `${h.role === 'user' ? 'Customer' : 'Elsie'}: ${h.content}`).join('\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 150, messages: [{ role: 'user', content: `Today is ${today} (Europe/London). Below is a text chat where a business owner books a 15-minute ONBOARDING with Elsie. If a specific onboarding date AND time has now been clearly AGREED, return JSON {"booked":true,"iso":"<full ISO 8601 with the correct +01:00 BST offset>","label":"<short, e.g. Tomorrow 5pm>"}. If no firm date+time yet, return {"booked":false}. JSON only.\n\nChat:\n${chat}` }] }),
    });
    const data = await res.json() as { content?: Array<{ text?: string }> };
    const m = (data.content?.[0]?.text || '').match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { booked: false };
    if (!parsed.booked || !parsed.iso) return null;
    const start = new Date(parsed.iso);
    if (isNaN(start.getTime())) return null;
    // one appointment per conversation — update if it already exists
    const { data: existing } = await supabase.from('appointments').select('id').eq('conversation_id', conversationId).limit(1).maybeSingle();
    const row = {
      business_id: businessId, contact_id: contactId, conversation_id: conversationId,
      title: `Onboarding call — ${name || phone}`,
      description: `Elsie onboarding booked via text. ${parsed.label || ''}`.trim(),
      starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 30 * 60000).toISOString(),
      status: 'confirmed', booked_via: 'sms',
    };
    if (existing) { await supabase.from('appointments').update(row).eq('id', existing.id); return existing.id; }
    const { data: ins } = await supabase.from('appointments').insert(row).select('id').single();
    return ins?.id || null;
  } catch (e) { console.error('[twilio-sms] booking detect failed:', e); return null; }
}

const empty = () => new Response('', { status: 200, headers: { 'Content-Type': 'text/xml' } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return empty();
  try {
    const params = new URLSearchParams(await req.text());
    const from = (params.get('From') || '').trim();     // the customer
    const to = (params.get('To') || '').trim();          // our Elsie number
    const body = (params.get('Body') || '').trim();
    const sid = params.get('MessageSid') || null;
    if (!from || !to || !body) return empty();

    // Which business owns the number that was texted?
    const { data: channels } = await supabase
      .from('channels')
      .select('business_id, agent_id, config')
      .in('type', ['voice', 'sms']);
    const channel = (channels || []).find((c: any) => (c.config?.phone || '') === to);
    if (!channel) return empty();
    const businessId = channel.business_id as string;
    const agentId = (channel.agent_id as string) || null;

    // Find or create the contact by phone.
    let contactId: string | null = null;
    let contactName: string | null = null;
    const { data: existingContact } = await supabase
      .from('contacts').select('id, name').eq('business_id', businessId).eq('phone', from).maybeSingle();
    if (existingContact) { contactId = existingContact.id; contactName = existingContact.name; }
    else {
      const { data: nc } = await supabase.from('contacts').insert({ business_id: businessId, phone: from }).select('id, name').single();
      contactId = nc?.id || null; contactName = nc?.name || null;
    }

    // Find or create the SMS conversation for this contact.
    let conversationId: string | null = null;
    const { data: convo } = await supabase
      .from('conversations').select('id')
      .eq('business_id', businessId).eq('contact_id', contactId).eq('channel', 'sms')
      .neq('status', 'archived').order('last_message_at', { ascending: false }).limit(1).maybeSingle();
    if (convo) conversationId = convo.id;
    else {
      const { data: nc } = await supabase.from('conversations').insert({
        business_id: businessId, contact_id: contactId, agent_id: agentId,
        channel: 'sms', status: 'open', last_message_at: new Date().toISOString(),
        last_message_preview: body, unread_count: 1, ai_handling: true,
      }).select('id').single();
      conversationId = nc?.id || null;
    }

    // Store the inbound text.
    await supabase.from('messages').insert({
      conversation_id: conversationId, direction: 'inbound', sender: 'contact',
      content_type: 'text', body, metadata: { twilio_sid: sid },
    });

    // Build the reply.
    const systemPrompt = businessId === DEMO_BUSINESS_ID
      ? DEMO_SMS_PROMPT + (contactName ? `\n\nThe person's name is ${contactName}; use their first name naturally.` : '')
      : await buildBusinessContext(businessId, { channel: 'sms', agentId, contactName: contactName || undefined });

    const history = conversationId ? await getConversationHistory(conversationId) : [{ role: 'user' as const, content: body }];
    const reply = stripMarkdown(await generateAIReply(systemPrompt, history, businessId, agentId || undefined)).trim();
    if (!reply) return empty();

    // Send it from the Elsie number back to the customer.
    let sentSid: string | null = null;
    try { sentSid = (await sendSMS(to, from, reply)).sid; }
    catch (e) { console.error('[twilio-sms] send failed:', e); return empty(); }

    // Store the outbound reply.
    await supabase.from('messages').insert({
      conversation_id: conversationId, direction: 'outbound', sender: 'ai',
      content_type: 'text', body: reply, metadata: { twilio_sid: sentSid },
    });
    await supabase.from('conversations').update({
      last_message_at: new Date().toISOString(), last_message_preview: reply,
    }).eq('id', conversationId);

    // Demo line: if an onboarding time was just agreed, create a real appointment.
    if (businessId === DEMO_BUSINESS_ID) {
      await maybeBookOnboarding(businessId, contactId, conversationId, contactName, from,
        history.concat([{ role: 'assistant', content: reply }]));
    }

    return empty();
  } catch (e) {
    console.error('[twilio-sms] error:', e);
    return empty();
  }
}
