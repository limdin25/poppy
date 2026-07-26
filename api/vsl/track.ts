// VSL beacon sink. The public video page fires sendBeacon events here:
// open (page load), progress (25/50/75/95), cta_click, tier_pick, calc
// (first touch of the value calculator — measures if it earns its place).
// State only ever moves FORWARD — replays, bots and out-of-order beacons can
// bump counters but never demote a page. checkout_start/paid are set by their
// own endpoints, not accepted from the browser.

import { createClient } from '@supabase/supabase-js';
import {
  getVslSettings,
  advanceVslState,
} from '../lib/vsl-settings.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const BROWSER_TYPES = new Set(['open', 'progress', 'cta_click', 'tier_pick', 'calc']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body: { page_id?: string; type?: string; pct?: number; variant?: string };
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

  const { data: page } = await supabase
    .from('wk_vsl_pages')
    .select('*')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) return new Response(JSON.stringify({ error: 'Unknown page' }), { status: 404 });

  const pct = Math.max(0, Math.min(100, Math.round(Number(body.pct) || 0)));

  await supabase.from('wk_vsl_events').insert({
    page_id: page.id,
    type,
    meta: { pct: pct || undefined, variant: body.variant || undefined },
  });

  if (type === 'open') {
    await advanceVslState(page, 'opened', { bump_open: true });
  } else if (type === 'progress') {
    const settings = await getVslSettings();
    const target = pct >= settings.watched_threshold_pct ? 'watched' : 'opened';
    await advanceVslState(page, target, { watched_pct: pct });
  } else if (type === 'cta_click') {
    await advanceVslState(page, 'cta_clicked');
  } else {
    // tier_pick / calc: event only — no state change.
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
