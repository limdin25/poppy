import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;

export const config = { runtime: 'edge' };

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
      .select('id, body, conversation_id, metadata, status')
      .eq('id', messageId)
      .single();

    if (!msg || msg.status !== 'draft') {
      return new Response(JSON.stringify({ error: 'Draft not found' }), { status: 404 });
    }

    const { data: conv } = await supabase
      .from('conversations')
      .select('id, channel, contact_id, business_id, subject')
      .eq('id', msg.conversation_id)
      .single();

    if (!conv) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
    }

    const { data: channel } = await supabase
      .from('channels')
      .select('id, unipile_account_id, type')
      .eq('business_id', conv.business_id)
      .eq('status', 'connected')
      .or(`type.eq.whatsapp,type.eq.email_gmail,type.eq.email_outlook,type.eq.email_smtp`)
      .limit(10);

    const isEmail = conv.channel === 'email';
    const matchingChannel = (channel || []).find(c =>
      isEmail ? c.type.startsWith('email') : c.type === conv.channel
    );

    if (!matchingChannel?.unipile_account_id) {
      return new Response(JSON.stringify({ error: 'No connected channel' }), { status: 400 });
    }

    const accountId = matchingChannel.unipile_account_id;
    const meta = msg.metadata as Record<string, any> || {};

    const { data: contact } = await supabase
      .from('contacts')
      .select('phone, whatsapp, email')
      .eq('id', conv.contact_id)
      .single();

    if (!contact) {
      return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404 });
    }

    if (isEmail) {
      const to = contact.email;
      if (!to) return new Response(JSON.stringify({ error: 'No email for contact' }), { status: 400 });

      const subject = meta.subject || (conv.subject ? `Re: ${conv.subject}` : 'Re: Your message');
      const htmlBody = (msg.body || '').replace(/\n/g, '<br>');
      const payload: Record<string, any> = {
        account_id: accountId,
        to: [{ identifier: to }],
        subject,
        body: htmlBody,
      };
      if (meta.reply_to_email_id) {
        payload.reply_to = meta.reply_to_email_id;
      }
      await fetch(`https://${UNIPILE_DSN}/api/v1/emails`, {
        method: 'POST',
        headers: { 'X-API-KEY': UNIPILE_TOKEN, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      const phone = contact.whatsapp || contact.phone;
      if (!phone) return new Response(JSON.stringify({ error: 'No phone for contact' }), { status: 400 });

      const waId = phone.replace('+', '') + '@s.whatsapp.net';
      await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
        method: 'POST',
        headers: { 'X-API-KEY': UNIPILE_TOKEN, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ account_id: accountId, attendees_ids: [waId], text: msg.body }),
      });
    }

    await supabase
      .from('messages')
      .update({ status: 'sent' })
      .eq('id', messageId);

    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: (msg.body || '').slice(0, 100),
      })
      .eq('id', conv.id);

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    console.error('[approve] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
