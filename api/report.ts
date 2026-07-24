// /report — Hugo's cold-call operation audit (22–24 Jul 2026 snapshot).
// Password-gated static report; the HTML is generated offline and baked into
// api/lib/report-html.ts. Node runtime on purpose: the report string is far
// bigger than the edge bundle budget.

import type { IncomingMessage, ServerResponse } from 'http';
import { REPORT_HTML } from './lib/report-html.js';

const PASSWORD = '1176';
const COOKIE = 'elsie_report_auth';
// Not a session token — just an opaque value so the raw password never sits in the cookie.
const COOKIE_OK = 'r-7c1d1176-ok';

const LOGIN_PAGE = (wrong: boolean) => `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Report — HeyElsie</title>
<style>
  body{margin:0;font-family:Inter,-apple-system,sans-serif;background:#F7F5EF;display:flex;align-items:center;justify-content:center;min-height:100vh}
  form{background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:36px;width:300px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.06)}
  h1{font-size:17px;margin:0 0 4px;color:#1A1A1A}p{font-size:13px;color:#6B7280;margin:0 0 18px}
  input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #D1D5DB;border-radius:10px;font-size:15px;text-align:center;letter-spacing:4px}
  button{margin-top:12px;width:100%;padding:11px;border:0;border-radius:10px;background:#1A1A1A;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  .err{color:#DC2626;font-size:12px;margin-top:10px}
</style></head><body>
<form method="POST" action="/report">
  <h1>Sales Operation Audit</h1><p>Enter the access code</p>
  <input name="pw" type="password" inputmode="numeric" autofocus autocomplete="off">
  <button>Open report</button>
  ${wrong ? '<div class="err">Wrong code.</div>' : ''}
</form></body></html>`;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const cookies = req.headers.cookie || '';
  const authed = cookies.includes(`${COOKIE}=${COOKIE_OK}`);

  if (req.method === 'POST') {
    const body = await readBody(req);
    const pw = decodeURIComponent((body.match(/pw=([^&]*)/) || [])[1] || '');
    if (pw === PASSWORD) {
      res.setHeader('Set-Cookie', `${COOKIE}=${COOKIE_OK}; Path=/report; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
      res.statusCode = 303;
      res.setHeader('Location', '/report');
      res.end();
      return;
    }
    res.statusCode = 401;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(LOGIN_PAGE(true));
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(authed ? REPORT_HTML : LOGIN_PAGE(false));
}
