// /offers, the offer emails Pedro sends to the branches.
//
// Behind the same code Pedro already uses for /pedro-training and /report
// (1176), because the page carries our offer figures and /offers is a guessable
// path. Same shape as api/report.ts: baked HTML, Node runtime, noindex.

import type { IncomingMessage, ServerResponse } from 'http';
import { OFFERS_HTML } from './lib/offers-html.js';

const PASSWORD = '1176';
const COOKIE = 'elsie_offers_auth';
// Not a session token, just an opaque value so the raw code never sits in the cookie.
const COOKIE_OK = 'o-4b2a1176-ok';

const LOGIN_PAGE = (wrong: boolean) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Offers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;900&display=swap">
<style>
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    background:#F8FAFD;color:#1A1A1A;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
  form{background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:32px 24px;width:100%;max-width:320px;
    text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.06)}
  h1{font-size:19px;font-weight:900;letter-spacing:-.02em;margin:0 0 4px}
  p{font-size:13px;color:#6B7280;margin:0 0 18px}
  input{width:100%;padding:12px;border:1px solid #D1D5DB;border-radius:10px;font-size:17px;text-align:center;letter-spacing:6px;font-family:inherit}
  button{margin-top:12px;width:100%;padding:13px;border:0;border-radius:14px;background:#1a73e8;color:#fff;
    font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;box-shadow:0 6px 18px rgba(26,115,232,.30)}
  button:hover{background:#1557b0}
  .err{color:#DC2626;font-size:12.5px;margin-top:10px}
</style></head><body>
<form method="POST" action="/offers">
  <h1>Offers ready to send</h1><p>Enter the access code</p>
  <input name="pw" type="password" inputmode="numeric" autofocus autocomplete="off" aria-label="Access code">
  <button>Open</button>
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
      res.setHeader('Set-Cookie', `${COOKIE}=${COOKIE_OK}; Path=/offers; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
      res.statusCode = 303;
      res.setHeader('Location', '/offers');
      res.end();
      return;
    }
    res.statusCode = 401;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.end(LOGIN_PAGE(true));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD, POST');
    res.end('Method not allowed');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(authed ? OFFERS_HTML : LOGIN_PAGE(false));
}
