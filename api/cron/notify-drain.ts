// Funnel notification email drain — every minute (vercel.json).
//
// Hugo 2026-07-26 wants an email for every funnel action, instantly, linking
// straight to the lead. The rows are written synchronously by the beacon/page
// handlers; the SENDING happens here because:
//   - api/vsl/page.ts is a lead-facing sales page with no maxDuration override
//   - there is no waitUntil in this stack, so post-response work may never run
//   - sendEmail throws on a Resend 429, and Resend rate-limits around 2/s
// Every minute keeps it near-instant without ever risking the page.
//
// Deliberately NOT gated on settings.enabled or quiet hours, unlike
// vsl-automation: those govern texting a LEAD. This is Hugo's own inbox, and a
// dark funnel still needs its test traffic reported.
//
// Node (req,res) runtime on purpose — the edge Request shape throws at runtime
// here (caught in production on daily-agent-reports, 2026-07-24).

import type { IncomingMessage, ServerResponse } from 'http';
import { drainNotificationEmails } from '../lib/vsl-notify.js';

export const config = { maxDuration: 60 };

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    const out = await drainNotificationEmails();
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    console.error('[notify-drain] failed:', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
