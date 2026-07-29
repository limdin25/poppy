// Place a real test call from the Fish agent page, so tuning does not need a
// terminal or somebody else to press the button.
//
// The browser never sees the bridge secret. This route holds it and forwards to
// the calling bridge on the VPS, which is the only thing that can actually dial.
//
// Deliberately narrow: it dials ONE number, the one typed into the box, and it
// refuses anything that is not a plain E.164 number. This endpoint reaches a
// real phone network and spends real money, so it is not a general proxy to the
// bridge and must never become one.
//
// Node handler style (IncomingMessage/ServerResponse), matching api/fish/preview.ts.
// The Web-API style did not deploy in this project.

import type { IncomingMessage, ServerResponse } from 'http';

const BRIDGE = process.env.BRIDGE_URL || 'https://voice.heyelsie.com';
// E.164 and nothing else. No extensions, no letters, no comma-separated lists:
// a list here would turn a tuning page into an auto-dialer by accident.
const E164 = /^\+[1-9]\d{7,14}$/;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const secret = process.env.BRIDGE_SHARED_SECRET;
  if (!secret) {
    return json(res, 500, {
      error: 'BRIDGE_SHARED_SECRET is not set on the server, so the bridge will refuse the call.',
    });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return json(res, 400, { error: 'Bad JSON.' });
  }

  const to = String(body.to ?? '').replace(/\s+/g, '');
  if (!E164.test(to)) {
    return json(res, 400, {
      error: 'Give the number in full international form, for example +447863992555.',
    });
  }

  const payload: Record<string, unknown> = { to };
  const business = String(body.business ?? '').trim();
  if (business) payload.business = business.slice(0, 80);
  if (typeof body.reviews === 'number' && Number.isFinite(body.reviews)) {
    payload.reviews = body.reviews;
  }

  // The bridge reads the saved settings from Supabase itself at the start of
  // every call, so whatever is on screen applies to THIS call with no deploy
  // and no restart. Save before dialling, which is what the page does.
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${BRIDGE}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': secret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return json(res, 502, {
      error: `Could not reach the calling bridge at ${BRIDGE}: ${(e as Error).message}`,
    });
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return json(res, 502, { error: `Bridge returned ${upstream.status}: ${text.slice(0, 300)}` });
  }
  try {
    return json(res, 200, JSON.parse(text));
  } catch {
    return json(res, 200, { ok: true, raw: text.slice(0, 300) });
  }
}
