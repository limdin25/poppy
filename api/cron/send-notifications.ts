import { createClient } from '@supabase/supabase-js';
import { sendSMS } from '../../src/integrations/twilio/client.js';
import { sendNotification } from '../../src/integrations/resend/client.js';
import { sendToChat } from '../../src/integrations/unipile/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const toolSecret = process.env.TOOL_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const headerTool = req.headers.get('x-tool-secret') || '';
  const isAuthed = (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (toolSecret && headerTool === toolSecret);
  if (!isAuthed) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { data: pending } = await supabase
    .from('appointment_notifications')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(50);

  if (!pending?.length) {
    return new Response(JSON.stringify({ processed: 0, sent: 0 }), { status: 200 });
  }

  let sent = 0;
  let failed = 0;

  for (const item of pending) {
    const { data: appt } = await supabase
      .from('appointments')
      .select('status')
      .eq('id', item.appointment_id)
      .single();

    if (!appt || appt.status === 'cancelled') {
      await supabase
        .from('appointment_notifications')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', item.id);
      continue;
    }

    let didSend = false;
    let error: string | null = null;

    try {
      if (item.channel === 'whatsapp' && item.recipient_phone) {
        const accountId = await getWhatsAppAccountId(item.business_id);
        if (accountId) {
          await sendToChat(accountId, item.recipient_phone, item.message);
          didSend = true;
        } else {
          error = 'No WhatsApp account connected';
        }
      } else if (item.channel === 'sms' && item.recipient_phone) {
        const fromNumber = await getSmsFromNumber(item.business_id);
        if (fromNumber) {
          await sendSMS(fromNumber, item.recipient_phone, item.message);
          didSend = true;
        } else {
          error = 'No SMS number configured';
        }
      } else if (item.channel === 'email' && item.recipient_email) {
        const subject = item.type.includes('reminder') ? 'Appointment Reminder' : 'Booking Confirmed';
        await sendNotification(item.recipient_email, subject, item.message);
        didSend = true;
      } else {
        error = `Missing recipient for channel ${item.channel}`;
      }
    } catch (err: any) {
      error = err.message || 'Send failed';
    }

    if (didSend) {
      await supabase
        .from('appointment_notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', item.id);
      sent++;
    } else {
      await supabase
        .from('appointment_notifications')
        .update({ status: 'failed', error })
        .eq('id', item.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ processed: pending.length, sent, failed }), { status: 200 });
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
