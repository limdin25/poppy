import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

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
    let conversationId: string | undefined;
    let body: string | undefined;
    let subject: string | undefined;
    const attachmentBuffers: { name: string; buffer: ArrayBuffer; type: string }[] = [];

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      conversationId = formData.get('conversationId') as string;
      body = formData.get('body') as string;
      subject = (formData.get('subject') as string) || undefined;
      const files = formData.getAll('attachments') as File[];
      for (const file of files) {
        attachmentBuffers.push({
          name: file.name,
          buffer: await file.arrayBuffer(),
          type: file.type,
        });
      }
    } else {
      const json = await req.json() as Record<string, any>;
      conversationId = json.conversationId;
      body = json.body;
      subject = json.subject;
    }

    if (!conversationId || !body) {
      return new Response(
        JSON.stringify({ error: 'conversationId and body are required' }),
        { status: 400 },
      );
    }

    // Get conversation + contact + channel
    const { data: convo } = await supabase
      .from('conversations')
      .select('id, business_id, contact_id, channel, is_group, unipile_chat_id')
      .eq('id', conversationId)
      .single();

    if (!convo) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
    }

    const isEmail = convo.channel === 'email';
    const isGroup = convo.is_group === true;

    let contact: { id: string; phone: string | null; whatsapp: string | null; email: string | null; name: string | null } | null = null;
    let recipient = '';

    if (isGroup && convo.unipile_chat_id) {
      // Groups send via chat_id, no recipient needed
      recipient = '';
    } else {
      if (!convo.contact_id) {
        return new Response(JSON.stringify({ error: 'No contact for this conversation' }), { status: 400 });
      }
      const { data: contactData } = await supabase
        .from('contacts')
        .select('id, phone, whatsapp, email, name')
        .eq('id', convo.contact_id)
        .single();

      if (!contactData) {
        return new Response(JSON.stringify({ error: 'Contact not found' }), { status: 404 });
      }
      contact = contactData;

      if (isEmail) {
        if (!contact.email) {
          return new Response(JSON.stringify({ error: 'Contact has no email address' }), { status: 400 });
        }
        recipient = contact.email;
      } else {
        const recipientPhone = contact.whatsapp || contact.phone;
        if (!recipientPhone) {
          return new Response(JSON.stringify({ error: 'Contact has no phone number' }), { status: 400 });
        }
        recipient = recipientPhone;
      }
    }

    // For email, try gmail first, then outlook, then smtp
    let channel: { id: string; unipile_account_id: string } | null = null;
    if (isEmail) {
      for (const t of ['email_gmail', 'email_outlook', 'email_smtp']) {
        const { data } = await supabase
          .from('channels')
          .select('id, unipile_account_id')
          .eq('business_id', convo.business_id)
          .eq('type', t)
          .eq('status', 'connected')
          .maybeSingle();
        if (data) { channel = data; break; }
      }
    } else {
      const { data } = await supabase
        .from('channels')
        .select('id, unipile_account_id')
        .eq('business_id', convo.business_id)
        .eq('type', 'whatsapp')
        .eq('status', 'connected')
        .maybeSingle();
      channel = data;
    }

    if (!channel?.unipile_account_id) {
      const label = isEmail ? 'email' : 'WhatsApp';
      return new Response(
        JSON.stringify({ error: `No connected ${label} channel. Connect one in Settings.` }),
        { status: 400 },
      );
    }

    // For email: find subject and last email_id for threading
    let emailSubject = subject || '';
    let replyToEmailId: string | null = null;

    if (isEmail) {
      const { data: lastMsg } = await supabase
        .from('messages')
        .select('metadata')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (lastMsg && lastMsg.length > 0) {
        for (const msg of lastMsg) {
          const meta = msg.metadata as Record<string, any>;
          if (!emailSubject && meta?.subject) {
            emailSubject = `Re: ${(meta.subject as string).replace(/^Re:\s*/i, '')}`;
          }
          if (!replyToEmailId && meta?.external_id) {
            replyToEmailId = meta.external_id as string;
          }
          if (emailSubject && replyToEmailId) break;
        }
      }

      if (!emailSubject) emailSubject = 'Re: Your message';
    }

    // Send via Unipile
    let uRes: Response;
    if (isEmail) {
      const hasFiles = attachmentBuffers.length > 0;

      if (hasFiles) {
        // Multipart form data for attachments
        const form = new FormData();
        form.append('account_id', channel.unipile_account_id);
        form.append('subject', emailSubject);
        form.append('body', body.replace(/\n/g, '<br>'));
        form.append('to', JSON.stringify([{ identifier: recipient, display_name: contact.name || recipient }]));
        if (replyToEmailId) {
          form.append('reply_to', replyToEmailId);
        }
        for (const att of attachmentBuffers) {
          form.append('attachments', new Blob([att.buffer], { type: att.type }), att.name);
        }
        uRes = await fetch(`https://${UNIPILE_DSN}/api/v1/emails`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_TOKEN,
            accept: 'application/json',
          },
          body: form,
        });
      } else {
        // JSON for text-only emails
        const emailPayload: Record<string, any> = {
          account_id: channel.unipile_account_id,
          to: [{ identifier: recipient, display_name: contact.name || recipient }],
          subject: emailSubject,
          body: body.replace(/\n/g, '<br>'),
        };
        if (replyToEmailId) {
          emailPayload.reply_to = replyToEmailId;
        }
        uRes = await fetch(`https://${UNIPILE_DSN}/api/v1/emails`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_TOKEN,
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(emailPayload),
        });
      }
    } else if (isGroup && convo.unipile_chat_id) {
      // Send to group via existing chat_id
      uRes = await fetch(`https://${UNIPILE_DSN}/api/v1/chats/${convo.unipile_chat_id}/messages`, {
        method: 'POST',
        headers: {
          'X-API-KEY': UNIPILE_TOKEN,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ text: body }),
      });
    } else {
      const hasFiles = attachmentBuffers.length > 0;

      if (hasFiles) {
        const form = new FormData();
        form.append('account_id', channel.unipile_account_id);
        form.append('attendees_ids', JSON.stringify([recipient]));
        form.append('text', body);
        for (const att of attachmentBuffers) {
          form.append('attachments', new Blob([att.buffer], { type: att.type }), att.name);
        }
        uRes = await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_TOKEN,
            accept: 'application/json',
          },
          body: form,
        });
      } else {
        uRes = await fetch(`https://${UNIPILE_DSN}/api/v1/chats`, {
          method: 'POST',
          headers: {
            'X-API-KEY': UNIPILE_TOKEN,
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            account_id: channel.unipile_account_id,
            attendees_ids: [recipient],
            text: body,
          }),
        });
      }
    }

    const uText = await uRes.text();
    let externalId: string | null = null;
    if (uRes.ok) {
      try {
        const uJson = JSON.parse(uText);
        externalId = uJson.email_id ?? uJson.message_id ?? uJson.chat_id ?? uJson.id ?? null;
      } catch {}
    } else {
      return new Response(
        JSON.stringify({ error: `Unipile send failed: ${uRes.status}`, detail: uText.slice(0, 500) }),
        { status: 502 },
      );
    }

    // Build attachment metadata for storage
    const attachmentMeta = attachmentBuffers.map((att, i) => ({
      id: `sent-${i}`,
      name: att.name.replace(/\.[^.]+$/, ''),
      extension: att.name.split('.').pop() || '',
      size: att.buffer.byteLength,
      mime_type: att.type,
    }));

    // Store outbound message
    const { data: msg } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        direction: 'outbound',
        sender: 'human',
        content_type: 'text',
        body,
        metadata: {
          external_id: externalId,
          via: isEmail ? 'unipile_email' : 'unipile',
          subject: isEmail ? emailSubject : undefined,
          to_attendees: isEmail ? [{ identifier: recipient, display_name: contact.name || recipient }] : undefined,
          has_attachments: attachmentMeta.length > 0 || undefined,
          attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
        },
      })
      .select('id')
      .single();

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
