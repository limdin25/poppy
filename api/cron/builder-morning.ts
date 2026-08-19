// 8am UK, every day: confirm today's viewings with the builders going to them.
//
// Hugo, 2026-08-20: "the morning of the visit you say hi good morning just
// wanna confirm we are still good for the viewing today. Thank you, like 8am."
//
// Only CONFIRMED builders, only viewings dated today in UK wall time, only
// once per builder per viewing (`morning_sent_at`). Runs on its own schedule
// rather than inside the 5-minute sweep, because "8am" is the whole point.
//
// Node (req,res) runtime, like every other cron here.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { sendMorningReminders } from '../lib/builder-outreach.js';

export const config = { maxDuration: 60 };

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    // Vercel schedules in UTC, and 8am UK is 07:00 UTC in summer but 08:00 in
    // winter, so the cron fires at BOTH and the UK clock decides which one is
    // really 8am. `?force=1` is for testing by hand.
    const url = new URL(req.url ?? '/', 'http://internal');
    const ukHour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour: 'numeric', hour12: false,
    }).format(new Date()));
    if (ukHour !== 8 && url.searchParams.get('force') !== '1') {
      res.statusCode = 200;
      res.end(JSON.stringify({ skipped: 'not 8am UK', ukHour }));
      return;
    }

    const out = await sendMorningReminders(sb);
    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e).slice(0, 300) }));
  }
}
