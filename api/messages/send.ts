import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { conversationId, body } = await req.json() as { conversationId?: string; body?: string };

    if (!conversationId || !body) {
      return new Response(
        JSON.stringify({ error: 'conversationId and body are required' }),
        { status: 400 },
      );
    }

    // Get conversation + contact + channel
    const { data: convo } = await supabase
      .from('conversations')
      .select('id, business_id, contact_id, channel')
      .eq('id', conversationId)
      .single();

    if (!convo) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
    }

    if (convo.channel !== 'whatsapp') {
      return new Response(JSON.stringify({ error: 'Only WhatsApp send is supported' }), { status: 400 });
    }

    // Get contact phone
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, phone, whatsapp')
      .eq('id', convo.contact_id)
      .single();

    if (!contact) {
      return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404 });
    }

    const recipientPhone = contact.whatsapp || contact.phone;
    if (!recipientPhone) {
      return new Response(JSON.stringify({ error: 'Contact has no phone number' }), { status: 400 });
    }

    // Get the connected WhatsApp channel for this business
    const { data: channel } = await supabase
      .from('channels')
      .select('id, unipile_account_id')
      .eq('business_id', convo.business_id)
      .eq('type', 'whatsapp')
      .eq('status', 'connected')
      .single();

    if (!channel?.unipile_account_id) {
      return new Response(
        JSON.stringify({ error: 'No connected WhatsApp channel. Connect one in Settings.' }),
        { status: 400 },
      );
    }

    // Send via Unipile
    const uRes = await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
      method: 'POST',
      headers: {
        'X-API-KEY': UNIPILE_TOKEN,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        account_id: channel.unipile_account_id,
        attendees_ids: [recipientPhone],
        text: body,
      }),
    });

    const uText = await uRes.text();
    let externalId: string | null = null;
    if (uRes.ok) {
      try {
        const uJson = JSON.parse(uText);
        externalId = uJson.message_id ?? uJson.chat_id ?? uJson.id ?? null;
      } catch {}
    } else {
      return new Response(
        JSON.stringify({ error: `Unipile send failed: ${uRes.status}`, detail: uText.slice(0, 500) }),
        { status: 502 },
      );
    }

    // Store outbound message
    const { data: msg } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        direction: 'outbound',
        sender: 'human',
        content_type: 'text',
        body,
        metadata: { external_id: externalId, via: 'unipile' },
      })
      .select('id')
      .single();

    // Update conversation preview
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 100),
      })
      .eq('id', conversationId);

    return new Response(
      JSON.stringify({ ok: true, message_id: msg?.id, external_id: externalId }),
      { status: 200 },
    );
  } catch (err: any) {
    console.error('[messages/send] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
