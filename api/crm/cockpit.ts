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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { baselineAttention, deterministicFlags, fallbackVerdict, allowedActions } from '../lib/deal-manager-contract.js';
import {
  stateHash, loadCockpitStates, latestAssessments, latestHandMoves, dealLog, type LogRow,
} from '../lib/deal-manager-run.js';
import { stressAll, COCKPIT_ACTIONS, ACTION_LABEL, ACTION_EXECUTION } from '../lib/deal-stress-test.js';
import { isCockpitDeal } from '../lib/cockpit-filter.js';
import { bestBranchEmail } from '../lib/branch-email-lookup.js';
import { buildDealTimeline } from '../lib/deal-timeline.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** One flag returns the product to what it was. Unreadable means OFF. */
async function managerEnabled(sb: SupabaseClient<any, any, any>): Promise<boolean> {
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

    const [log, latest, blocked] = await Promise.all([
      dealLog(caller, propertyId, 60),
      latestAssessments(caller, [propertyId]),
      // The CALLER's client on purpose: the function answers only for someone
      // who is already allowed in the CRM, and an admin never needs it because
      // the real row is readable.
      blockedOnHugo(caller, [propertyId]),
    ]);

    // THE ADDRESS WE ACTUALLY HOLD, resolved the same way the pipeline modal
    // and the gate resolve it. Without this every email button on the deal
    // reported "there is no email address for this branch" while the pipeline
    // was happily offering leanne@movewithzest.co.uk (Hugo, 17 Aug).
    const resolvedEmail = (bundle.email ?? '').trim()
      || (await bestBranchEmail(supabase, {
        street: bundle.state.address, agency: bundle.contactName,
      }))?.email
      || null;

    const reports = stressAll({
      state: bundle.state,
      contactEmail: resolvedEmail,
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
    const { data: allCols, error: colsErr } = await (supabase.from('wk_pipeline_columns') as unknown as {
      select: (c: string) => { order: (c: string) => Promise<{ data: Array<{ id: string; name: string; sort_order: number; pipeline_id: string }> | null; error: { message: string } | null }> };
    }).select('id, name, sort_order, pipeline_id').order('sort_order');

    // A FAILED read offers NO stages, never an unscoped list. Ignoring the
    // error here used to leave propertyPipelineId null, which turned the
    // pipeline filter off and reopened the wrong-board move this scoping
    // exists to prevent (16 Aug audit, silent-failure class).
    if (colsErr) console.error('[cockpit] stages read failed', colsErr.message);

    // The property board is the one carrying the funnel columns. Found by a
    // column name that exists nowhere else, rather than by a hardcoded id.
    const propertyPipelineId = (allCols ?? [])
      .find((c) => c.name === 'Ballpark agreed')?.pipeline_id ?? null;
    const cols = colsErr || propertyPipelineId === null ? [] : (allCols ?? []).filter((c) =>
      PROPERTY_STAGES.includes(c.name) && c.pipeline_id === propertyPipelineId);

    return Response.json({
      managerEnabled: on,
      generatedAt: now.toISOString(),
      // branchEmail carries the RESOLVED address so the drawer shows what the
      // gate will use, not the branch row's empty field.
      deal: {
        ...shapeDeal(bundle, latest.get(propertyId) ?? null, now, blocked.get(propertyId) ?? null),
        branchEmail: resolvedEmail,
      },
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
  const propertyIds = bundles.map((b) => b.state.propertyId);
  const [latest, blocked, handMoved] = await Promise.all([
    latestAssessments(caller, propertyIds),
    blockedOnHugo(caller, propertyIds),
    // A card a human moved by hand is off the desk. Read with the CALLER's
    // client, like the other two, so an agent's board and an admin's board are
    // each judged on what that person is allowed to see.
    latestHandMoves(caller, propertyIds),
  ]);

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
    finished: new Set(), off_board: new Set(), scheduled: new Set(), waiting_reply: new Set(),
    moved_by_hand: new Set(),
  };
  const keptContacts = new Set<string>();
  for (const b of bundles) {
    const decision = isCockpitDeal(b.state, now, {
      handMovedAt: handMoved.get(b.state.propertyId) ?? null,
    });
    if (decision.inCockpit) {
      kept.push(b);
      keptContacts.add(b.contactId);
    } else if (decision.why in asideContacts) {
      asideContacts[decision.why].add(b.contactId);
    }
  }

  const shaped = kept
    .map((bundle) => shapeDeal(
      bundle, latest.get(bundle.state.propertyId) ?? null, now,
      blocked.get(bundle.state.propertyId) ?? null,
    ))
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
  ) as {
    calling_list: number; never_spoke: number; closed_door: number; finished: number;
    off_board: number; scheduled: number; waiting_reply: number; moved_by_hand: number;
  };

  // THE CALLING LIST IS THE DIALER QUEUE, counted from the queue itself.
  //
  // Hugo, 17 Aug: "you said 164 discovery branches, but the dialer says 168 on
  // the queue. Come on." He was right to bite. The footer used to count
  // branches that hold a HOUSE and have not been reached, which on the live
  // board was 97, while Pedro's actual queue held 168 rows, most of them
  // discovery branches with no priced house on file at all. Two numbers for
  // one idea. The number Pedro works from is the queue, so that is the number
  // the footer shows.
  const { count: queued } = await (supabase.from('wk_dialer_queue') as unknown as {
    select: (c: string, o: { count: 'exact'; head: true }) => {
      eq: (c: string, v: string) => Promise<{ count: number | null }>;
    };
  }).select('id', { count: 'exact', head: true }).eq('status', 'pending');

  return Response.json({
    managerEnabled: on,
    generatedAt: now.toISOString(),
    deals,
    // Said out loud rather than silently dropped, so nobody has to wonder where
    // the other hundred and forty went.
    setAside,
    callingListQueued: queued ?? null,
    machine: await machineHealth(supabase, now),
  });
}

/** Is the machine that fills the calling list actually running.
 *
 *  THE ALERT EXISTED AND NOBODY SAW IT (2026-08-17). The overnight pipeline
 *  failed three nights in a row, the dead man's switch fired correctly, and it
 *  fired by EMAIL. Meanwhile the cockpit, the screen Hugo opens every morning,
 *  looked completely normal while Pedro worked a two day old list that nothing
 *  was refilling.
 *
 *  So the same fact is put where the work happens. It is read from the same
 *  stamps the dead man's switch reads, never from a second source of truth.
 *
 *  Never fatal, and never green by accident: a failed read reports unknown
 *  rather than healthy, because "we could not check" and "it is fine" are
 *  different answers and only one of them is safe to show as a tick.
 */
async function machineHealth(sb: SupabaseClient<any, any, any>, now: Date): Promise<{
  ok: boolean | null; problems: string[];
}> {
  try {
    const { data, error } = await (sb.from('platform_settings') as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => Promise<{
        data: Array<{ key: string; value: string }> | null;
        error: { message: string } | null;
      }> };
    }).select('key, value').in('key', ['vps_overnight_last_ok_at', 'deal_sweep_last_ok_at']);
    if (error) return { ok: null, problems: [] };

    // platform_settings.value is a TEXT column holding JSON, not jsonb, so it
    // arrives as a string and has to be parsed. Reading it as an object gives
    // undefined for every field and the banner then reports a healthy machine
    // as "never reported in", which is how this was caught: the first live
    // response said the overnight had never run on a day it ran at 23:30.
    // api/cron/system-deadman.ts parses it the same way.
    const parse = (s: string | undefined): { at?: string; stage?: string } => {
      try { return JSON.parse(String(s ?? '{}')) as { at?: string; stage?: string }; }
      catch { return {}; }
    };
    const by = new Map((data ?? []).map((r) => [r.key, parse(r.value)]));
    const problems: string[] = [];

    const vps = by.get('vps_overnight_last_ok_at');
    const vpsAt = vps?.at ? Date.parse(String(vps.at)) : NaN;
    const vpsStage = String(vps?.stage ?? '');
    const vpsAgeH = Number.isNaN(vpsAt) ? null : (now.getTime() - vpsAt) / 3_600_000;
    if (vpsAgeH === null) {
      problems.push('The overnight machine has never reported in.');
    } else if (vpsAgeH > 26) {
      problems.push(`The overnight machine has not run for ${Math.round(vpsAgeH)} hours. Pedro's list is not being refilled.`);
    } else if (vpsStage !== 'complete' && vpsAgeH > 8) {
      problems.push(`Last night's run died part way, at "${vpsStage || 'unknown'}". No new houses reached Pedro.`);
    }

    const sweepAt = by.get('deal_sweep_last_ok_at')?.at;
    const sweepAgeMin = sweepAt ? (now.getTime() - Date.parse(String(sweepAt))) / 60_000 : null;
    // Only inside the hours the sweep cron actually runs (*/2 6-20 UTC), or a
    // healthy overnight silence would show as a fault every morning.
    const hourUtc = now.getUTCHours();
    if (hourUtc >= 6 && hourUtc <= 20 && sweepAgeMin !== null && sweepAgeMin > 30) {
      problems.push(`The deal brain has not judged anything for ${Math.round(sweepAgeMin)} minutes.`);
    }

    return { ok: problems.length === 0, problems };
  } catch {
    return { ok: null, problems: [] };
  }
}

/** The board columns a property deal can actually be in. The pipeline table
 *  also holds the VSL video funnel's columns (Rendering, Video sent, Watched
 *  video and the rest), and offering those as somewhere to move a house would
 *  be offering to break the board. */
const PROPERTY_STAGES = [
  'Booked', 'Discovery done, evaluating', 'Ready for call 2', 'Ballpark agreed',
  'Viewing booked', 'Offer sent', 'Waiting on their answer', 'Offer accepted',
  'Sent to investor', 'Deal closed', 'Follow up', 'Voicemail', 'No pickup',
  'Not interested', 'Nurturing',
];

// ---------------------------------------------------------------------------
// shaping
// ---------------------------------------------------------------------------

type Bundle = Awaited<ReturnType<typeof loadCockpitStates>>[number];

/** Which of these deals are waiting on Hugo, and since when.
 *
 *  WHY THIS EXISTS, and why it is a separate call rather than a column on the
 *  log read. wk_deal_manager_log_read hides rows flagged blocked_needs_hugo
 *  from anyone who is not an admin, which is right: Hugo's escalation lane
 *  holds his money reasoning and his proof of funds. But hiding the order left
 *  NOTHING in its place, so Pedro's cockpit silently fell back to the
 *  deterministic brief and printed "Hold, nothing today" on the best deal on
 *  the board (Zest Hull, 17 Aug, the card Hugo screenshotted).
 *
 *  The RPC is SECURITY DEFINER and deliberately returns a property id and a
 *  timestamp and nothing else. Pedro learns that the deal is alive and not his
 *  move. He does not learn why.
 *
 *  Never fatal: if this call fails the cockpit is exactly what it was before
 *  the function existed.
 */
async function blockedOnHugo(
  // The loose client type deal-manager-run.ts already uses. NOT
  // `ReturnType<typeof createClient>`: unparameterised, that resolves to a
  // client whose schema is `never`, so passing a real client to it is a type
  // error. It is the one shape behind every type error in api/ today.
  sb: SupabaseClient<any, any, any>, propertyIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!propertyIds.length) return out;
  try {
    const { data, error } = await (sb as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{
        data: Array<{ property_id: string; since: string }> | null;
        error: { message: string } | null;
      }>;
    }).rpc('wk_deals_blocked_on_hugo', { p_property_ids: propertyIds });
    if (error) {
      console.error('[cockpit] blocked-on-Hugo read failed', error.message);
      return out;
    }
    for (const row of data ?? []) out.set(row.property_id, row.since);
  } catch (e) {
    console.error('[cockpit] blocked-on-Hugo read threw', String(e).slice(0, 120));
  }
  return out;
}

function shapeDeal(
  bundle: Bundle, assessment: LogRow | null, now: Date, blockedSince?: string | null,
) {
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

  // WAITING ON HUGO, AND THE READER CANNOT SEE THE ORDER THAT SAYS SO.
  //
  // Only ever true for a non-admin, because an admin reads the real row and
  // `assessment` is the newer one. It is set when the newest decision on the
  // deal is Hugo's AND the newest row this caller can read is older than it,
  // which is precisely the case where the card would otherwise show a stale
  // brief and a "Hold, nothing today" button on a live deal.
  const hiddenOrder = Boolean(
    blockedSince
    && (!assessment || Date.parse(assessment.created_at ?? '') < Date.parse(blockedSince)),
  );

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
    confidence: (assessment?.confidence as 'high' | 'medium' | 'low' | null) ?? null,
    evidence: assessment?.evidence ?? fallback.evidence,
    source: (assessment?.source ?? 'fallback') as 'manager' | 'fallback',
    assessedAt: assessment?.created_at ?? null,
    stale,
    /** The deal is alive and the next move is Hugo's, told to a reader who is
     *  not allowed to see the order itself. The UI shows a "Hugo is on this
     *  one" card instead of an instruction, and drops the Hold button. */
    blockedOnHugo: hiddenOrder ? { since: blockedSince as string } : null,

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
    // The machine's own homework, so the gate can show "I ran the ballpark:
    // these numbers" instead of running anything live.
    ballpark: state.ballpark,
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
