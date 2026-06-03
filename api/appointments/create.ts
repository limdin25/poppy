import { createClient } from '@supabase/supabase-js';
import { createEvent, refreshAccessToken } from '../lib/google-calendar.js';
import type { GoogleTokens } from '../lib/google-calendar.js';
import { notifyBusinessOwner } from '../lib/notify.js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

interface Body {
  name?: string;
  phone?: string;
  service?: string;
  startsAt?: string;      // ISO datetime
  durationMins?: number;
  notes?: string;
  contactId?: string;
  conversationId?: string;
}

/**
 * Manual ("New booking") appointment creation. Works with NO calendar connected —
 * it always writes a row to `appointments`. If Google Calendar is connected, it
 * also creates the matching event (best-effort). Mirrors api/calendar/book.ts.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const name = (body.name || '').trim();
  const phone = (body.phone || '').trim();
  if (!body.startsAt) {
    return new Response(JSON.stringify({ error: 'A date and time is required.' }), { status: 400 });
  }
  const start = new Date(body.startsAt);
  if (Number.isNaN(start.getTime())) {
    return new Response(JSON.stringify({ error: 'That date/time could not be read.' }), { status: 400 });
  }
  const durationMins = Number.isFinite(body.durationMins) && (body.durationMins as number) > 0
    ? (body.durationMins as number)
    : 60;
  const end = new Date(start.getTime() + durationMins * 60_000);
  const service = (body.service || 'Appointment').trim();

  // ── find or create the contact (by phone within this business) ────────────
  let contactId = body.contactId || null;
  if (!contactId && phone) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();
    if (existing) {
      contactId = existing.id as string;
    } else {
      const { data: created } = await supabase
        .from('contacts')
        .insert({ business_id: businessId, name: name || phone, phone, whatsapp: phone })
        .select('id')
        .single();
      contactId = created?.id ?? null;
    }
  } else if (!contactId && name) {
    const { data: created } = await supabase
      .from('contacts')
      .insert({ business_id: businessId, name })
      .select('id')
      .single();
    contactId = created?.id ?? null;
  }

  // ── business info (timezone + optional calendar) ──────────────────────────
  const { data: biz } = await supabase
    .from('businesses')
    .select('google_calendar_tokens, google_calendar_id, name, timezone')
    .eq('id', businessId)
    .single();

  const title = `${service}${name ? ` - ${name}` : ''}`;
  const description = [
    service ? `Service: ${service}` : null,
    name ? `Customer: ${name}` : null,
    phone ? `Phone: ${phone}` : null,
    body.notes ? `Notes: ${body.notes}` : null,
    'Booked via: manual (dashboard)',
  ].filter(Boolean).join('\n');

  // ── optional Google Calendar sync ─────────────────────────────────────────
  let event: { id: string } | null = null;
  if (biz?.google_calendar_tokens) {
    try {
      let tokens = biz.google_calendar_tokens as GoogleTokens;
      const calendarId = biz.google_calendar_id || 'primary';
      if (Date.now() >= tokens.expiry_date - 60_000) {
        tokens = await refreshAccessToken(tokens);
        await supabase.from('businesses').update({ google_calendar_tokens: tokens }).eq('id', businessId);
      }
      event = await createEvent(tokens, calendarId, title, description, start.toISOString(), end.toISOString());
    } catch (err) {
      // Calendar sync is best-effort — the local appointment is still created.
      console.error('[appointments/create] GCal sync failed:', err);
    }
  }

  const { data: appointment, error: aptError } = await supabase
    .from('appointments')
    .insert({
      business_id: businessId,
      contact_id: contactId,
      conversation_id: body.conversationId || null,
      cal_booking_id: event?.id || null,
      title,
      description,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: 'confirmed',
      booked_via: 'manual',
    })
    .select('*')
    .single();

  if (aptError) {
    return new Response(JSON.stringify({ error: aptError.message }), { status: 500 });
  }

  // ── notify the owner (best-effort) ────────────────────────────────────────
  const tz = biz?.timezone || 'Europe/London';
  const dateStr = start.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
  const timeStr = start.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  try {
    await notifyBusinessOwner(businessId, 'booking', {
      title: `New Booking: ${service}`,
      body: [
        `${name || 'A customer'} booked ${service}`,
        `${dateStr} at ${timeStr}`,
        phone ? `Phone: ${phone}` : null,
        body.notes ? `Notes: ${body.notes}` : null,
      ].filter(Boolean).join('\n'),
    });
  } catch (err) {
    console.error('[appointments/create] owner notify failed:', err);
  }

  return new Response(
    JSON.stringify({ ok: true, appointment, calendarSynced: Boolean(event) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
