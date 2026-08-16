// When the Deal Manager runs, what it is shown, and what gets written down.
//
// docs/AI_DEAL_MANAGER_PLAN.md sections 3 and 5. The brain itself lives in
// api/crm/deal-manager.ts and is imported, not re-implemented, so its fences
// come along with it.
//
// ---------------------------------------------------------------------------
// THE TRIGGERS, AND WHY NO EXISTING FILE HAD TO CHANGE
// ---------------------------------------------------------------------------
//
// The plan lists five moments a deal should be re-assessed. Every one of them
// already leaves a mark on a table this module reads, so a sweep that runs
// every couple of minutes and compares a hash sees all five for free:
//
//   Pedro presses an outcome  -> property-outcome.ts writes updated_at and
//                                rewrites brief, both of which are in the hash
//   A branch writes back      -> wk_sms_messages gains a row, so
//                                writing.lastInboundAt and replySinceBrief move
//   The overnight re-price    -> deal changes, so money.* moves
//   A follow-up comes due     -> followups.overdue flips from false to true
//   Nothing happened at all   -> the 07:30 full sweep, which is the one place
//                                silence itself is the trigger
//
// That is the whole reason this is additive: not one existing writer needed a
// line adding to tell the Manager something had happened.
//
// ---------------------------------------------------------------------------
// WHY THE HASH IS CANONICALISED FIRST
// ---------------------------------------------------------------------------
//
// DealState carries several `hoursSince...` floats rounded to one decimal, so
// they move every six minutes on their own. Hashing the state raw means nothing
// ever dedupes, every sweep re-assesses all 200 deals, and the daily budget is
// gone before 09:00 having learned nothing. hashableState drops them and keeps
// the facts, including `clock.stale`, so crossing the stale line DOES count as
// a change while the minutes ticking towards it do not.

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildDealState, type DealState, type DealStateInput } from './deal-state.js';
import { baselineAttention, deterministicFlags, fallbackVerdict, PROMPT_VERSION } from './deal-manager-contract.js';
import { matchBuildersForOutcode, type BuilderRow } from './builder-match.js';
import { outcodeOf } from './brrr-deal-facts.js';
import { isCockpitDeal } from './cockpit-filter.js';

/** Why an assessment ran. Mirrors the CHECK on wk_deal_manager_log.trigger. */
export type Trigger =
  | 'outcome_pressed' | 'inbound_message' | 'followup_due' | 'price_refresh'
  | 'morning_sweep' | 'sweep' | 'manual' | 'button';

export interface DealBundle {
  state: DealState;
  contactId: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  builderMatches: number;
}

/** How stale an assessment may get before the 07:30 sweep re-runs it even
 *  though nothing has changed. Twenty hours rather than twenty-four so a deal
 *  assessed at 07:31 yesterday is not skipped at 07:29 today. */
export const FORCE_REASSESS_HOURS = 20;

/** Defaults for platform_settings.deal_manager. Additive keys only: the
 *  existing reader in api/crm/deal-manager.ts try/catches to OFF, so an old
 *  row without them keeps working. */
export const MANAGER_DEFAULTS = {
  enabled: false,
  daily_cap: 250,
  /** LOWERED FROM 25 TO 8 ON 2026-08-15, measured on the live deployment
   *  rather than guessed, twice.
   *
   *  The first real sweep hit FUNCTION_INVOCATION_TIMEOUT at 25. Timed with a
   *  batch of one: about 8 seconds to load 179 deals, then about 5 seconds per
   *  assessment. A batch of 8 then timed out as well, because raising the token
   *  budget made each call think for longer. Running them side by side (see
   *  SWEEP_CONCURRENCY) is what actually fixed it; the small batch is the
   *  second belt.
   *
   *  It was never a throughput problem: 8 every two minutes through a working
   *  day is thousands of assessments of capacity against a daily cap of 250,
   *  and after hash dedupe a board this size needs a small fraction of that. */
  sweep_batch: 8,
  reassess_min_seconds: 60,
} as const;

/** How many assessments run side by side inside one sweep.
 *
 *  Four, so a batch of eight is two rounds rather than eight, which is what
 *  keeps the route inside its 60 second maxDuration. Deliberately not higher:
 *  the goal is fitting in the wall clock, not maximum speed, and a wide
 *  fan-out into the Anthropic API is how a sweep starts collecting 429s. */
export const SWEEP_CONCURRENCY = 4;

/** How long before a FAILED assessment is tried again on an unchanged deal.
 *
 *  Thirty minutes: long enough that a model having a bad minute does not turn
 *  into a retry loop against the daily cap, short enough that a deal is not
 *  stuck showing a fallback for the rest of the day. A refusal is normal
 *  operation, but a refusal that sticks forever is a card nobody can work. */
export const RETRY_REFUSAL_MINUTES = 30;

// ---------------------------------------------------------------------------
// pure: the hash
// ---------------------------------------------------------------------------

/** What the hash is taken over.
 *
 *  Everything here is a FACT that changing should cause a re-think. Everything
 *  left out is either a clock reading that drifts on its own, or free text long
 *  enough to make the hash move on a typo. */
export function hashableState(state: DealState): Record<string, unknown> {
  return {
    // Not a fact about the deal: a fact about the brain. A new prompt means
    // every old assessment was written by a different judge, so it re-runs.
    promptVersion: PROMPT_VERSION,
    status: state.status,
    column: state.board.column,
    movedAt: state.board.movedAt,
    money: {
      asking: state.money.asking, gdv: state.money.gdv, tmv: state.money.tmv,
      open: state.money.open, ceiling: state.money.ceiling, refurb: state.money.refurb,
      compsTier: state.money.compsTier,
      figures: [...state.money.figuresOnFile].sort((a, b) => a - b),
    },
    briefWrittenAt: state.brief.writtenAt,
    briefStep: state.brief.step,
    blockers: [...state.brief.blockers].sort(),
    pinnedNote: state.pinnedNote,
    calls: {
      count: state.calls.count,
      lastAt: state.calls.lastAt,
      lastOutcome: state.calls.lastOutcome,
      // Short, human-typed, and load-bearing: "call back monday" changing to
      // "offered 90k, call thursday" is a real change of instruction. The
      // TRANSCRIPT is deliberately NOT hashed: it is fixed once the call ends
      // and already represented by lastAt.
      lastNote: state.calls.lastNote,
    },
    writing: {
      lastInboundAt: state.writing.lastInboundAt,
      lastOutboundAt: state.writing.lastOutboundAt,
      replySinceBrief: state.writing.replySinceBrief,
    },
    followups: {
      nextDueAt: state.followups.nextDueAt,
      overdue: state.followups.overdue,
    },
    checklistMissing: [...state.checklist.missing].sort(),
    builder: { ...state.builder },
    pack: { ...state.pack },
    // The line itself, not the minutes approaching it.
    stale: state.clock.stale,
    // The machine's own homework arriving IS an event: the next sweep must
    // re-judge the deal into "confirm these numbers".
    ballpark: state.ballpark
      ? { ok: state.ballpark.ok, at: state.ballpark.at, open: state.ballpark.open, refusal: state.ballpark.refusal }
      : null,
  };
}

/** FNV-1a over the canonical state. Sixteen hex characters, which is far more
 *  than enough to tell two versions of one deal apart, and short enough to read
 *  in a log row. Written out rather than imported because api/ runs on edge as
 *  well as node and this must not depend on either one's crypto. */
export function stateHash(state: DealState): string {
  const json = stableStringify(hashableState(state));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < json.length; i += 1) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

/** Key order must not change the hash, or an object rebuilt in a different
 *  order looks like a changed deal and everything re-assesses forever. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// pure: when to spend money
// ---------------------------------------------------------------------------

export type AssessReason =
  | 'new_state' | 'forced_daily' | 'retry_refusal' | 'unchanged' | 'too_soon';

/** Should this deal be assessed right now?
 *
 *  Separated from the database so the spending rule can be tested without one.
 *  `mode` is the difference between the every-two-minutes sweep, which only
 *  looks at what changed, and the morning sweep, which also catches "nothing
 *  happened yesterday and that is the problem". */
export function shouldAssess(args: {
  hash: string;
  lastHash: string | null;
  lastAssessedAt: string | null;
  /** True when the last attempt FELL BACK rather than producing an
   *  instruction. See RETRY_REFUSAL_MINUTES for why this exists. */
  lastWasRefusal?: boolean;
  mode: 'event' | 'full';
  now: Date;
  minSeconds?: number;
}): { assess: boolean; why: AssessReason } {
  const { hash, lastHash, lastAssessedAt, mode, now } = args;
  const minSeconds = args.minSeconds ?? MANAGER_DEFAULTS.reassess_min_seconds;

  const sinceMs = lastAssessedAt ? now.getTime() - Date.parse(lastAssessedAt) : Infinity;

  // Never twice in a minute, whatever changed. A branch replying twice in ten
  // seconds is one event as far as an instruction is concerned.
  if (Number.isFinite(sinceMs) && sinceMs < minSeconds * 1000) {
    return { assess: false, why: 'too_soon' };
  }

  if (lastHash !== hash) return { assess: true, why: 'new_state' };

  // A REFUSAL IS NOT AN ANSWER, so it must not dedupe like one.
  //
  // Found on the live board 2026-08-15: the most urgent deal in the business
  // read "No instruction on file yet" because its one assessment came back as
  // unparseable JSON. The hash matched from then on, so the sweep skipped it as
  // "unchanged" and it would have kept that non-instruction until something
  // happened to the house or the 20 hour force came round. The card that most
  // needs a human is exactly the one that must not be left holding a fallback.
  if (args.lastWasRefusal && sinceMs > RETRY_REFUSAL_MINUTES * 60_000) {
    return { assess: true, why: 'retry_refusal' };
  }

  if (mode === 'full' && sinceMs > FORCE_REASSESS_HOURS * 3_600_000) {
    return { assess: true, why: 'forced_daily' };
  }

  return { assess: false, why: 'unchanged' };
}

/** Is it time for the once-a-day sweep over everything?
 *
 *  07:30 UK, before the shift starts, and once only: the every-two-minutes
 *  route asks this on every run, so without the "already done today" half it
 *  would fire fifteen times in half an hour. */
export function shouldRunFullSweep(now: Date, lastFullAt: string | null): boolean {
  const { hour, minute, day } = ukParts(now);
  const withinWindow = hour === 7 && minute >= 30;
  if (!withinWindow) return false;
  if (!lastFullAt) return true;
  const last = new Date(Date.parse(lastFullAt));
  if (Number.isNaN(last.getTime())) return true;
  return ukParts(last).day !== day;
}

/** UK wall clock, so British Summer Time is handled by the platform rather
 *  than by an offset somebody has to remember to change twice a year. */
function ukParts(d: Date): { hour: number; minute: number; day: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    day: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// ---------------------------------------------------------------------------
// the log row
// ---------------------------------------------------------------------------

export interface LogRow {
  id?: string;
  /** NULL for sweep-level events that are nobody's deal in particular. */
  property_id: string | null;
  contact_id?: string | null;
  kind: 'assessment' | 'fallback_refused' | 'action_executed' | 'action_blocked' | 'human_note';
  trigger?: Trigger | null;
  action?: string | null;
  who?: string | null;
  attention?: number | null;
  instruction?: string | null;
  confidence?: string | null;
  flags?: string[];
  evidence?: string[];
  board_column?: string | null;
  state_hash?: string | null;
  state?: unknown;
  source?: 'manager' | 'fallback' | 'human';
  refused_reason?: string | null;
  model?: string | null;
  latency_ms?: number | null;
  checks?: unknown;
  blocked?: boolean;
  actor_id?: string | null;
  executed_by?: 'server' | 'client' | null;
  result?: unknown;
  note?: string | null;
  created_at?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

/** Write one event. NEVER THROWS.
 *
 *  A logging failure must not be able to break a press. The whole point of the
 *  cockpit is that a human can act; losing the note about it is a smaller
 *  problem than a button that errors. */
export async function logEvent(sb: Sb, row: LogRow): Promise<void> {
  try {
    await (sb.from('wk_deal_manager_log') as any).insert(row);
  } catch (e) {
    console.warn('[deal-manager-run] could not log', String(e).slice(0, 200), row.property_id);
  }
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

interface CockpitRow {
  property_id: string;
  address: string | null;
  status: string | null;
  asking_price: number | null;
  bedrooms: number | null;
  deal: Record<string, unknown> | null;
  brief: Record<string, unknown> | null;
  pinned_note: string | null;
  qualification: Record<string, unknown> | null;
  floorplan_urls: unknown;
  assigned_builder_id: string | null;
  viewing_at: string | null;
  viewing_quote: number | null;
  property_updated_at: string | null;
  listing_url: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  custom_fields: Record<string, string> | null;
  stage_moved_at: string | null;
  last_contact_at: string | null;
  column_name: string | null;
  calls: DealStateInput['calls'];
  messages: DealStateInput['messages'];
  followups: DealStateInput['followups'];
  last_conversation: DealStateInput['lastConversation'];
  ballpark_preview: DealStateInput['ballparkPreview'];
}

function bundleFrom(row: CockpitRow, builders: BuilderRow[], now: Date): DealBundle {
  const matches = matchBuildersForOutcode(builders, outcodeOf(row.address ?? ''));
  const state = buildDealState({
    property: {
      id: row.property_id,
      address: row.address,
      status: row.status,
      asking_price: row.asking_price,
      bedrooms: row.bedrooms,
      deal: row.deal,
      brief: row.brief,
      pinned_note: row.pinned_note,
      qualification: row.qualification,
      assigned_builder_id: row.assigned_builder_id,
      viewing_at: row.viewing_at,
      viewing_quote: row.viewing_quote,
      updated_at: row.property_updated_at,
      floorplan_urls: row.floorplan_urls,
    },
    contact: row.contact_id
      ? {
        id: row.contact_id,
        name: row.contact_name,
        phone: row.contact_phone,
        email: row.contact_email,
        custom_fields: row.custom_fields,
        stage_moved_at: row.stage_moved_at,
        last_contact_at: row.last_contact_at,
      }
      : null,
    columnName: row.column_name,
    calls: row.calls ?? [],
    messages: row.messages ?? [],
    followups: row.followups ?? [],
    lastConversation: row.last_conversation ?? null,
    ballparkPreview: row.ballpark_preview ?? null,
    builderMatches: matches,
    now,
  });
  return {
    state,
    contactId: row.contact_id,
    contactName: row.contact_name,
    email: row.contact_email,
    phone: row.contact_phone,
    builderMatches: matches.length,
  };
}

async function loadBuilders(sb: Sb): Promise<BuilderRow[]> {
  const { data } = await (sb.from('brrr_builders') as any)
    .select('id, name, phone, email, coverage, active');
  return ((data ?? []) as BuilderRow[]).map((b) => ({
    ...b, coverage: Array.isArray(b.coverage) ? b.coverage : [],
  }));
}

/** Every live deal, in one round trip.
 *
 *  The RPC does the joins. The old shape (one property at a time, five queries
 *  each, up to 400 properties) is fine for a panel somebody refreshes by hand
 *  and hopeless for a page they sit in all day. */
export async function loadCockpitStates(
  sb: Sb, opts: { limit?: number; now: Date },
): Promise<DealBundle[]> {
  const [{ data, error }, builders] = await Promise.all([
    (sb.rpc as any)('wk_deal_cockpit_rows', { p_limit: opts.limit ?? 200 }),
    loadBuilders(sb),
  ]);
  // THROW, never an empty list. A broken query that returns [] is
  // indistinguishable from a quiet board: the cockpit would show "nothing
  // waiting" and the sweep would judge nothing, both wearing a green tick
  // (16 Aug audit, silent-failure class). A thrown error 500s the page and
  // reddens the cron, which is the truth.
  if (error) {
    throw new Error(`wk_deal_cockpit_rows failed: ${error.message}`);
  }
  return ((data ?? []) as CockpitRow[]).map((r) => bundleFrom(r, builders, opts.now));
}

/** One deal. Same RPC, filtered in memory rather than adding a second function
 *  to keep in step with the first. */
export async function loadDealBundle(
  sb: Sb, propertyId: string, now: Date,
): Promise<DealBundle | null> {
  const all = await loadCockpitStates(sb, { limit: 400, now });
  return all.find((b) => b.state.propertyId === propertyId) ?? null;
}

/** The newest assessment for each of these properties.
 *
 *  Pass the CALLER's client, not the service role, when this feeds a page: RLS
 *  is what keeps Hugo's escalation lane out of Pedro's history column. */
export async function latestAssessments(
  sb: Sb, propertyIds: string[],
): Promise<Map<string, LogRow>> {
  const out = new Map<string, LogRow>();
  if (!propertyIds.length) return out;
  const { data, error } = await (sb.from('wk_deal_manager_log') as any)
    .select('*')
    .in('property_id', propertyIds)
    .in('kind', ['assessment', 'fallback_refused'])
    .order('created_at', { ascending: false })
    .limit(propertyIds.length * 4);
  // Loud, not a silent all-fallback board (every card would quietly show its
  // deterministic brief as if the brain had never spoken).
  if (error) throw new Error(`wk_deal_manager_log read failed: ${error.message}`);
  for (const row of (data ?? []) as LogRow[]) {
    if (!out.has(row.property_id)) out.set(row.property_id, row);
  }
  return out;
}

/** The whole history of one deal, newest first, for the cockpit's right-hand
 *  column. Caller's client again, for the same reason. */
export async function dealLog(sb: Sb, propertyId: string, limit = 60): Promise<LogRow[]> {
  const { data } = await (sb.from('wk_deal_manager_log') as any)
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as LogRow[];
}

// ---------------------------------------------------------------------------
// running the brain, and writing down what it said
// ---------------------------------------------------------------------------

/** Assess one deal and log the result whichever way it went.
 *
 *  `assess` is imported from the route so there is one brain, one prompt and
 *  one set of fences. A refusal is normal operation: the deterministic brief
 *  stands, and the reason is written down so a PATTERN of the same refusal is
 *  visible rather than a single event being alarming. */
export async function assessAndLog(
  sb: Sb,
  args: {
    bundle: DealBundle;
    trigger: Trigger;
    hash: string;
    assess: (s: DealState) => Promise<{
      verdict: { attention: number; action: string; who: string; instruction: string; flags: string[]; evidence: string[] };
      source: 'manager' | 'fallback';
      refused?: string;
    }>;
    model?: string;
  },
): Promise<LogRow> {
  const { bundle, trigger, hash } = args;
  const started = Date.now();

  let result: Awaited<ReturnType<typeof args.assess>>;
  try {
    result = await args.assess(bundle.state);
  } catch (e) {
    result = {
      verdict: fallbackVerdict(bundle.state),
      source: 'fallback',
      refused: `threw: ${String(e).slice(0, 120)}`,
    };
  }

  const row: LogRow = {
    property_id: bundle.state.propertyId,
    contact_id: bundle.contactId,
    kind: result.source === 'manager' ? 'assessment' : 'fallback_refused',
    trigger,
    action: result.verdict.action,
    who: result.verdict.who,
    attention: Math.max(result.verdict.attention, baselineAttention(bundle.state)),
    instruction: result.verdict.instruction,
    confidence: result.verdict.confidence ?? null,
    flags: [...new Set([...result.verdict.flags, ...deterministicFlags(bundle.state)])],
    evidence: result.verdict.evidence,
    board_column: bundle.state.board.column,
    state_hash: hash,
    state: bundle.state,
    source: result.source,
    refused_reason: result.refused ?? null,
    model: args.model ?? null,
    latency_ms: Date.now() - started,
  };

  await logEvent(sb, row);
  return row;
}

export interface SweepResult {
  mode: 'event' | 'full';
  considered: number;
  assessed: number;
  deduped: number;
  capped: boolean;
  failed: number;
  spentToday: number;
  /** Why each considered deal was or was not assessed. Always collected (it
   *  is thirteen small objects); the cron only RETURNS it on ?debug=1. */
  decisions?: Array<{
    propertyId: string;
    address: string | null;
    why: string;
    hash: string;
    lastHash: string | null;
    lastKind: string | null;
    lastAt: string | null;
  }>;
}

/** How many assessments have been paid for since midnight UK. */
export async function spentToday(sb: Sb, now: Date): Promise<number> {
  const midnight = ukMidnightIso(now);
  // NOT `head: true`. A head request answers with the count in a Content-Range
  // header, and on the edge runtime that header does not survive back to the
  // client: `count` came through as null and spentToday read 0 with 40 real
  // assessments on the table for that day. Measured 2026-08-15, and it is the
  // second time this cap has quietly read zero, so it is worth being blunt
  // about: A DAILY CAP THAT CANNOT COUNT IS NOT A CAP.
  //
  // A counted select with limit 1 returns the same number in the body, costs
  // one row, and works everywhere.
  const { count, error } = await (sb.from('wk_deal_manager_log') as any)
    .select('id', { count: 'exact' })
    .eq('kind', 'assessment')
    .gte('created_at', midnight)
    .limit(1);
  if (error || count === null || count === undefined) {
    // Fail CLOSED: if we cannot tell what has been spent, assume the cap is
    // gone rather than spending against a number we do not have.
    console.warn('[deal-manager-run] could not count today\'s spend', error?.message);
    return Number.MAX_SAFE_INTEGER;
  }
  return count;
}

/** The exact UTC instant of midnight tonight, UK time.
 *
 *  THE NAIVE VERSION WAS WRONG AND THE CAP WAS THE THING IT BROKE. It returned
 *  `${ukDay}T00:00:00Z`, treating a UK date as if it were a UTC one. Measured
 *  on the live board at 23:14 UTC, which is 00:14 on the NEXT day in British
 *  Summer Time: it produced a boundary an hour in the FUTURE, so the query
 *  counted nothing and `spentToday` read 0 with 58 assessments on the table.
 *  A daily cap that silently reads zero is not a cap.
 *
 *  So the offset is asked for rather than assumed. On the two days a year the
 *  clocks change this can be an hour out for the part of the day either side of
 *  the transition, which is a rounding error on a budget and not worth a date
 *  library to avoid. */
function ukMidnightIso(now: Date): string {
  const { day } = ukParts(now);
  const offset = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', timeZoneName: 'longOffset',
  }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  // "GMT+01:00" in summer, "GMT" or "GMT+00:00" in winter.
  const sign = offset.replace('GMT', '').trim() || '+00:00';
  const t = Date.parse(`${day}T00:00:00${sign}`);
  return Number.isNaN(t) ? `${day}T00:00:00.000Z` : new Date(t).toISOString();
}

/** Exported so the boundary can be checked without a database in front of it. */
export const ukDayStartIso = ukMidnightIso;

/** One pass over the board.
 *
 *  Ranked by what code is certain about, so with the brain switched off, capped
 *  or broken, the order the cockpit shows is still the right order. That is the
 *  fifth gap closed on its own: the nightly assign script orders the queue once,
 *  and during the day overdue follow-ups, fresh branch replies and booked call
 *  twos all compete. */
export async function sweep(
  sb: Sb,
  args: {
    now: Date;
    mode: 'event' | 'full';
    assess: Parameters<typeof assessAndLog>[1]['assess'];
    dailyCap?: number;
    batch?: number;
    concurrency?: number;
    minSeconds?: number;
    model?: string;
  },
): Promise<SweepResult> {
  const cap = args.dailyCap ?? MANAGER_DEFAULTS.daily_cap;
  const batch = args.batch ?? MANAGER_DEFAULTS.sweep_batch;

  const spent = await spentToday(sb, args.now);
  const base: SweepResult = {
    mode: args.mode, considered: 0, assessed: 0, deduped: 0,
    capped: false, failed: 0, spentToday: spent,
  };

  if (spent >= cap) {
    // Fail closed and LOUDLY, but exactly once: a cap that logged per deal
    // would flood the very history it is trying to protect.
    await logEvent(sb, {
      // NULL, not a placeholder uuid. This event is about the sweep, not about
      // any one house, and the all-zeroes id used here first failed the foreign
      // key silently, so the cap fired and said nothing at all.
      property_id: null,
      kind: 'fallback_refused',
      trigger: args.mode === 'full' ? 'morning_sweep' : 'sweep',
      source: 'fallback',
      refused_reason: 'budget_capped',
      instruction: `The day's assessment budget of ${cap} is spent. `
        + 'Every card is showing its deterministic brief, which is the product as it was before any of this.',
    }).catch(() => undefined);
    return { ...base, capped: true };
  }

  // ONLY DEALS. A branch nobody has reached is a phone number for the dialer,
  // and paying a model to write an instruction about it is paying to be told
  // "ring them", which the calling list already knows. On the live board this
  // is the difference between assessing 179 and assessing 35.
  const all = await loadCockpitStates(sb, { limit: 400, now: args.now });
  const bundles = all.filter((b) => isCockpitDeal(b.state).inCockpit);
  base.considered = bundles.length;

  const priorities = await latestAssessments(sb, bundles.map((b) => b.state.propertyId));

  const ranked = bundles
    .map((bundle) => ({ bundle, hash: stateHash(bundle.state), score: baselineAttention(bundle.state) }))
    .sort((a, b) => b.score - a.score);

  // ---- decide who gets looked at, before spending anything -------------
  let deduped = 0;
  const due: Array<{ bundle: DealBundle; hash: string }> = [];
  const decisions: NonNullable<SweepResult['decisions']> = [];
  for (const { bundle, hash } of ranked) {
    if (due.length >= Math.min(batch, Math.max(0, cap - spent))) break;
    const last = priorities.get(bundle.state.propertyId) ?? null;
    const decision = shouldAssess({
      hash,
      lastHash: last?.state_hash ?? null,
      lastAssessedAt: last?.created_at ?? null,
      lastWasRefusal: last?.kind === 'fallback_refused',
      mode: args.mode,
      now: args.now,
      minSeconds: args.minSeconds,
    });
    // Kept per property so the cron's ?debug=1 can say WHY each deal was or
    // was not looked at. Built after an evening spent inferring this from the
    // outside while a written rejection sat behind a "deduped: 13".
    decisions.push({
      propertyId: bundle.state.propertyId,
      address: bundle.state.address,
      why: decision.why,
      hash,
      lastHash: last?.state_hash ?? null,
      lastKind: last?.kind ?? null,
      lastAt: last?.created_at ?? null,
    });
    if (decision.assess) due.push({ bundle, hash });
    else deduped += 1;
  }
  if (spent + due.length >= cap) base.capped = true;

  // ---- assess them SIDE BY SIDE ----------------------------------------
  //
  // MEASURED, NOT ASSUMED. Doing these one after another timed the route out
  // twice on the live deployment: each assessment is a Sonnet call that thinks
  // before it answers, so eight of them in a row is well past the 60 second
  // maxDuration however small the batch gets. They are independent API calls
  // about different houses, so there was never a reason to queue them.
  //
  // The pool is small on purpose. The point is fitting inside the route's
  // wall clock, not going as fast as possible, and a wide fan-out into the
  // Anthropic API is how a sweep starts collecting 429s.
  const concurrency = Math.min(args.concurrency ?? SWEEP_CONCURRENCY, due.length);
  let assessed = 0;
  let failed = 0;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= due.length) return;
      const { bundle, hash } = due[i];
      try {
        await assessAndLog(sb, {
          bundle,
          trigger: args.mode === 'full' ? 'morning_sweep' : 'sweep',
          hash,
          assess: args.assess,
          model: args.model,
        });
        assessed += 1;
      } catch (e) {
        // One bad property must never stop the run.
        failed += 1;
        console.warn('[deal-manager-run] deal failed', bundle.state.propertyId, String(e).slice(0, 160));
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  return { ...base, assessed, deduped, failed, decisions };
}
