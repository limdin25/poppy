// The ballpark, fetched on one button after call one.
//
// Hugo, 2026-08-15: "after the first call I should go and analyze myself and
// then have a button to fetch the ballpark ... the system hears the call, sees
// what the agent said, and then the spreadsheet mathematics from the course
// ... and then we have the solid ballpark for a callback."
//
// SINCE 2026-08-16 THE WORK LIVES IN api/lib/ballpark.ts so the deal sweep
// can run the same homework itself (Hugo: "why didn't you fetch the ballpark
// already?"). This route is the interactive door: same auth as the cockpit,
// same preview/apply contract as before, plus `dueAt` so an apply can book
// Pedro's callback in the same press.
//
// NODE, NOT EDGE. Three model reads of a 12 minute transcript plus an engine
// round trip blew the edge runtime's ~25s ceiling twice in one evening, both
// times as a bare 504 in Hugo's hands. The repo trap (13 Aug): a web-style
// handler without the edge config is silently ignored and HANGS, so the
// default export is a Node (req, res) adapter around the web handler.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { runBallparkPreview, applyBallpark } from '../lib/ballpark.js';

export const config = { maxDuration: 60 };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function handleWeb(req: Request): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });

  // Same door as the Deal Manager: a signed-in CRM agent or admin.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = createClient(
    process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  let body: { propertyId?: string; apply?: boolean; dueAt?: string };
  try { body = await req.json() as { propertyId?: string; apply?: boolean; dueAt?: string }; }
  catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  if (!body.propertyId) return Response.json({ error: 'propertyId required' }, { status: 400 });

  const preview = await runBallparkPreview(supabase, body.propertyId);

  // The same status contract the modal has always read: a refusal with facts
  // is 200 (it is the homework's honest answer), nothing-to-build-from is
  // 422, an unreachable engine is 502.
  if (!preview.ok) {
    if (preview.reason === 'unknown_property') {
      return Response.json({ error: 'unknown property' }, { status: 404 });
    }
    if (preview.reason === 'nothing_heard') {
      return Response.json({ ok: false, reason: preview.reason, detail: preview.detail }, { status: 422 });
    }
    if (preview.reason === 'engine_unreachable') {
      return Response.json({ error: `Could not reach the engine: ${preview.detail ?? ''}` }, { status: 502 });
    }
    if (preview.reason === 'no_secret') {
      return Response.json({ error: preview.detail }, { status: 500 });
    }
    return Response.json({
      ok: false, heard: preview.heard, engine: preview.engine, heardCallId: preview.heardCallId,
      reason: preview.reason, detail: preview.detail,
    }, { status: 200 });
  }

  if (!body.apply) {
    return Response.json({
      ok: true, applied: false,
      heard: preview.heard, engine: preview.engine, heardCallId: preview.heardCallId,
    }, { status: 200 });
  }

  const applied = await applyBallpark(supabase, body.propertyId, preview, { dueAt: body.dueAt ?? null });
  if (!applied.ok) return Response.json({ error: applied.error }, { status: 500 });
  return Response.json({
    ok: true, applied: true,
    heard: preview.heard, engine: preview.engine, heardCallId: preview.heardCallId,
  }, { status: 200 });
}

// The Node adapter. Vercel's Node runtime carries the fetch globals, so the
// web handler above runs unchanged; this just buffers the body in and streams
// the Response back out.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  const out = await handleWeb(new Request(`http://internal${req.url ?? '/'}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  }));
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await out.arrayBuffer()));
}
