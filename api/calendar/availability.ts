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
  const headerSecret = req.headers.get('x-tool-secret') || req.headers.get('x_tool_secret');
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
  const rawBody = await req.json() as Record<string, unknown>;
  const body = (rawBody.args ?? rawBody) as {
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
    .select('google_calendar_tokens, google_calendar_id, timezone, working_hours_start, working_hours_end, working_days')
    .eq('id', businessId)
    .single();

  if (bizError) {
    return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
  }

  let busy: { start: string; end: string }[] = [];

  if (biz?.google_calendar_tokens) {
    let tokens = biz.google_calendar_tokens as GoogleTokens;
    const calendarId = biz.google_calendar_id || 'primary';

    if (Date.now() >= tokens.expiry_date - 60_000) {
      tokens = await refreshAccessToken(tokens);
      await supabase
        .from('businesses')
        .update({ google_calendar_tokens: tokens })
        .eq('id', businessId);
    }

    busy = await getFreeBusy(tokens, calendarId, body.date_from, body.date_to);
  }

  let workStart = biz?.working_hours_start ?? 9;
  let workEnd = biz?.working_hours_end ?? 17;
  let workDays = biz?.working_days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  let agentId = url.searchParams.get('aid');
  if (!agentId) {
    const { data: defaultAgent } = await supabase
      .from('agents')
      .select('id')
      .eq('business_id', businessId)
      .limit(1)
      .maybeSingle();
    if (defaultAgent) agentId = defaultAgent.id;
  }
  if (agentId) {
    const { data: agent } = await supabase
      .from('agents')
      .select('working_hours_start, working_hours_end, working_days')
      .eq('id', agentId)
      .eq('business_id', businessId)
      .single();
    if (agent?.working_hours_start != null) workStart = agent.working_hours_start;
    if (agent?.working_hours_end != null) workEnd = agent.working_hours_end;
    if (agent?.working_days?.length) workDays = agent.working_days;
  }

  const slots = generateAvailableSlots(body.date_from, body.date_to, busy, biz?.timezone || 'Europe/London', workStart, workEnd, workDays);

  return new Response(JSON.stringify({ slots, busy }), { status: 200 });
}

function toLocalDateParts(date: Date, tz: string): { year: number; month: number; day: number; dayName: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return {
    year: parseInt(get('year')),
    month: parseInt(get('month')),
    day: parseInt(get('day')),
    dayName: get('weekday'),
  };
}

function localHourToUTC(year: number, month: number, day: number, hour: number, tz: string): Date {
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const target = new Date(dateStr + 'Z');
  const formatted = formatter.formatToParts(target);
  const get = (t: string) => parseInt(formatted.find(p => p.type === t)?.value ?? '0');
  const localHour = get('hour');
  const offset = localHour - hour;
  return new Date(target.getTime() - offset * 3600_000);
}

function generateAvailableSlots(
  dateFrom: string,
  dateTo: string,
  busy: { start: string; end: string }[],
  timezone: string,
  workStart = 9,
  workEnd = 17,
  workDays: string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  const startDate = new Date(dateFrom);
  const endDate = new Date(dateTo);
  endDate.setDate(endDate.getDate() + 1);
  const now = new Date();

  for (let d = new Date(startDate); d < endDate; d.setDate(d.getDate() + 1)) {
    const local = toLocalDateParts(d, timezone);
    if (!workDays.includes(local.dayName)) continue;

    for (let hour = workStart; hour < workEnd; hour++) {
      const slotStart = localHourToUTC(local.year, local.month, local.day, hour, timezone);
      const slotEnd = new Date(slotStart.getTime() + 3600_000);

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
