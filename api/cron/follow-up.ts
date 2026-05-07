import { createClient } from '@supabase/supabase-js';
import { sendSMS } from '../../src/integrations/twilio/client.js';
import { sendToChat, sendEmail as sendUnipileEmail } from '../../src/integrations/unipile/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { data: pending } = await supabase
    .from('follow_up_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(50);

  if (!pending?.length) {
    return new Response(JSON.stringify({ processed: 0, sent: 0 }), { status: 200 });
  }

  let sent = 0;
  let cancelled = 0;

  for (const item of pending) {
    const { data: appointment } = await supabase
      .from('appointments')
      .select('id')
      .eq('conversation_id', item.conversation_id)
      .neq('status', 'cancelled')
      .limit(1)
      .single();

    if (appointment) {
      await supabase
        .from('follow_up_queue')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', item.id);
      cancelled++;
      continue;
    }

    const { data: recentInbound } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', item.conversation_id)
      .eq('direction', 'inbound')
      .gt('created_at', item.created_at)
      .limit(1)
      .single();

    if (recentInbound) {
      await supabase
        .from('follow_up_queue')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', item.id);
      cancelled++;
      continue;
    }

    let didSend = false;
    let error: string | null = null;

    try {
      if (item.channel === 'whatsapp') {
        const accountId = await getWhatsAppAccountId(item.business_id);
        const { data: contact } = await supabase
          .from('contacts')
          .select('whatsapp')
          .eq('id', item.contact_id)
          .single();
        if (accountId && contact?.whatsapp) {
          await sendToChat(accountId, contact.whatsapp, item.message);
          didSend = true;
        }
      } else if (item.channel === 'sms') {
        const fromNumber = await getSmsFromNumber(item.business_id);
        const { data: contact } = await supabase
          .from('contacts')
          .select('phone')
          .eq('id', item.contact_id)
          .single();
        if (fromNumber && contact?.phone) {
          await sendSMS(fromNumber, contact.phone, item.message);
          didSend = true;
        }
      } else if (item.channel === 'email') {
        const emailAccount = await getEmailAccountId(item.business_id);
        const { data: contact } = await supabase
          .from('contacts')
          .select('email')
          .eq('id', item.contact_id)
          .single();
        if (emailAccount && contact?.email) {
          const { data: biz } = await supabase
            .from('businesses')
            .select('name')
            .eq('id', item.business_id)
            .single();
          await sendUnipileEmail(emailAccount, contact.email, `Following up from ${biz?.name || 'us'}`, item.message);
          didSend = true;
        }
      }
    } catch (err: any) {
      error = err.message || 'Send failed';
    }

    if (didSend) {
      await supabase
        .from('follow_up_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', item.id);

      await supabase.from('messages').insert({
        conversation_id: item.conversation_id,
        direction: 'outbound',
        sender: 'ai',
        content_type: 'text',
        body: item.message,
        metadata: { via: 'follow_up_cron', attempt: item.attempt_number, reason: item.reason },
      });

      await supabase
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: item.message.slice(0, 100),
        })
        .eq('id', item.conversation_id);

      sent++;
    } else if (error) {
      await supabase
        .from('follow_up_queue')
        .update({ status: 'failed', error })
        .eq('id', item.id);
    }
  }

  return new Response(JSON.stringify({ processed: pending.length, sent, cancelled }), { status: 200 });
}

async function getSmsFromNumber(businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('channels')
    .select('config')
    .eq('business_id', businessId)
    .eq('type', 'voice')
    .eq('status', 'connected')
    .limit(1)
    .single();
  return (data?.config as Record<string, string> | null)?.phone ?? null;
}

async function getWhatsAppAccountId(businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('channels')
    .select('unipile_account_id')
    .eq('business_id', businessId)
    .eq('type', 'whatsapp')
    .eq('status', 'connected')
    .limit(1)
    .single();
  return data?.unipile_account_id ?? null;
}

async function getEmailAccountId(businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('channels')
    .select('unipile_account_id')
    .eq('business_id', businessId)
    .in('type', ['email_gmail', 'email_outlook'])
    .eq('status', 'connected')
    .limit(1)
    .single();
  return data?.unipile_account_id ?? null;
}
