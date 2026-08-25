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


// ─────────────────────────────────────────────────────────────────────────────
// RETIRED 2026-08-25. DO NOT RE-ARM WITHOUT HUGO SAYING SO IN HIS OWN WORDS.
//
// Hugo, with 133 "No builder for Wednesday 26 August at 2:30pm" emails on one
// screen of his inbox, 73 of them about a single viewing:
//
//   "Stop all this email notification and whatsapp for the builder, no more
//    whatsapp automation for builders."
//
// The escalation pass had no memory: it re-asked on every run, every two
// minutes, for every viewing with no confirmed builder, so one unanswered
// viewing produced dozens of identical emails and WhatsApps a day.
//
// WHAT IS OFF: the three builder crons. No automatic invites, no automatic
// chasing, no automatic replies to builders, no escalation emails, no morning
// summary. All three schedules are gone from vercel.json and all three
// handlers refuse here as well, because an unscheduled cron is still one curl
// away and this must not come back by accident.
//
// WHAT STILL WORKS, untouched: the Find Builders desk at
// /admin/crm/find-builders, where a human picks a builder and presses send.
// Hugo asked to stop the AUTOMATION, not the ability to message a builder.
//
// Pinned by tests/builder-automation-off.test.ts, which fails if any of these
// paths is registered in vercel.json again.
// ─────────────────────────────────────────────────────────────────────────────

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { sendMorningReminders } from '../lib/builder-outreach.js';

export const config = { maxDuration: 60 };

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // See the RETIRED note at the top of this file. Answering 410 rather than
  // running, so a leftover schedule or a hand-run curl cannot restart the
  // emails Hugo asked to stop.
  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    error: 'Builder automation was retired on 2026-08-25. Use the Find Builders desk.',
  }));
  return;

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
