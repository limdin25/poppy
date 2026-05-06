import { createClient } from '@supabase/supabase-js';
import { sendSMS } from '../../src/integrations/twilio/client.js';
import { sendNotification } from '../../src/integrations/resend/client.js';
import { sendToChat } from '../../src/integrations/unipile/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type NotifyEvent = 'call' | 'message' | 'booking' | 'quote_accepted';

interface NotifyData {
  title: string;
  body: string;
}

export async function notifyBusinessOwner(
  businessId: string,
  event: NotifyEvent,
  data: NotifyData,
): Promise<{ sent: string[] }> {
  const { data: settings } = await supabase
    .from('notification_settings')
    .select('*')
    .eq('business_id', businessId)
    .single();

  if (!settings) return { sent: [] };

  const eventKey = `notify_on_${event}` as const;
  if (!(settings as Record<string, unknown>)[eventKey]) return { sent: [] };

  const sent: string[] = [];

  if (settings.email_enabled && settings.email_address) {
    try {
      await sendNotification(settings.email_address, data.title, data.body);
      sent.push('email');
    } catch { /* log but don't fail */ }
  }

  if (settings.sms_enabled && settings.sms_number) {
    try {
      const fromNumber = await getSmsFromNumber(businessId);
      if (fromNumber) {
        await sendSMS(fromNumber, settings.sms_number, `${data.title}\n\n${data.body}`);
        sent.push('sms');
      }
    } catch { /* log but don't fail */ }
  }

  if (settings.whatsapp_enabled && settings.whatsapp_number) {
    try {
      const accountId = await getWhatsAppAccountId(businessId);
      if (accountId) {
        await sendToChat(accountId, settings.whatsapp_number, `*${data.title}*\n\n${data.body}`);
        sent.push('whatsapp');
      }
    } catch { /* log but don't fail */ }
  }

  return { sent };
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
