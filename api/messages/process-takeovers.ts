import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '- ');
}

async function buildBusinessContext(businessId: string, opts?: { contactName?: string; channel?: string }): Promise<string> {
  const [bizRes, svcRes, faqRes] = await Promise.all([
    supabase.from('businesses').select('name, industry, address, phone, website, tone, greeting, ai_system_prompt').eq('id', businessId).single(),
    supabase.from('services').select('name, description, price_from, price_to, bookable').eq('business_id', businessId),
    supabase.from('faqs').select('question, answer').eq('business_id', businessId),
  ]);

  const biz = bizRes.data;
  if (!biz) return '';

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

  if (biz.ai_system_prompt) prompt += `\nCustom instructions:\n${biz.ai_system_prompt}`;

  prompt += '\n\nIMPORTANT RULES:\n- NEVER use markdown formatting. Write plain text only.\n- NEVER use placeholders like [Name] or [Your Name].';

  if (opts?.contactName) {
    prompt += `\n- The customer's name is: ${opts.contactName}. Use their first name naturally.`;
  } else {
    prompt += '\n- You do not know the customer\'s name. Do not guess or use placeholders.';
  }

  if (opts?.channel === 'email') {
    prompt += '\n- This is an email reply. Be professional but concise.';
  } else {
    prompt += '\n- This is a WhatsApp message. Keep replies short, casual, and conversational.';
  }

  return prompt;
}

async function getConversationHistory(conversationId: string): Promise<Array<{role: 'user' | 'assistant', content: string}>> {
  const { data: rows } = await supabase
    .from('messages')
    .select('body, sender')
    .eq('conversation_id', conversationId)
    .neq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!rows || rows.length === 0) return [];

  return rows.reverse().map((m: any) => ({
    role: m.sender === 'contact' ? 'user' as const : 'assistant' as const,
    content: (m.body || '').slice(0, 2000),
  }));
}

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

async function generateAIReply(systemPrompt: string, history: Array<{role: 'user' | 'assistant', content: string}>, businessId?: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) return '';
  const model = businessId ? await getModelForBusiness(businessId) : 'claude-sonnet-4-6';
  let messages = history.length > 0 ? history : [{ role: 'user' as const, content: '(new conversation)' }];
  if (messages[0]?.role === 'assistant') {
    messages = [{ role: 'user' as const, content: '(prior context)' }, ...messages];
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) return '';
  const data = await res.json() as { content?: Array<{ text?: string }> };
  return stripMarkdown(data.content?.[0]?.text || '');
}

async function sendUnipileMessage(accountId: string, recipientPhone: string, text: string) {
  await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_TOKEN, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ account_id: accountId, text, attendees_ids: [recipientPhone] }),
  });
}

async function sendUnipileEmail(accountId: string, to: string, subject: string, body: string, replyToEmailId?: string) {
  const htmlBody = body.replace(/\n/g, '<br>');
  const payload: Record<string, any> = { account_id: accountId, to: [{ identifier: to }], subject, body: htmlBody };
  if (replyToEmailId) payload.reply_to = replyToEmailId;
  await fetch(`https://${UNIPILE_DSN}/api/v1/emails`, {
    method: 'POST',
    headers: { 'X-API-KEY': UNIPILE_TOKEN, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
}

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  try {
    const now = new Date();

    const { data: pending } = await supabase
      .from('ai_takeover_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('takeover_at', now.toISOString())
      .order('takeover_at', { ascending: true })
      .limit(50);

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), { status: 200 });
    }

    let processed = 0;
    let ownerReplied = 0;
    let aiReplied = 0;

    for (const entry of pending) {
      const { data: ownerReply } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', entry.conversation_id)
        .eq('direction', 'outbound')
        .in('sender', ['human'])
        .gt('created_at', entry.message_received_at)
        .limit(1)
        .maybeSingle();

      if (ownerReply) {
        await supabase.from('ai_takeover_queue').update({
          status: 'owner_replied',
          owner_reply_message_id: ownerReply.id,
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        ownerReplied++;
        processed++;
        continue;
      }

      if (!entry.grace_checked_at) {
        await supabase.from('ai_takeover_queue').update({
          grace_checked_at: now.toISOString(),
          takeover_at: new Date(now.getTime() + 60 * 1000).toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      const { data: lateOwnerReply } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', entry.conversation_id)
        .eq('direction', 'outbound')
        .in('sender', ['human'])
        .gt('created_at', entry.grace_checked_at)
        .limit(1)
        .maybeSingle();

      if (lateOwnerReply) {
        await supabase.from('ai_takeover_queue').update({
          status: 'owner_replied',
          owner_reply_message_id: lateOwnerReply.id,
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        ownerReplied++;
        processed++;
        continue;
      }

      const { data: conversation } = await supabase
        .from('conversations')
        .select('id, business_id, contact_id, channel, ai_handling')
        .eq('id', entry.conversation_id)
        .single();

      if (!conversation || conversation.ai_handling === false) {
        await supabase.from('ai_takeover_queue').update({
          status: 'cancelled',
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      const { data: channel } = await supabase
        .from('channels')
        .select('id, unipile_account_id, auto_reply_enabled, draft_mode, config')
        .eq('business_id', conversation.business_id)
        .eq('status', 'connected')
        .limit(1);

      const matchedChannel = (channel || []).find((ch: any) => {
        if (entry.channel === 'whatsapp') return ch.unipile_account_id && !((ch as any).type || '').includes('email');
        if (entry.channel === 'email') return ch.unipile_account_id && ((ch as any).type || '').includes('email');
        return false;
      }) || (channel || [])[0];

      if (!matchedChannel?.unipile_account_id || !matchedChannel.auto_reply_enabled) {
        await supabase.from('ai_takeover_queue').update({
          status: 'cancelled',
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      let contactName: string | undefined;
      if (conversation.contact_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('name')
          .eq('id', conversation.contact_id)
          .single();
        if (contact?.name && !contact.name.startsWith('+') && !contact.name.includes('@')) {
          contactName = contact.name;
        }
      }

      const isEmail = entry.channel === 'email';
      const [systemPrompt, history] = await Promise.all([
        buildBusinessContext(conversation.business_id, { contactName, channel: isEmail ? 'email' : 'whatsapp' }),
        getConversationHistory(conversation.id),
      ]);

      if (!systemPrompt) {
        await supabase.from('ai_takeover_queue').update({
          status: 'cancelled',
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      const fullPrompt = isEmail
        ? `${systemPrompt}\n\nYou are replying to an email. Write a professional, well-formatted email reply. Do not include a subject line — just the body text. Keep it concise and helpful.`
        : systemPrompt;

      const reply = await generateAIReply(fullPrompt, history, conversation.business_id);
      if (!reply) {
        await supabase.from('ai_takeover_queue').update({
          status: 'cancelled',
          processed_at: now.toISOString(),
        }).eq('id', entry.id);
        processed++;
        continue;
      }

      const draftMode = (matchedChannel as any).draft_mode !== false;

      if (!draftMode) {
        if (isEmail) {
          const triggerMeta = await supabase
            .from('messages')
            .select('metadata')
            .eq('id', entry.trigger_message_id)
            .single();
          const meta = (triggerMeta.data?.metadata as Record<string, any>) || {};
          const subject = meta.subject || '';
          const externalId = meta.external_id || '';
          const senderEmail = meta.sender_email || '';
          const replySubject = subject ? `Re: ${subject.replace(/^Re:\s*/i, '')}` : 'Re: Your message';
          await sendUnipileEmail(matchedChannel.unipile_account_id, senderEmail, replySubject, reply, externalId);
        } else {
          const { data: contact } = await supabase
            .from('contacts')
            .select('phone, whatsapp')
            .eq('id', conversation.contact_id!)
            .single();
          const recipientPhone = contact?.whatsapp || contact?.phone || '';
          if (recipientPhone) {
            await sendUnipileMessage(matchedChannel.unipile_account_id, recipientPhone, reply);
          }
        }
      }

      const { data: aiMsg } = await supabase.from('messages').insert({
        conversation_id: conversation.id,
        direction: 'outbound',
        sender: 'ai',
        content_type: 'text',
        body: reply,
        status: draftMode ? 'draft' : 'sent',
        metadata: { via: `takeover_${entry.channel}` },
      }).select('id').single();

      if (!draftMode) {
        await supabase.from('conversations').update({
          last_message_at: new Date().toISOString(),
          last_message_preview: reply.slice(0, 100),
        }).eq('id', conversation.id);
      }

      await supabase.from('ai_takeover_queue').update({
        status: 'ai_replied',
        ai_reply_message_id: aiMsg?.id || null,
        processed_at: now.toISOString(),
      }).eq('id', entry.id);

      aiReplied++;
      processed++;
    }

    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    await supabase.from('ai_takeover_queue')
      .update({ status: 'expired', processed_at: now.toISOString() })
      .eq('status', 'pending')
      .lt('created_at', twoHoursAgo);

    return new Response(JSON.stringify({ ok: true, processed, ownerReplied, aiReplied }), { status: 200 });
  } catch (err: any) {
    console.error('[process-takeovers] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
