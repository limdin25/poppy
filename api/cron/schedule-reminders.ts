import { createClient } from '@supabase/supabase-js';

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

  const threeDaysFromNow = new Date(Date.now() + 3 * 86400_000).toISOString();

  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, business_id, contact_id, title, starts_at, booked_via, conversation_id')
    .in('status', ['confirmed', 'pending'])
    .gt('starts_at', new Date().toISOString())
    .lte('starts_at', threeDaysFromNow);

  if (!appointments?.length) {
    return new Response(JSON.stringify({ checked: 0, queued: 0 }), { status: 200 });
  }

  const appointmentIds = appointments.map(a => a.id);
  const { data: existing } = await supabase
    .from('appointment_notifications')
    .select('appointment_id, type, scheduled_at')
    .in('appointment_id', appointmentIds)
    .in('type', ['reminder', 'owner_reminder'])
    .neq('status', 'cancelled');

  const existingSet = new Set(
    (existing || []).map(e => `${e.appointment_id}:${e.type}:${e.scheduled_at}`)
  );

  let queued = 0;

  for (const appt of appointments) {
    const { data: agent } = await supabase
      .from('agents')
      .select('reminder_enabled, reminder_times_seconds, reminder_channels, owner_reminder_enabled, owner_reminder_times_seconds')
      .eq('business_id', appt.business_id)
      .limit(1)
      .maybeSingle();

    const { data: contact } = await supabase
      .from('contacts')
      .select('name, phone, email, whatsapp')
      .eq('id', appt.contact_id)
      .single();

    const { data: biz } = await supabase
      .from('businesses')
      .select('name, timezone')
      .eq('id', appt.business_id)
      .single();

    const tz = biz?.timezone || 'Europe/London';
    const startDate = new Date(appt.starts_at);
    const dateStr = startDate.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
    const timeStr = startDate.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

    if (agent?.reminder_enabled !== false && contact) {
      const times = agent?.reminder_times_seconds || [86400, 3600];
      const channels = agent?.reminder_channels || ['whatsapp', 'sms', 'email'];
      const channel = resolveChannel(channels, contact.whatsapp || contact.phone, contact.email);

      for (const secsBefore of times) {
        const scheduledAt = new Date(startDate.getTime() - secsBefore * 1000);
        if (scheduledAt.getTime() <= Date.now()) continue;

        const key = `${appt.id}:reminder:${scheduledAt.toISOString()}`;
        if (existingSet.has(key)) continue;

        const contactName = contact.name?.split(' ')[0] || 'there';
        const timeLabel = secsBefore >= 86400 ? `${Math.round(secsBefore / 86400)} day` : `${Math.round(secsBefore / 3600)} hour`;
        const message = `Hi ${contactName}, just a reminder — your appointment with ${biz?.name || 'us'} is in ${timeLabel}${secsBefore >= 86400 ? '(s)' : '(s)'}: ${dateStr} at ${timeStr}. See you then!`;

        await supabase.from('appointment_notifications').insert({
          appointment_id: appt.id,
          business_id: appt.business_id,
          contact_id: appt.contact_id,
          type: 'reminder',
          channel,
          recipient_phone: contact.whatsapp || contact.phone,
          recipient_email: contact.email,
          message,
          scheduled_at: scheduledAt.toISOString(),
          status: 'pending',
        });
        queued++;
      }
    }

    if (agent?.owner_reminder_enabled !== false) {
      const times = agent?.owner_reminder_times_seconds || [86400];
      const { data: settings } = await supabase
        .from('notification_settings')
        .select('email_address, sms_number, whatsapp_number, email_enabled, sms_enabled, whatsapp_enabled')
        .eq('business_id', appt.business_id)
        .single();

      if (settings) {
        const ownerChannel = settings.whatsapp_enabled && settings.whatsapp_number ? 'whatsapp'
          : settings.sms_enabled && settings.sms_number ? 'sms'
          : settings.email_enabled && settings.email_address ? 'email' : null;

        if (ownerChannel) {
          for (const secsBefore of times) {
            const scheduledAt = new Date(startDate.getTime() - secsBefore * 1000);
            if (scheduledAt.getTime() <= Date.now()) continue;

            const key = `${appt.id}:owner_reminder:${scheduledAt.toISOString()}`;
            if (existingSet.has(key)) continue;

            const contactName = contact?.name || 'a customer';
            const message = `Reminder: ${contactName} has ${appt.title} on ${dateStr} at ${timeStr}.`;

            await supabase.from('appointment_notifications').insert({
              appointment_id: appt.id,
              business_id: appt.business_id,
              type: 'owner_reminder',
              channel: ownerChannel,
              recipient_phone: settings.whatsapp_number || settings.sms_number,
              recipient_email: settings.email_address,
              message,
              scheduled_at: scheduledAt.toISOString(),
              status: 'pending',
            });
            queued++;
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ checked: appointments.length, queued }), { status: 200 });
}

function resolveChannel(
  priority: string[],
  phone: string | null | undefined,
  email: string | null | undefined,
): string {
  for (const ch of priority) {
    if (ch === 'whatsapp' && phone) return 'whatsapp';
    if (ch === 'sms' && phone) return 'sms';
    if (ch === 'email' && email) return 'email';
  }
  return phone ? 'sms' : 'email';
}
