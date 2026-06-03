import { createClient } from '@supabase/supabase-js';
import { sendSMS } from '../../src/integrations/twilio/client.js';
import { sendNotification } from '../../src/integrations/resend/client.js';
import { sendToChat } from '../../src/integrations/unipile/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type NotifyEvent = 'call' | 'message' | 'booking' | 'quote_accepted' | 'lead';

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

  const sent: string[] = [];

  // Legacy single-destination settings (only when present and opted-in for this event).
  const eventKey = `notify_on_${event}` as const;
  const eventOptedIn = settings && (settings as Record<string, unknown>)[eventKey];
  if (settings && eventOptedIn) {
    if (settings.email_enabled && settings.email_address) {
      try {
        await sendNotification(settings.email_address, data.title, data.body);
        sent.push('email');
      } catch (err) { console.error('[notify] email failed:', err); }
    }

    if (settings.sms_enabled && settings.sms_number) {
      try {
        const fromNumber = await getSmsFromNumber(businessId);
        if (fromNumber) {
          await sendSMS(fromNumber, settings.sms_number, `${data.title}\n\n${data.body}`);
          sent.push('sms');
        }
      } catch (err) { console.error('[notify] sms failed:', err); }
    }

    if (settings.whatsapp_enabled && settings.whatsapp_number) {
      try {
        const accountId = await getWhatsAppAccountId(businessId);
        if (accountId) {
          await sendToChat(accountId, settings.whatsapp_number, `*${data.title}*\n\n${data.body}`);
          sent.push('whatsapp');
        }
      } catch (err) { console.error('[notify] whatsapp failed:', err); }
    }
  }

  // Multi-destination owner alerts (Settings → Notifications) — always sent.
  await fanOutToDestinations(businessId, data, sent);

  return { sent };
}

/**
 * Fan out an owner alert to every enabled row in notification_destinations
 * (email + WhatsApp), deduping against anything the legacy settings already
 * sent to. This is what the Settings → Notifications UI manages.
 */
async function fanOutToDestinations(
  businessId: string,
  data: NotifyData,
  sent: string[],
): Promise<void> {
  const { data: dests } = await supabase
    .from('notification_destinations')
    .select('type, destination, enabled')
    .eq('business_id', businessId)
    .eq('enabled', true);
  if (!dests?.length) return;

  const seen = new Set<string>();
  let waAccount: string | null | undefined;

  for (const d of dests) {
    const value = (d.destination || '').trim();
    if (!value) continue;
    const key = `${d.type}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      if (d.type === 'email') {
        await sendNotification(value, data.title, data.body);
        sent.push(`email:${value}`);
      } else if (d.type === 'whatsapp') {
        if (waAccount === undefined) waAccount = await getWhatsAppAccountId(businessId);
        if (waAccount) {
          await sendToChat(waAccount, value, `*${data.title}*\n\n${data.body}`);
          sent.push(`whatsapp:${value}`);
        }
      }
    } catch (err) {
      console.error(`[notify] destination ${d.type} failed:`, err);
    }
  }
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
    .select('unipile_account_id')
    .eq('business_id', businessId)
    .eq('type', 'whatsapp')
    .eq('status', 'connected')
    .single();

  return data?.unipile_account_id ?? null;
}
