import { createClient } from '@supabase/supabase-js';
import { getFreeBusy, refreshAccessToken } from '../lib/google-calendar.js';
import type { GoogleTokens } from '../lib/google-calendar.js';

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

  const url = new URL(req.url);
  const body = await req.json() as {
    business_id?: string;
    date_from: string;
    date_to: string;
  };

  const businessId = authedBusinessId || url.searchParams.get('bid') || body.business_id;
  if (!businessId || !body.date_from || !body.date_to) {
    return new Response(JSON.stringify({ error: 'business_id, date_from, date_to required' }), { status: 400 });
  }
  if (authedBusinessId && businessId !== authedBusinessId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const { data: biz, error: bizError } = await supabase
    .from('businesses')
    .select('google_calendar_tokens, google_calendar_id, timezone')
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

  const busy = await getFreeBusy(tokens, calendarId, body.date_from, body.date_to);

  const slots = generateAvailableSlots(body.date_from, body.date_to, busy, biz.timezone || 'Europe/London');

  return new Response(JSON.stringify({ slots, busy }), { status: 200 });
}

function generateAvailableSlots(
  dateFrom: string,
  dateTo: string,
  busy: { start: string; end: string }[],
  timezone: string,
): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  const startDate = new Date(dateFrom);
  const endDate = new Date(dateTo);
  const now = new Date();

  for (let d = new Date(startDate); d < endDate; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    for (let hour = 9; hour < 17; hour++) {
      const slotStart = new Date(d);
      slotStart.setHours(hour, 0, 0, 0);
      const slotEnd = new Date(d);
      slotEnd.setHours(hour + 1, 0, 0, 0);

      if (slotStart < now) continue;

      const isBusy = busy.some(b => {
        const bStart = new Date(b.start);
        const bEnd = new Date(b.end);
        return slotStart < bEnd && slotEnd > bStart;
      });

      if (!isBusy) {
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        });
      }
    }
  }

  return slots;
}
