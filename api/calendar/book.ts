import { createClient } from '@supabase/supabase-js';
import { createEvent, refreshAccessToken } from '../lib/google-calendar.js';
import type { GoogleTokens } from '../lib/google-calendar.js';
import { notifyBusinessOwner } from '../lib/notify.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const toolSecret = process.env.TOOL_SECRET;
  const headerSecret = req.headers.get('x-tool-secret');
  const hasBearer = req.headers.get('authorization')?.startsWith('Bearer ');
  const validToolSecret = toolSecret && headerSecret === toolSecret;
  if (!hasBearer && !validToolSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  let authedBusinessId: string | null = null;
  if (hasBearer && !validToolSecret) {
    const jwt = req.headers.get('authorization')!.slice(7);
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const { data: member } = await supabase.from('team_members').select('business_id').eq('user_id', user.id).limit(1).single();
    if (!member) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    authedBusinessId = member.business_id;
  }

  const reqUrl = new URL(req.url);
  const body = await req.json() as {
    business_id?: string;
    contact_id?: string;
    conversation_id?: string;
    service_name: string;
    start_time: string;
    end_time?: string;
    caller_name: string;
    caller_phone?: string;
    caller_email?: string;
    postcode?: string;
    issue_details?: string;
    channel?: 'voice' | 'whatsapp' | 'sms' | 'email' | 'web' | 'manual';
  };

  const businessId = authedBusinessId || reqUrl.searchParams.get('bid') || body.business_id;
  if (!businessId || !body.service_name || !body.start_time || !body.caller_name) {
    return new Response(JSON.stringify({ error: 'business_id, service_name, start_time, caller_name required' }), { status: 400 });
  }
  if (authedBusinessId && businessId !== authedBusinessId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const { data: biz, error: bizError } = await supabase
    .from('businesses')
    .select('google_calendar_tokens, google_calendar_id, name')
    .eq('id', businessId)
    .single();

  if (bizError || !biz?.google_calendar_tokens) {
    return new Response(JSON.stringify({ error: 'Calendar not connected' }), { status: 400 });
  }

  let tokens = biz.google_calendar_tokens as GoogleTokens;
  const calendarId = biz.google_calendar_id || 'primary';

  if (Date.now() >= tokens.expiry_date - 60_000) {
    tokens = await refreshAccessToken(tokens);
    await supabase
      .from('businesses')
      .update({ google_calendar_tokens: tokens })
      .eq('id', businessId);
  }

  const startTime = body.start_time;
  const endTime = body.end_time || new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();

  const description = [
    `Customer: ${body.caller_name}`,
    body.caller_phone ? `Phone: ${body.caller_phone}` : null,
    body.caller_email ? `Email: ${body.caller_email}` : null,
    body.postcode ? `Postcode: ${body.postcode}` : null,
    body.issue_details ? `Details: ${body.issue_details}` : null,
    `Booked via: ${body.channel || 'voice'}`,
    `Booked by: Elsie AI`,
  ].filter(Boolean).join('\n');

  const event = await createEvent(
    tokens,
    calendarId,
    `${body.service_name} - ${body.caller_name}`,
    description,
    startTime,
    endTime,
  );

  const { data: appointment, error: aptError } = await supabase
    .from('appointments')
    .insert({
      business_id: businessId,
      contact_id: body.contact_id || null,
      conversation_id: body.conversation_id || null,
      cal_booking_id: event.id,
      title: `${body.service_name} - ${body.caller_name}`,
      description,
      starts_at: startTime,
      ends_at: endTime,
      status: 'confirmed',
      booked_via: body.channel || 'voice',
    })
    .select('*')
    .single();

  if (aptError) {
    return new Response(JSON.stringify({ error: aptError.message }), { status: 500 });
  }

  const startDate = new Date(startTime);
  const dateStr = startDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = startDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  if (body.conversation_id) {
    await supabase
      .from('follow_up_queue')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('conversation_id', body.conversation_id)
      .eq('status', 'pending');
  }

  notifyBusinessOwner(businessId, 'booking', {
    title: `New Booking: ${body.service_name}`,
    body: [
      `${body.caller_name} booked ${body.service_name}`,
      `${dateStr} at ${timeStr}`,
      body.caller_phone ? `Phone: ${body.caller_phone}` : null,
      body.postcode ? `Postcode: ${body.postcode}` : null,
      body.issue_details ? `Details: ${body.issue_details}` : null,
    ].filter(Boolean).join('\n'),
  });

  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
  fetch(`${appUrl}/api/billing/record-booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      business_id: businessId,
      appointment_id: appointment.id,
      contact_id: body.contact_id || null,
      contact_name: body.caller_name,
      service_description: body.service_name,
      appointment_datetime: startTime,
      channel: body.channel || 'voice',
    }),
  }).catch((err) => console.error('[book] record-booking failed:', err));

  return new Response(JSON.stringify({ appointment, event }), { status: 201 });
}
