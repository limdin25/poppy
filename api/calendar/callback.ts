import { createClient } from '@supabase/supabase-js';
import { exchangeCode, listCalendars } from '../lib/google-calendar.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const businessId = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
    return Response.redirect(`${appUrl}/settings?tab=integrations&calendar=error`, 302);
  }

  if (!code || !businessId) {
    return new Response(JSON.stringify({ error: 'Missing code or state' }), { status: 400 });
  }

  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
  const redirectUri = `${appUrl}/api/calendar/callback`;

  const tokens = await exchangeCode(code, redirectUri);

  const calendars = await listCalendars(tokens);
  const primary = calendars.find(c => c.primary);
  const calendarId = primary?.id ?? calendars[0]?.id ?? 'primary';

  const { error: dbError } = await supabase
    .from('businesses')
    .update({
      google_calendar_tokens: tokens,
      google_calendar_id: calendarId,
    })
    .eq('id', businessId);

  if (dbError) {
    return Response.redirect(`${appUrl}/settings?tab=integrations&calendar=error`, 302);
  }

  return Response.redirect(`${appUrl}/settings?tab=integrations&calendar=connected`, 302);
}
