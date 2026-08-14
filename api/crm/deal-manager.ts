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
import { callLLM } from '../lib/llm.js';
import { buildDealState, type DealState, type DealStateInput } from '../lib/deal-state.js';
import {
  validateVerdict, fallbackVerdict, allowedActions, baselineAttention,
  deterministicFlags, FLAGS, type ManagerVerdict,
} from '../lib/deal-manager-contract.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MODEL = 'claude-sonnet-5';

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

const SYSTEM = [
  'You manage a property deal-sourcing pipeline. For ONE deal you decide how badly it needs a human today and what that human should do.',
  '',
  'WHAT YOU DECIDE: attention, and words. Nothing else.',
  '',
  'HARD RULES.',
  '1. NEVER name a figure that is not already in the state you are given. Do not add, subtract, split a difference, round, or suggest a number "around" another. If you want to talk about money, repeat a figure from the file exactly or refer to it in words.',
  '2. You may NOT move a card, send a message, or promise anything. Your instruction tells a person what to do; it never describes something you have done.',
  '3. Choose `action` from the allowed list you are given and NOTHING else. If none fits, choose `hold`.',
  '4. Choose `flags` only from the allowed list. An empty list is fine.',
  '5. The instruction is 2 to 4 plain sentences, addressed to the person who has to act. British English, no salesmanship.',
  '6. NEVER use a long dash. No em dash, no en dash. Use a comma or a full stop. No curly quotes, no ellipsis character.',
  '7. If the branch has replied since the brief was written, that is the most important fact on the deal and your instruction must deal with it first.',
  '8. If a fact is missing, say it is missing. Never assume it.',
  '',
  'Return ONLY a JSON object:',
  '{"attention": 0-100, "action": "...", "who": "PEDRO"|"HUGO"|"VA"|"NOBODY", "instruction": "...", "flags": ["..."], "evidence": ["..."]}',
].join('\n');

function userPrompt(state: DealState): string {
  return [
    'THE DEAL, as the system holds it:',
    JSON.stringify(state, null, 1),
    '',
    `ALLOWED ACTIONS in "${state.board.column ?? '(no column)'}": ${allowedActions(state.board.column).join(', ')}`,
    `ALLOWED FLAGS: ${FLAGS.join(', ')}`,
    '',
    'Every figure you are allowed to name, and no others: '
      + (state.money.figuresOnFile.length
        ? state.money.figuresOnFile.join(', ')
        : 'NONE. Do not put any number in your instruction.'),
  ].join('\n');
}

/** Assess one deal. Never throws, never returns an error to the caller: any
 *  failure is the deterministic brief plus a recorded reason. */
export async function assess(state: DealState): Promise<{
  verdict: ManagerVerdict; source: 'manager' | 'fallback'; refused?: string;
}> {
  let out = '';
  try {
    out = await callLLM(MODEL, SYSTEM, [{ role: 'user', content: userPrompt(state) }], 700);
  } catch (e) {
    return { verdict: fallbackVerdict(state), source: 'fallback', refused: `model_error: ${String(e).slice(0, 120)}` };
  }
  if (!out) return { verdict: fallbackVerdict(state), source: 'fallback', refused: 'model_silent' };

  let parsed: unknown;
  try {
    const m = out.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : out);
  } catch {
    return { verdict: fallbackVerdict(state), source: 'fallback', refused: 'unparseable_json' };
  }

  const checked = validateVerdict(parsed, state);
  if (checked.ok !== true) {
    // A refusal is normal operation, not an incident. Logged so a pattern of
    // the same refusal is visible, then the brief stands.
    const { reason, detail } = checked as { reason: string; detail: string };
    console.warn('[deal-manager] refused', reason, detail, state.propertyId);
    return { verdict: fallbackVerdict(state), source: 'fallback', refused: reason };
  }

  // The model may re-rank, but never BELOW what code is certain about: a
  // branch that wrote to us and was ignored outranks a model's opinion.
  const floor = baselineAttention(state);
  const verdict = {
    ...checked.verdict,
    attention: Math.max(checked.verdict.attention, floor),
    flags: [...new Set([...checked.verdict.flags, ...deterministicFlags(state)])],
  };
  return { verdict, source: 'manager' };
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
      supabase.from('wk_calls')
        .select('id, created_at, direction, disposition, duration_sec')
        .eq('contact_id', prop.wk_contact_id)
        .order('created_at', { ascending: false }).limit(20),
    ]);
    contact = c ?? null;
    messages = msgs ?? [];
    followups = fups ?? [];
    calls = cls ?? [];
    if (c?.pipeline_column_id) {
      const { data: col } = await supabase
        .from('wk_pipeline_columns').select('name').eq('id', c.pipeline_column_id).maybeSingle();
      columnName = col?.name ?? null;
    }
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
