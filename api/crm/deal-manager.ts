// The Deal Manager: one ordered Today list, one instruction per deal.
//
// docs/AI_DEAL_MANAGER_PLAN.md. The gaps it closes, in the order they cost
// money: nothing watches a deal between events, a branch's email reply changes
// no instruction anywhere, and Pedro's day has a queue order but no priorities.
//
// THE RULE: the AI decides attention and words, code decides money and moves.
// It can never move a card, never send anything, and never name a figure that
// is not already on the file. Those fences live in deal-manager-contract.ts
// and every one of them is tested.
//
// THE FALLBACK IS THE PRODUCT AS IT STANDS TODAY. If this is switched off,
// down, rate-limited or wrong, every card shows its deterministic brief and
// nothing else changes. Turning the Manager off changes nothing except that
// Pedro is managed by Hugo again.
//
// GET  /api/crm/deal-manager                -> the Today list, ordered
// POST /api/crm/deal-manager { propertyId } -> assess one deal

import { createClient } from '@supabase/supabase-js';
import { fallbackVerdict, baselineAttention, deterministicFlags } from '../lib/deal-manager-contract.js';
import { assess } from '../lib/deal-brain.js';
import { loadCockpitStates, loadDealBundle } from '../lib/deal-manager-run.js';

// The prompt and the assessment moved to api/lib/deal-brain.ts on 2026-08-15,
// unchanged, so the Node cron (api/cron/deal-sweep.ts) can use the same brain
// without importing an edge route. Re-exported here because this route has
// been `assess`'s home since it shipped and nothing should have to care.
export { assess };

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** One flag returns the product to today, byte for byte. */
async function managerEnabled(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('platform_settings').select('value').eq('key', 'deal_manager').maybeSingle();
    const cfg = JSON.parse(String(data?.value ?? '{}')) as { enabled?: boolean };
    return cfg.enabled === true;
  } catch {
    // Unreadable settings means OFF. The Manager is the optional layer.
    return false;
  }
}

// The per-property loader that used to live here walked the pool one deal at
// a time: up to 400 properties x 5 queries each, serially, on every page
// load. Under 100 deals it looked fine; the day the pool grew past a few
// hundred the function blew Vercel's time limit and the Today panel showed
// Pedro a Vercel crash page as "Unexpected token 'A'" (19 Aug). The batched
// loader (ONE wk_deal_cockpit_rows RPC) had existed in deal-manager-run.ts
// since the cockpit shipped; this route just predated it. It is the only
// loader now, so the route and the cockpit can never disagree about a deal.

export default async function handler(req: Request): Promise<Response> {
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

  const now = new Date();
  const on = await managerEnabled();

  // ---- one deal -------------------------------------------------------
  if (req.method === 'POST') {
    let body: { propertyId?: string };
    try { body = await req.json() as { propertyId?: string }; }
    catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    if (!body.propertyId) return Response.json({ error: 'propertyId required' }, { status: 400 });

    const bundle = await loadDealBundle(supabase, body.propertyId, now);
    if (!bundle) return Response.json({ error: 'unknown property' }, { status: 404 });
    const state = bundle.state;

    const result = on
      ? await assess(state)
      : { verdict: fallbackVerdict(state), source: 'fallback' as const, refused: 'manager_off' };
    return Response.json({ ...result, state });
  }

  // ---- the Today list -------------------------------------------------
  //
  // Ordered by what code is certain about, so the list is right even with the
  // Manager switched off. That ordering IS the fifth gap closed: the nightly
  // assign script orders the queue once, and during the day overdue
  // follow-ups, fresh branch replies and booked call-twos all compete.
  let states;
  try {
    states = (await loadCockpitStates(supabase, { limit: 400, now })).map((b) => b.state);
  } catch (e) {
    // loadCockpitStates throws rather than returning [], on purpose. Answer
    // in JSON so the panel prints the sentence instead of choking on a crash
    // page.
    return Response.json({ error: String(e instanceof Error ? e.message : e).slice(0, 300) }, { status: 500 });
  }

  const ranked = states
    .map((s) => ({ state: s, attention: baselineAttention(s), flags: deterministicFlags(s) }))
    .filter((r) => r.attention > 10 || r.flags.length)
    .sort((a, b) => b.attention - a.attention)
    .slice(0, 25);

  return Response.json({
    managerEnabled: on,
    generatedAt: now.toISOString(),
    today: ranked.map((r) => ({
      propertyId: r.state.propertyId,
      address: r.state.address,
      column: r.state.board.column,
      attention: r.attention,
      flags: r.flags,
      instruction: fallbackVerdict(r.state).instruction,
      repliedSinceBrief: r.state.writing.replySinceBrief,
      lastInboundPreview: r.state.writing.lastInboundPreview,
      hoursSinceTouch: r.state.clock.hoursSinceTouch,
    })),
  });
}
