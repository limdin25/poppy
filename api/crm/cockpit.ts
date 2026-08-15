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

    return Response.json({
      managerEnabled: on,
      generatedAt: now.toISOString(),
      deal: shapeDeal(bundle, latest.get(propertyId) ?? null, now),
      state: bundle.state,
      log: log.map(shapeLogEntry),
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

  const deals = bundles
    .map((bundle) => shapeDeal(bundle, latest.get(bundle.state.propertyId) ?? null, now))
    // A deal nobody needs to do anything about is not somebody's day. The
    // threshold is the same one TodayPanel already uses.
    .filter((d) => d.attention > 10 || d.flags.length)
    .sort((a, b) => b.attention - a.attention
      || (b.hoursSinceTouch ?? 0) - (a.hoursSinceTouch ?? 0)
      || String(a.address).localeCompare(String(b.address)))
    .slice(0, 60);

  return Response.json({ managerEnabled: on, generatedAt: now.toISOString(), deals });
}

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
