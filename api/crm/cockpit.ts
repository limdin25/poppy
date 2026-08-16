// The Deal Cockpit's two reads. Neither of them ever calls a model.
//
// Hugo, 2026-08-15: "a prioritised deal list with the most urgent actions at
// the top", and "to the right, a dedicated log column showing the full history
// and reasoning for every move."
//
// WHY A PAGE LOAD COSTS NOTHING. The instructions are read out of
// wk_deal_manager_log, which api/cron/deal-sweep.ts fills in the background.
// Assessing on demand would mean a model call per deal per page load, which is
// both slow and a bill that scales with how often somebody glances at the
// screen. The sweep pays once per real change; the page reads the answer.
//
// WHY THIS IS NOT AN EXTENSION OF api/crm/deal-manager.ts. That route is what
// TodayPanel reads and it IS the kill-switch product: deterministic, no model,
// correct with the brain switched off. It stays exactly as it is.
//
// GET /api/crm/cockpit               -> the prioritised list
// GET /api/crm/cockpit?propertyId=x  -> one deal, its history, and every
//                                       button's stress test

import { createClient } from '@supabase/supabase-js';
import { baselineAttention, deterministicFlags, fallbackVerdict, allowedActions } from '../lib/deal-manager-contract.js';
import { stateHash, loadCockpitStates, latestAssessments, dealLog, type LogRow } from '../lib/deal-manager-run.js';
import { stressAll, COCKPIT_ACTIONS, ACTION_LABEL, ACTION_EXECUTION } from '../lib/deal-stress-test.js';
import { isCockpitDeal } from '../lib/cockpit-filter.js';
import { buildDealTimeline } from '../lib/deal-timeline.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** One flag returns the product to what it was. Unreadable means OFF. */
async function managerEnabled(sb: ReturnType<typeof createClient>): Promise<boolean> {
  try {
    const { data } = await sb
      .from('platform_settings').select('value').eq('key', 'deal_manager').maybeSingle();
    const cfg = JSON.parse(String((data as { value?: string } | null)?.value ?? '{}')) as { enabled?: boolean };
    return cfg.enabled === true;
  } catch {
    return false;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // The CALLER's client. Every read of wk_deal_manager_log goes through this
  // one, never the service role, because RLS is what keeps Hugo's escalation
  // lane (blocked_needs_hugo, figure_mismatch, stage_mismatch) out of Pedro's
  // history column. A filter in this file could be forgotten; a policy cannot.
  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  const now = new Date();
  const on = await managerEnabled(supabase);
  const url = new URL(req.url);
  const propertyId = url.searchParams.get('propertyId');

  // -----------------------------------------------------------------------
  // one deal, with its working shown
  // -----------------------------------------------------------------------
  if (propertyId) {
    const bundles = await loadCockpitStates(supabase, { limit: 400, now });
    const bundle = bundles.find((b) => b.state.propertyId === propertyId);
    if (!bundle) return Response.json({ error: 'unknown property' }, { status: 404 });

    const [log, latest] = await Promise.all([
      dealLog(caller, propertyId, 60),
      latestAssessments(caller, [propertyId]),
    ]);

    const reports = stressAll({
      state: bundle.state,
      contactEmail: bundle.email,
      contactPhone: bundle.phone,
      builderMatches: bundle.builderMatches,
      now,
    });

    // THE WHOLE FILE, not just what the machine thought. The log rows come
    // through the CALLER's client so RLS keeps Hugo's escalation lane off
    // Pedro's screen; the calls and recordings need the service role to sign.
    // That split is deliberate and it lives here rather than inside the merge.
    const timeline = await buildDealTimeline(supabase, {
      contactId: bundle.contactId,
      contactEmail: bundle.email,
      log,
    });

    // Every stage a human may move this card to, named by the server so the
    // client never holds a copy of the board.
    //
    // SCOPED TO ONE PIPELINE, and that is not fussiness. `Not interested`
    // exists on BOTH the property board and the HeyPubli creators board, so
    // filtering by name alone offered two of them and one of those would have
    // moved a house onto a completely different business's board. Caught in a
    // screenshot: sixteen options where there should have been fifteen.
    const { data: allCols } = await (supabase.from('wk_pipeline_columns') as unknown as {
      select: (c: string) => { order: (c: string) => Promise<{ data: Array<{ id: string; name: string; sort_order: number; pipeline_id: string }> | null }> };
    }).select('id, name, sort_order, pipeline_id').order('sort_order');

    // The property board is the one carrying the funnel columns. Found by a
    // column name that exists nowhere else, rather than by a hardcoded id.
    const propertyPipelineId = (allCols ?? [])
      .find((c) => c.name === 'Ballpark agreed')?.pipeline_id ?? null;
    const cols = (allCols ?? []).filter((c) =>
      PROPERTY_STAGES.includes(c.name)
      && (propertyPipelineId === null || c.pipeline_id === propertyPipelineId));

    return Response.json({
      managerEnabled: on,
      generatedAt: now.toISOString(),
      deal: shapeDeal(bundle, latest.get(propertyId) ?? null, now),
      state: bundle.state,
      log: log.map(shapeLogEntry),
      timeline,
      stages: cols,
      reports,
      allowedActions: allowedActions(bundle.state.board.column),
      actions: COCKPIT_ACTIONS.map((a) => ({
        action: a, label: ACTION_LABEL[a], executedBy: ACTION_EXECUTION[a].by,
      })),
    });
  }

  // -----------------------------------------------------------------------
  // the prioritised list
  // -----------------------------------------------------------------------
  const bundles = await loadCockpitStates(supabase, { limit: 400, now });
  const latest = await latestAssessments(caller, bundles.map((b) => b.state.propertyId));

  // THE COCKPIT IS WHERE A CONVERSATION IS WAITING ON A DECISION.
  //
  // Everything else is a phone number waiting to be rung, and that is the
  // dialer's job on the cadence in scripts/lib/redial-policy.mjs. Measured on
  // the live board the day this filter was written: of 179 properties reaching
  // this route, 144 were a dial nobody answered and 35 were a real deal. See
  // api/lib/cockpit-filter.ts for the whole count.
  const kept: typeof bundles = [];
  const asideContacts: Record<string, Set<string>> = {
    calling_list: new Set(), never_spoke: new Set(), closed_door: new Set(),
    finished: new Set(), off_board: new Set(),
  };
  const keptContacts = new Set<string>();
  for (const b of bundles) {
    const decision = isCockpitDeal(b.state);
    if (decision.inCockpit) {
      kept.push(b);
      keptContacts.add(b.contactId);
    } else if (decision.why in asideContacts) {
      asideContacts[decision.why].add(b.contactId);
    }
  }

  const shaped = kept
    .map((bundle) => shapeDeal(bundle, latest.get(bundle.state.propertyId) ?? null, now))
    .sort((a, b) => b.attention - a.attention
      || (b.hoursSinceTouch ?? 0) - (a.hoursSinceTouch ?? 0)
      || String(a.address).localeCompare(String(b.address)));

  // ONE CARD PER BRANCH, NOT PER HOUSE. Hugo, 2026-08-16: "there are only 15
  // deals pedro called on the pipeline but on cockpit looks like there are
  // 35". The conversation is with the branch and the pipeline card is the
  // branch, so a branch holding several live houses is one card whose focus
  // house is the highest-attention one; the rest ride along as `others` and
  // the client switches between them without a second card existing.
  const byContact = new Map<string, (typeof shaped)[number] & {
    others: Array<{ propertyId: string; address: string | null; attention: number; column: string | null }>;
  }>();
  for (const d of shaped) {
    const existing = byContact.get(d.contactId);
    if (!existing) byContact.set(d.contactId, { ...d, others: [] });
    else existing.others.push({
      propertyId: d.propertyId, address: d.address, attention: d.attention, column: d.column,
    });
  }
  const deals = [...byContact.values()];

  // The footer's arithmetic has to match what Hugo counts on the pipeline, so
  // set-aside counts BRANCHES, not houses, and a branch with any card in the
  // cockpit is not set aside at all.
  const setAside = Object.fromEntries(
    Object.entries(asideContacts).map(([why, ids]) => [
      why, [...ids].filter((id) => !keptContacts.has(id)).length,
    ]),
  ) as { calling_list: number; never_spoke: number; closed_door: number; finished: number; off_board: number };

  return Response.json({
    managerEnabled: on,
    generatedAt: now.toISOString(),
    deals,
    // Said out loud rather than silently dropped, so nobody has to wonder where
    // the other hundred and forty went.
    setAside,
  });
}

/** The board columns a property deal can actually be in. The pipeline table
 *  also holds the VSL video funnel's columns (Rendering, Video sent, Watched
 *  video and the rest), and offering those as somewhere to move a house would
 *  be offering to break the board. */
const PROPERTY_STAGES = [
  'Booked', 'Discovery done, evaluating', 'Ready for call 2', 'Ballpark agreed',
  'Needs viewing', 'Offer sent', 'Offer accepted', 'Sent to investor',
  'Deal closed', 'Follow up', 'Voicemail', 'No pickup', 'Not interested', 'Nurturing',
];

// ---------------------------------------------------------------------------
// shaping
// ---------------------------------------------------------------------------

type Bundle = Awaited<ReturnType<typeof loadCockpitStates>>[number];

function shapeDeal(bundle: Bundle, assessment: LogRow | null, now: Date) {
  const { state } = bundle;
  const fallback = fallbackVerdict(state);
  const hash = stateHash(state);

  // ATTENTION IS A FLOOR, NOT A VOTE. The model may re-rank upwards, never
  // below what code is certain about, so a branch that wrote to us and was
  // ignored can never be buried by a model having an opinion.
  const floor = baselineAttention(state);
  const attention = Math.max(floor, assessment?.attention ?? 0);

  // An instruction written against a state that has since moved is STALE, not
  // wrong. It still renders, marked, because a slightly old instruction beats
  // a blank card and the sweep catches up within two minutes.
  const stale = Boolean(assessment && assessment.state_hash !== hash);

  return {
    propertyId: state.propertyId,
    contactId: bundle.contactId,
    contactName: bundle.contactName,
    branchPhone: bundle.phone,
    branchEmail: bundle.email,
    address: state.address,
    status: state.status,
    column: state.board.column,

    attention,
    action: assessment?.action ?? fallback.action,
    who: assessment?.who ?? fallback.who,
    instruction: assessment?.instruction ?? fallback.instruction,
    evidence: assessment?.evidence ?? fallback.evidence,
    source: (assessment?.source ?? 'fallback') as 'manager' | 'fallback',
    assessedAt: assessment?.created_at ?? null,
    stale,

    flags: [...new Set([...(assessment?.flags ?? []), ...deterministicFlags(state)])],

    repliedSinceBrief: state.writing.replySinceBrief,
    lastInboundPreview: state.writing.lastInboundPreview,
    lastInboundAt: state.writing.lastInboundAt,
    hoursSinceTouch: state.clock.hoursSinceTouch,

    brief: state.brief,
    pinnedNote: state.pinnedNote,
    money: state.money,
    checklist: state.checklist,
    followups: state.followups,
    builder: state.builder,
    pack: state.pack,
    allowedActions: allowedActions(state.board.column),
    // Included so the client can tell a genuinely fresh instruction from one
    // written before the last thing that happened, without recomputing a hash
    // in the browser.
    stateHash: hash,
    generatedAt: now.toISOString(),
  };
}

/** One history row, trimmed to what the column renders. The frozen `state` is
 *  deliberately NOT sent: it is a whole DealState per row and the column shows
 *  sixty of them. It stays in the table for anyone auditing a decision later. */
function shapeLogEntry(row: LogRow) {
  return {
    id: row.id,
    at: row.created_at,
    kind: row.kind,
    trigger: row.trigger ?? null,
    action: row.action ?? null,
    who: row.who ?? null,
    attention: row.attention ?? null,
    instruction: row.instruction ?? null,
    flags: row.flags ?? [],
    evidence: row.evidence ?? [],
    column: row.board_column ?? null,
    source: row.source ?? 'fallback',
    refusedReason: row.refused_reason ?? null,
    blocked: Boolean(row.blocked),
    checks: row.checks ?? null,
    executedBy: row.executed_by ?? null,
    note: row.note ?? null,
  };
}
