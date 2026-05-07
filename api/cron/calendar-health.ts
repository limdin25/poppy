import { createClient } from '@supabase/supabase-js';
import { refreshAccessToken } from '../lib/google-calendar.js';
import type { GoogleTokens } from '../lib/google-calendar.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  try {
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id, name, owner_id, google_calendar_tokens, google_calendar_id')
      .not('google_calendar_tokens', 'is', null);

    if (!businesses || businesses.length === 0) {
      return new Response(JSON.stringify({ ok: true, checked: 0 }), { status: 200 });
    }

    let healthy = 0;
    let unhealthy = 0;
    const alerts: string[] = [];

    for (const biz of businesses) {
      const tokens = biz.google_calendar_tokens as GoogleTokens | null;
      if (!tokens?.refresh_token) {
        unhealthy++;
        alerts.push(biz.name || biz.id);
        continue;
      }

      const expiresIn = tokens.expiry_date - Date.now();
      if (expiresIn > 30 * 60 * 1000) {
        healthy++;
        continue;
      }

      try {
        const refreshed = await refreshAccessToken(tokens);
        await supabase.from('businesses').update({
          google_calendar_tokens: refreshed,
        }).eq('id', biz.id);
        healthy++;
      } catch (err: any) {
        console.error(`[calendar-health] refresh failed for ${biz.id}:`, err.message);
        unhealthy++;
        alerts.push(biz.name || biz.id);

        await notifyOwner(biz);
      }
    }

    return new Response(JSON.stringify({ ok: true, healthy, unhealthy, alerts }), { status: 200 });
  } catch (err: any) {
    console.error('[calendar-health] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

async function notifyOwner(business: { id: string; name: string | null; owner_id: string }) {
  if (!RESEND_API_KEY) return;

  const { data: profile } = await supabase.auth.admin.getUserById(business.owner_id);
  const email = profile?.user?.email;
  if (!email) return;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Elsie <notifications@heyelsie.com>',
        to: [email],
        subject: `Action needed: Reconnect your Google Calendar`,
        html: `
          <p>Hi,</p>
          <p>Elsie can't access the Google Calendar for <strong>${business.name || 'your business'}</strong>. This means Elsie won't be able to book appointments until you reconnect.</p>
          <p><a href="https://app.heyelsie.com/account/integrations" style="background:#6366f1;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Reconnect Calendar</a></p>
          <p>This only takes a moment — just sign in with your Google account again.</p>
          <p>— Elsie</p>
        `,
      }),
    });
  } catch (err: any) {
    console.error(`[calendar-health] failed to email ${email}:`, err.message);
  }
}
