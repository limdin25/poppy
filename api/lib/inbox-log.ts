import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface LogOutboundParams {
  businessId: string;
  channel: 'email' | 'sms' | 'whatsapp';
  toEmail?: string | null;
  toPhone?: string | null;
  body: string;
  subject?: string | null;
  externalId?: string | null;
  /** Transport used, stored in message.metadata.via (e.g. 'resend', 'twilio_sms', 'unipile'). */
  via: string;
}

/**
 * Record an outbound message that Elsie sent (mid-call tool, etc.) into the
 * inbox: find-or-create the contact, find-or-create an open conversation on the
 * right channel, insert the message, and bump the conversation. Realtime is
 * enabled on conversations + messages, so the inbox updates live. Best-effort —
 * callers should not fail their send if logging throws.
 */
export async function logOutboundMessage(
  p: LogOutboundParams,
): Promise<{ conversationId: string | null; messageId: string | null }> {
  const email = p.toEmail?.trim() || null;
  const phone = p.toPhone?.trim() || null;

  // 1. Find or create the contact.
  let contactId: string | null = null;
  if (email) {
    const { data } = await supabase
      .from('contacts').select('id')
      .eq('business_id', p.businessId).eq('email', email).maybeSingle();
    contactId = data?.id ?? null;
  } else if (phone) {
    const byPhone = await supabase
      .from('contacts').select('id')
      .eq('business_id', p.businessId).eq('phone', phone).maybeSingle();
    contactId = byPhone.data?.id ?? null;
    if (!contactId) {
      const byWa = await supabase
        .from('contacts').select('id')
        .eq('business_id', p.businessId).eq('whatsapp', phone).maybeSingle();
      contactId = byWa.data?.id ?? null;
    }
  }
  if (!contactId) {
    const { data } = await supabase
      .from('contacts')
      .insert({
        business_id: p.businessId,
        email,
        phone,
        whatsapp: p.channel === 'whatsapp' ? phone : null,
        name: email || phone,
      })
      .select('id')
      .single();
    contactId = data?.id ?? null;
  }
  if (!contactId) return { conversationId: null, messageId: null };

  // 2. Find the most recent open conversation on this channel, else create one.
  let conversationId: string | null = null;
  const { data: convo } = await supabase
    .from('conversations').select('id')
    .eq('business_id', p.businessId)
    .eq('contact_id', contactId)
    .eq('channel', p.channel)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  conversationId = convo?.id ?? null;

  if (!conversationId) {
    const { data: newConvo } = await supabase
      .from('conversations')
      .insert({
        business_id: p.businessId,
        contact_id: contactId,
        channel: p.channel,
        status: 'open',
        ai_handling: false,
        subject: p.channel === 'email' && p.subject ? p.subject : null,
        last_message_at: new Date().toISOString(),
        last_message_preview: p.body.slice(0, 100),
      })
      .select('id')
      .single();
    conversationId = newConvo?.id ?? null;
  }
  if (!conversationId) return { conversationId: null, messageId: null };

  // 3. Insert the outbound message (sent by Elsie).
  const { data: msg } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      sender: 'ai',
      content_type: 'text',
      body: p.body,
      metadata: {
        external_id: p.externalId ?? null,
        via: p.via,
        subject: p.channel === 'email' ? (p.subject ?? undefined) : undefined,
      },
    })
    .select('id')
    .single();

  // 4. Bump the conversation so it sorts to the top of the inbox.
  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: p.body.slice(0, 100),
    })
    .eq('id', conversationId);

  return { conversationId, messageId: msg?.id ?? null };
}
