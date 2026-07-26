// VSL beacon sink. The public video page fires sendBeacon events here:
// open (page load), play (video started), progress (10/25/50/75/90/100 plus a
// final exact-coverage flush), cta_click, tier_pick, calc.
//
// State only ever moves FORWARD — replays, bots and out-of-order beacons can
// bump counters but never demote a page. checkout_start/paid are set by their
// own endpoints, and link_click is written server-side by page.ts; none of the
// three is accepted from the browser.
//
// Every notify-worthy first-touch and newly-crossed milestone raises a
// notification exactly once — the RPC reports what it saw under its row lock,
// so a reload cannot re-fire one.

import { createClient } from '@supabase/supabase-js';
import {
  getVslSettings,
  advanceVslState,
  crossedMilestones,
} from '../lib/vsl-settings.js';
import { notifyFunnelEvent } from '../lib/vsl-notify.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

// link_click / checkout_start / paid are deliberately absent: they are
// server-owned. Accepting them here would let a browser forge a sale.
const BROWSER_TYPES = new Set(['open', 'progress', 'play', 'cta_click', 'tier_pick', 'calc']);

/** HMAC the page mints into its own HTML (api/vsl/page.ts beaconToken).
 *  Proves the sender loaded the page, which is the whole scripted-replay
 *  class. Accepts this hour or the previous one so a long watch never fails. */
async function tokenValid(pageId: string, token: string): Promise<boolean> {
  const secret = process.env.VSL_BEACON_SECRET || '';
  // Fail OPEN when unset, on purpose: an unset secret must not silently stop
  // tracking a live funnel. Set it in Vercel and the gate closes.
  if (!secret) return true;
  if (!token) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bucket = Math.floor(Date.now() / 3_600_000);
  for (const b of [bucket, bucket - 1]) {
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${pageId}:${b}`));
    const hex = Array.from(new Uint8Array(sig)).map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
    if (hex === token) return true;
  }
  return false;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body: { page_id?: string; type?: string; pct?: number; variant?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const pageId = (body.page_id || '').trim();
  const type = (body.type || '').trim();
  if (!pageId || !BROWSER_TYPES.has(type)) {
    return new Response(JSON.stringify({ error: 'Bad beacon' }), { status: 400 });
  }
  if (!(await tokenValid(pageId, (body.token || '').trim()))) {
    return new Response(JSON.stringify({ error: 'Bad token' }), { status: 403 });
  }

  const { data: page } = await supabase
    .from('wk_vsl_pages')
    .select('*')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) return new Response(JSON.stringify({ error: 'Unknown page' }), { status: 404 });

  const pct = Math.max(0, Math.min(100, Math.round(Number(body.pct) || 0)));

  // Inspect the error. A type missing from the wk_vsl_events CHECK fails with
  // 23514, and discarding it here is exactly how 'calc' stayed broken in
  // production unnoticed (fixed 2026-07-26).
  const { error: insertErr } = await supabase.from('wk_vsl_events').insert({
    page_id: page.id,
    type,
    meta: { pct: pct || undefined, variant: body.variant || undefined },
  });
  if (insertErr) console.error('[vsl/track] event insert failed:', type, insertErr);

  if (type === 'open') {
    const r = await advanceVslState(page, 'opened', { bump_open: true });
    if (r?.first_open) await notifyFunnelEvent({ page, kind: 'vsl_open' });
  } else if (type === 'play') {
    const r = await advanceVslState(page, 'opened', { play: true });
    if (r?.first_play) await notifyFunnelEvent({ page, kind: 'vsl_play' });
  } else if (type === 'progress') {
    const settings = await getVslSettings();
    const target = pct >= settings.watched_threshold_pct ? 'watched' : 'opened';
    const r = await advanceVslState(page, target, {
      watched_pct: pct,
      completed: pct >= 100,
    });
    // Notify once per milestone. crossedMilestones uses the pre-write value the
    // RPC read under its lock, so a replay or a rewind yields nothing.
    if (r) {
      for (const m of crossedMilestones(r.pct_before, pct)) {
        if (m === 50 || m === 90 || m === 100) {
          await notifyFunnelEvent({ page, kind: `vsl_watched_${m}`, meta: { pct: m } });
        }
      }
    }
  } else if (type === 'cta_click') {
    const r = await advanceVslState(page, 'cta_clicked');
    if (r?.advanced) await notifyFunnelEvent({ page, kind: 'vsl_cta_click' });
  } else {
    // tier_pick / calc: event only — no state change, no notification.
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
