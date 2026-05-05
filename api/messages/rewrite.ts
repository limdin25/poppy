import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

export const config = { runtime: 'edge' };

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '- ');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { messageId } = await req.json() as { messageId: string };
    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId required' }), { status: 400 });
    }

    const { data: msg } = await supabase
      .from('messages')
      .select('id, body, conversation_id, status')
      .eq('id', messageId)
      .single();

    if (!msg || msg.status !== 'draft') {
      return new Response(JSON.stringify({ error: 'Draft not found' }), { status: 404 });
    }

    const { data: conv } = await supabase
      .from('conversations')
      .select('id, channel, contact_id, business_id')
      .eq('id', msg.conversation_id)
      .single();

    if (!conv) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('name')
      .eq('id', conv.contact_id)
      .single();

    const contactName = contact?.name && !contact.name.startsWith('+') ? contact.name : undefined;

    // Build system prompt
    const [bizRes, svcRes, faqRes] = await Promise.all([
      supabase.from('businesses').select('name, industry, address, phone, website, tone, greeting, ai_system_prompt').eq('id', conv.business_id).single(),
      supabase.from('services').select('name, description, price_from, price_to, bookable').eq('business_id', conv.business_id),
      supabase.from('faqs').select('question, answer').eq('business_id', conv.business_id),
    ]);

    const biz = bizRes.data;
    if (!biz) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    let prompt = `You are an AI assistant for ${biz.name || 'this business'}.`;
    if (biz.industry) prompt += ` Industry: ${biz.industry}.`;
    if (biz.address) prompt += ` Location: ${biz.address}.`;
    if (biz.phone) prompt += ` Phone: ${biz.phone}.`;
    if (biz.website) prompt += ` Website: ${biz.website}.`;
    if (biz.tone) prompt += ` Tone: ${biz.tone}.`;
    if (biz.greeting) prompt += `\n\nGreeting: ${biz.greeting}`;

    const services = svcRes.data || [];
    if (services.length > 0) {
      prompt += '\n\nServices offered:\n';
      services.forEach((s: any) => {
        prompt += `- ${s.name}`;
        if (s.description) prompt += `: ${s.description}`;
        if (s.price_from != null) prompt += ` (from £${s.price_from}${s.price_to ? ` to £${s.price_to}` : ''})`;
        if (s.bookable) prompt += ' [bookable]';
        prompt += '\n';
      });
    }

    const faqs = faqRes.data || [];
    if (faqs.length > 0) {
      prompt += '\nFAQs:\n';
      faqs.forEach((f: any) => { prompt += `Q: ${f.question}\nA: ${f.answer}\n\n`; });
    }

    if (biz.ai_system_prompt) {
      prompt += `\nCustom instructions:\n${biz.ai_system_prompt}`;
    }

    prompt += '\n\nIMPORTANT RULES:\n- NEVER use markdown formatting (no **, no *, no #, no bullet points with -). Write plain text only.\n- NEVER use placeholders like [Name] or [Your Name].';

    if (contactName) {
      prompt += `\n- The customer's name is: ${contactName}. Use their first name naturally.`;
    } else {
      prompt += '\n- You do not know the customer\'s name. Do not guess or use placeholders.';
    }

    const isEmail = conv.channel === 'email';
    if (isEmail) {
      prompt += '\n- This is an email reply. Be professional but concise.';
    } else {
      prompt += '\n- This is a WhatsApp message. Keep replies short, casual, and conversational.';
    }

    prompt += '\n- Write a DIFFERENT reply than before. Vary your phrasing and approach.';

    // Get conversation history (excluding drafts)
    const { data: historyRows } = await supabase
      .from('messages')
      .select('body, sender')
      .eq('conversation_id', conv.id)
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(10);

    let messages: Array<{role: 'user' | 'assistant', content: string}> =
      (historyRows || []).reverse().map((m: any) => ({
        role: m.sender === 'contact' ? 'user' as const : 'assistant' as const,
        content: (m.body || '').slice(0, 2000),
      }));

    if (messages.length === 0) messages = [{ role: 'user', content: '(new conversation)' }];
    if (messages[0]?.role === 'assistant') {
      messages = [{ role: 'user', content: '(prior context)' }, ...messages];
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: prompt,
        messages,
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'AI generation failed' }), { status: 502 });
    }

    const data = await res.json() as { content?: Array<{ text?: string }> };
    const newBody = stripMarkdown(data.content?.[0]?.text || '');

    if (!newBody) {
      return new Response(JSON.stringify({ error: 'Empty AI response' }), { status: 502 });
    }

    await supabase
      .from('messages')
      .update({ body: newBody })
      .eq('id', messageId);

    return new Response(JSON.stringify({ ok: true, body: newBody }), { status: 200 });
  } catch (err: any) {
    console.error('[rewrite] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
