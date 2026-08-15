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
import { buildDealState, type DealState, type DealStateInput } from '../lib/deal-state.js';
import { fallbackVerdict, baselineAttention, deterministicFlags } from '../lib/deal-manager-contract.js';
import { assess } from '../lib/deal-brain.js';

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

/** Gather everything Layer 1 needs for one property. */
async function loadState(propertyId: string, now: Date): Promise<DealState | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: property } = await (supabase.from('brrr_properties') as any)
    .select('id, address, status, asking_price, bedrooms, deal, brief, pinned_note,'
      + ' qualification, assigned_builder_id, viewing_at, viewing_quote, updated_at, wk_contact_id')
    .eq('id', propertyId).maybeSingle();
  if (!property) return null;
  const prop = property as DealStateInput['property'] & { wk_contact_id?: string | null };

  let contact: DealStateInput['contact'] = null;
  let columnName: string | null = null;
  let calls: DealStateInput['calls'] = [];
  let messages: DealStateInput['messages'] = [];
  let followups: DealStateInput['followups'] = [];

  if (prop.wk_contact_id) {
    const [{ data: c }, { data: msgs }, { data: fups }, { data: cls }] = await Promise.all([
      supabase.from('wk_contacts')
        .select('id, name, phone, email, pipeline_column_id, custom_fields, stage_moved_at, last_contact_at')
        .eq('id', prop.wk_contact_id).maybeSingle(),
      supabase.from('wk_sms_messages')
        .select('id, created_at, direction, channel, subject, body')
        .eq('contact_id', prop.wk_contact_id)
        .order('created_at', { ascending: false }).limit(30),
      supabase.from('wk_contact_followups')
        .select('id, due_at, note, status')
        .eq('contact_id', prop.wk_contact_id),
      // wk_calls HAS NO `disposition` COLUMN. The outcome of a call is
      // disposition_column_id, the board column the agent dropped it into, so
      // the name has to be resolved by a lookup.
      //
      // Selecting a column that does not exist is not a null, it is an error:
      // PostgREST refuses the whole query, supabase-js puts it in `error`, and
      // `cls ?? []` quietly became an empty list. From the day this route
      // shipped until 2026-08-15 EVERY deal came back with no call history at
      // all, so `clock.lastTouchAt` never counted a phone call and a branch
      // rung an hour ago could look untouched for three days.
      supabase.from('wk_calls')
        .select('id, created_at, direction, disposition_column_id, duration_sec')
        .eq('contact_id', prop.wk_contact_id)
        .order('created_at', { ascending: false }).limit(20),
    ]);
    contact = c ?? null;
    messages = msgs ?? [];
    followups = fups ?? [];

    // One read of a small table gives both the card's column and every call's
    // outcome, instead of one query per call.
    const { data: cols } = await supabase.from('wk_pipeline_columns').select('id, name');
    const columnById = new Map((cols ?? []).map((k) => [k.id as string, k.name as string]));

    calls = (cls ?? []).map((k) => ({
      id: k.id,
      created_at: k.created_at,
      direction: k.direction,
      disposition: k.disposition_column_id
        ? columnById.get(k.disposition_column_id as string) ?? null
        : null,
      duration_sec: k.duration_sec,
    }));

    if (c?.pipeline_column_id) columnName = columnById.get(c.pipeline_column_id) ?? null;
  }

  return buildDealState({ property: prop, contact, columnName, calls, messages, followups, now });
}

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

    const state = await loadState(body.propertyId, now);
    if (!state) return Response.json({ error: 'unknown property' }, { status: 404 });

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: live } = await (supabase.from('brrr_properties') as any)
    .select('id, address, status, asking_price, bedrooms, deal, brief, pinned_note,'
      + ' qualification, assigned_builder_id, viewing_at, viewing_quote, updated_at, wk_contact_id')
    .in('status', ['new', 'call_queued', 'qualified', 'figure_obtained', 'deciding'])
    .not('wk_contact_id', 'is', null)
    .limit(400);

  const states: DealState[] = [];
  for (const p of (live ?? []) as Array<{ id: string }>) {
    const s = await loadState(p.id, now);
    if (s) states.push(s);
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
