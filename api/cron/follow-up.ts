import { createClient } from '@supabase/supabase-js';
import { sendSMS } from '../../src/integrations/twilio/client.js';
import { sendToChat } from '../../src/integrations/unipile/client.js';

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

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: leads, error } = await supabase
    .from('conversations')
    .select(`
      id,
      business_id,
      contact_id,
      channel,
      contacts:contact_id ( name, phone, whatsapp )
    `)
    .not('qualified_at', 'is', null)
    .is('follow_up_sent_at', null)
    .lte('qualified_at', twoHoursAgo)
    .gte('qualified_at', twentyFourHoursAgo);

  if (error || !leads?.length) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  const appointmentCheck = await supabase
    .from('appointments')
    .select('conversation_id')
    .in('conversation_id', leads.map(l => l.id))
    .neq('status', 'cancelled');

  const bookedIds = new Set((appointmentCheck.data || []).map(a => a.conversation_id));

  let sent = 0;

  for (const lead of leads) {
    if (bookedIds.has(lead.id)) {
      await supabase.from('conversations').update({ follow_up_sent_at: new Date().toISOString() }).eq('id', lead.id);
      continue;
    }

    const contact = lead.contacts as unknown as { name: string | null; phone: string | null; whatsapp: string | null } | null;
    if (!contact) continue;

    const { data: biz } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', lead.business_id)
      .single();

    const bizName = biz?.name || 'us';
    const firstName = contact.name?.split(' ')[0] || 'there';
    const message = `Hi ${firstName}! Just following up from ${bizName}. We noticed you were looking at booking an appointment — would you still like to go ahead? Just reply here and we can get you sorted. 😊`;

    let didSend = false;

    if (lead.channel === 'whatsapp' && contact.whatsapp) {
      try {
        const accountId = await getWhatsAppAccountId(lead.business_id);
        if (accountId) {
          await sendToChat(accountId, contact.whatsapp, message);
          didSend = true;
        }
      } catch { /* log but don't fail */ }
    }

    if (!didSend && contact.phone) {
      try {
        const fromNumber = await getSmsFromNumber(lead.business_id);
        if (fromNumber) {
          await sendSMS(fromNumber, contact.phone, message);
          didSend = true;
        }
      } catch { /* log but don't fail */ }
    }

    if (didSend) {
      await supabase.from('messages').insert({
        conversation_id: lead.id,
        direction: 'outbound',
        sender: 'ai',
        content_type: 'text',
        body: message,
        metadata: { via: 'follow_up_cron' },
      });

      await supabase
        .from('conversations')
        .update({
          follow_up_sent_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          last_message_preview: message.slice(0, 100),
        })
        .eq('id', lead.id);

      sent++;
    }
  }

  return new Response(JSON.stringify({ processed: leads.length, sent }), { status: 200 });
}

async function getSmsFromNumber(businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('channels')
    .select('config')
    .eq('business_id', businessId)
    .eq('type', 'voice')
    .eq('status', 'connected')
    .single();

  return (data?.config as Record<string, string> | null)?.phone ?? null;
}

async function getWhatsAppAccountId(businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('channels')
    .select('config')
    .eq('business_id', businessId)
    .eq('type', 'whatsapp')
    .eq('status', 'connected')
    .single();

  return (data?.config as Record<string, string> | null)?.account_id ?? null;
}
