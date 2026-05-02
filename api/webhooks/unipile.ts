import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const UNIPILE_API_URL = process.env.UNIPILE_API_URL!;
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY!;

async function generateAIReply(
  systemPrompt: string,
  messageText: string,
  channel: 'whatsapp' | 'email',
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messageText },
      ],
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function sendUnipileReply(accountId: string, chatId: string, text: string) {
  await fetch(`${UNIPILE_API_URL}/api/v1/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      'X-API-KEY': UNIPILE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const payload = await req.json();
    const { event, data } = payload;

    // Handle account creation success
    if (event === 'CREATION_SUCCESS' || event === 'account.created') {
      const accountId = data.account_id || data.id;
      const metadata = data.metadata ? JSON.parse(data.metadata) : {};
      const businessId = metadata.business_id;

      if (businessId && accountId) {
        await supabase.from('channels').insert({
          business_id: businessId,
          type: 'whatsapp',
          provider: 'unipile',
          provider_id: accountId,
          enabled: true,
        });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Handle inbound messages
    if (event === 'message_received' || event === 'message.received') {
      const accountId = data.account_id;
      const chatId = data.chat_id;
      const messageText = data.text || data.body || '';
      const senderName = data.sender_name || data.from_name || null;
      const senderPhone = data.sender_phone || data.from || null;

      if (!accountId || !messageText) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
      }

      // Find channel by provider_id
      const { data: channel } = await supabase
        .from('channels')
        .select('business_id, type, enabled')
        .eq('provider_id', accountId)
        .single();

      if (!channel || !channel.enabled) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
      }

      const businessId = channel.business_id;
      const channelType = channel.type as 'whatsapp' | 'email';

      // Get business system prompt
      const { data: business } = await supabase
        .from('businesses')
        .select('system_prompt, name, auto_reply_enabled')
        .eq('id', businessId)
        .single();

      // Find or create contact
      let contactId: string | null = null;
      if (senderPhone) {
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('business_id', businessId)
          .eq('phone', senderPhone)
          .single();

        if (existing) {
          contactId = existing.id;
        } else {
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              business_id: businessId,
              phone: senderPhone,
              name: senderName,
            })
            .select('id')
            .single();
          contactId = newContact?.id || null;
        }
      }

      // Find or create conversation
      let conversationId: string | null = null;
      const { data: existingConvo } = await supabase
        .from('conversations')
        .select('id')
        .eq('business_id', businessId)
        .eq('contact_id', contactId)
        .eq('channel', channelType)
        .eq('status', 'open')
        .single();

      if (existingConvo) {
        conversationId = existingConvo.id;
      } else {
        const { data: newConvo } = await supabase
          .from('conversations')
          .insert({
            business_id: businessId,
            contact_id: contactId,
            channel: channelType,
            status: 'open',
          })
          .select('id')
          .single();
        conversationId = newConvo?.id || null;
      }

      // Store inbound message
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'user',
        content: messageText,
        channel: channelType,
        metadata: { sender_name: senderName, sender_phone: senderPhone },
      });

      // AI auto-reply if enabled
      if (business?.auto_reply_enabled && business.system_prompt) {
        const reply = await generateAIReply(business.system_prompt, messageText, channelType);

        if (reply) {
          // Send via Unipile
          await sendUnipileReply(accountId, chatId, reply);

          // Store outbound message
          await supabase.from('messages').insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: reply,
            channel: channelType,
          });
        }
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // Unknown event — acknowledge
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
