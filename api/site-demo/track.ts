// Beacon sink for the demo site. Edge runtime: tiny, hot, no DB writes beyond
// one insert and one RPC.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * The ONLY event types a browser may assert.
 *
 * link_click, chat_message, call_started, call_ended, followup_sent,
 * outbound_call, checkout_start and converted are all deliberately absent:
 * they are server-owned. Accepting any of them here would let anyone with the
 * page open forge a sale, or forge engagement that stands the whole nudge
 * ladder down for a real lead.
 */
const BROWSER_TYPES = new Set(['open', 'phone_tap']);

/**
 * Verifies the HMAC the page minted into its own HTML (api/lib/site-demo.ts
 * beaconToken). page_id is printed in public HTML and slugs are guessable, so
 * without this anyone could POST against a real lead's page and move it.
 *
 * Accepts this hour or the previous one, so a long visit never starts failing
 * mid-session.
 */
async function tokenValid(pageId: string, token: string): Promise<boolean> {
  const secret = process.env.SITE_BEACON_SECRET || '';
  // Fails OPEN when unset, on purpose and matching the VSL side: an unset
  // secret must not silently stop tracking a live funnel. Set it in Vercel and
  // the gate closes.
  if (!secret) return true;
  if (!token) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bucket = Math.floor(Date.now() / 3_600_000);
  for (const b of [bucket, bucket - 1]) {
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${pageId}:${b}`));
    const hex = Array.from(new Uint8Array(sig))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
    if (hex === token) return true;
  }
  return false;
}

const ok = (body: Record<string, unknown> = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body: { page_id?: string; type?: string; token?: string; meta?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Bad JSON' }), { status: 400 });
  }

  const pageId = String(body.page_id || '');
  const type = String(body.type || '');
  if (!pageId || !BROWSER_TYPES.has(type)) {
    return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
  }
  if (!(await tokenValid(pageId, String(body.token || '')))) {
    return new Response(JSON.stringify({ error: 'Bad token' }), { status: 403 });
  }

  const { data: page } = await supabase
    .from('wk_site_pages')
    .select('id, contact_id, state')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) return ok({ ok: true, unknown: true });

  // Always read the insert error: a type missing from the CHECK constraint
  // fails with 23514, and on the VSL side that went unnoticed for weeks
  // because nobody looked at the result.
  const { error: evErr } = await supabase
    .from('wk_site_events')
    .insert({ page_id: pageId, type, meta: body.meta || {} });
  if (evErr) console.error('[site-demo/track] event insert failed:', type, evErr.message);

  // A phone tap is strong intent but it is not engagement: engagement means
  // they actually reached the AI, which only the call or chat webhooks can
  // confirm. Both signals still stamp first_opened_at inside the RPC.
  const { error: advErr } = await supabase.rpc('wk_site_advance', {
    p_page_id: pageId,
    p_target: 'opened',
    p_bump_open: type === 'open',
    p_link_click: false,
    p_phone_tap: type === 'phone_tap',
    p_chat: false,
    p_call: false,
    p_nudge: false,
    p_outbound_call: false,
  });
  if (advErr) console.error('[site-demo/track] advance failed:', advErr.message);

  return ok();
}
