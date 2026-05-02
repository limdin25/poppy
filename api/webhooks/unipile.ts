import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;
const UNIPILE_WEBHOOK_SECRET = process.env.UNIPILE_WEBHOOK_SECRET || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

function toE164(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.replace(/^whatsapp:/, '').trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return trimmed;
  return trimmed.startsWith('+') ? trimmed : `+${digits}`;
}

async function fetchUnipileAccount(accountId: string) {
  const res = await fetch(`https://${UNIPILE_DSN}/api/v1/accounts/${accountId}`, {
    headers: { 'X-API-KEY': UNIPILE_TOKEN, accept: 'application/json' },
  });
  if (!res.ok) return null;
  const j: any = await res.json();
  const phone =
    j?.connection_params?.im?.phone ??
    j?.params?.phone_number ??
    j?.phone_number ??
    null;
  return {
    phone,
    type: j?.type ?? j?.provider,
    status: j?.sources?.[0]?.status ?? j?.status,
    name: j?.name ?? j?.display_name,
  };
}

async function generateAIReply(systemPrompt: string, messageText: string): Promise<string> {
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
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || '';
}

async function sendUnipileMessage(accountId: string, recipientPhone: string, text: string) {
  await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
    method: 'POST',
    headers: {
      'X-API-KEY': UNIPILE_TOKEN,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      account_id: accountId,
      attendees_ids: [recipientPhone],
      text,
    }),
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const payload = await req.json() as {
      event?: string;
      account_id?: string;
      status?: string;
      name?: string;
      message?: { id?: string; text?: string };
      sender?: { provider_id?: string; name?: string };
    };

    // Detect payload type: account_connected vs messaging event
    const looksLikeHostedNotify =
      typeof payload.status === 'string' ||
      (payload.account_id && payload.name && !payload.event);

    // Verify webhook secret on messaging events (not on hosted-auth callbacks)
    if (!looksLikeHostedNotify && UNIPILE_WEBHOOK_SECRET) {
      const got = req.headers.get('unipile-auth') || req.headers.get('Unipile-Auth') || '';
      if (got !== UNIPILE_WEBHOOK_SECRET) {
        return new Response(JSON.stringify({ ok: true, note: 'bad auth' }), { status: 200 });
      }
    }

    // ── Branch 1: Account connected (hosted-auth callback) ──
    if (
      payload.status === 'CREATION_SUCCESS' ||
      payload.status === 'OK' ||
      (payload.account_id && payload.name && !payload.event)
    ) {
      const accountId = payload.account_id;
      if (!accountId) {
        return new Response(JSON.stringify({ ok: true, note: 'no account_id' }), { status: 200 });
      }

      const acct = await fetchUnipileAccount(accountId);
      const phone = toE164(acct?.phone ?? '');

      // Find which business triggered this connect — stored in the link name
      // Format: "{businessName} WhatsApp" or just businessId
      // We look for any channel row with this unipile_account_id, or create one
      // The connect endpoint passes businessId in metadata, but hosted-auth
      // callbacks don't reliably carry it. We'll upsert by unipile_account_id.

      // Check if channel already exists for this account
      const { data: existingChannel } = await supabase
        .from('channels')
        .select('id, business_id')
        .eq('unipile_account_id', accountId)
        .single();

      if (existingChannel) {
        await supabase
          .from('channels')
          .update({
            status: 'connected',
            connected_at: new Date().toISOString(),
            config: { phone, unipile_type: acct?.type },
          })
          .eq('id', existingChannel.id);
      }
      // If no existing channel, the connect endpoint should have created one.
      // If not, we can't link it without a businessId — log and move on.

      return new Response(JSON.stringify({ ok: true, note: 'account_connected', accountId }), { status: 200 });
    }

    // ── Branch 2: Inbound message ──
    if (payload.event === 'message_received' && payload.account_id) {
      const accountId = payload.account_id;
      const messageId = payload.message?.id;
      const messageText = payload.message?.text || '';
      const senderPhone = toE164(payload.sender?.provider_id || '');
      const senderName = payload.sender?.name || senderPhone;

      if (!messageText || !senderPhone) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no text or sender' }), { status: 200 });
      }

      // Find channel by unipile_account_id
      const { data: channel } = await supabase
        .from('channels')
        .select('id, business_id, auto_reply_enabled')
        .eq('unipile_account_id', accountId)
        .eq('status', 'connected')
        .single();

      if (!channel) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no channel' }), { status: 200 });
      }

      const businessId = channel.business_id;

      // Find or create contact
      let contactId: string | null = null;
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('business_id', businessId)
        .eq('phone', senderPhone)
        .maybeSingle();

      if (existing) {
        contactId = existing.id;
      } else {
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            business_id: businessId,
            phone: senderPhone,
            whatsapp: senderPhone,
            name: senderName,
          })
          .select('id')
          .single();
        contactId = newContact?.id || null;
      }

      if (!contactId) {
        return new Response(JSON.stringify({ ok: true, skipped: 'contact failed' }), { status: 200 });
      }

      // Find or create conversation
      let conversationId: string | null = null;
      const { data: existingConvo } = await supabase
        .from('conversations')
        .select('id')
        .eq('business_id', businessId)
        .eq('contact_id', contactId)
        .eq('channel', 'whatsapp')
        .eq('status', 'open')
        .maybeSingle();

      if (existingConvo) {
        conversationId = existingConvo.id;
      } else {
        const { data: newConvo } = await supabase
          .from('conversations')
          .insert({
            business_id: businessId,
            contact_id: contactId,
            channel: 'whatsapp',
            status: 'open',
            ai_handling: true,
          })
          .select('id')
          .single();
        conversationId = newConvo?.id || null;
      }

      if (!conversationId) {
        return new Response(JSON.stringify({ ok: true, skipped: 'conversation failed' }), { status: 200 });
      }

      // Store inbound message
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        direction: 'inbound',
        sender: 'contact',
        content_type: 'text',
        body: messageText,
        metadata: {
          sender_name: senderName,
          sender_phone: senderPhone,
          external_id: messageId,
        },
      });

      // Update conversation preview
      await supabase
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: messageText.slice(0, 100),
          unread_count: (existingConvo ? 1 : 1), // increment handled by trigger if needed
        })
        .eq('id', conversationId);

      // AI auto-reply if enabled on this channel
      if (channel.auto_reply_enabled) {
        const { data: business } = await supabase
          .from('businesses')
          .select('ai_system_prompt, name')
          .eq('id', businessId)
          .single();

        if (business?.ai_system_prompt) {
          const reply = await generateAIReply(business.ai_system_prompt, messageText);

          if (reply) {
            await sendUnipileMessage(accountId, senderPhone, reply);

            await supabase.from('messages').insert({
              conversation_id: conversationId,
              direction: 'outbound',
              sender: 'ai',
              content_type: 'text',
              body: reply,
              metadata: { via: 'unipile_auto_reply' },
            });

            await supabase
              .from('conversations')
              .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: reply.slice(0, 100),
              })
              .eq('id', conversationId);
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, note: 'message_received' }), { status: 200 });
    }

    // Unknown event — acknowledge
    return new Response(JSON.stringify({ ok: true, skipped: 'unhandled event' }), { status: 200 });
  } catch (err: any) {
    console.error('[unipile-webhook] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
