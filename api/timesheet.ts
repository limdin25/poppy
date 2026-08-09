// /timesheet — Pedro Almedina's weekly timesheet and pay statement.
// Public on purpose (Hugo shares the link with the agent directly), but marked
// noindex so a person's pay never lands in a search engine. The HTML is
// generated offline and baked into api/lib/timesheet-html.ts. Node runtime to
// match api/report.ts: the page string is bigger than the edge bundle budget.

import type { IncomingMessage, ServerResponse } from 'http';
import { TIMESHEET_HTML } from './lib/timesheet-html.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method not allowed');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(TIMESHEET_HTML);
}
