// A SECOND OPINION, ON THE MOVES THAT COST MONEY, AND NOWHERE ELSE.
//
// Hugo, 2026-08-17, choosing where a cheap second model should sit: "only on
// money decisions... a cheap second model re-checks the ballpark and every
// email carrying a figure, before a human can press send. Two models must
// agree or the press is blocked."
//
// ---------------------------------------------------------------------------
// WHY IT IS HERE AND NOT INSIDE THE STRESS TEST
// ---------------------------------------------------------------------------
//
// `deal-stress-test.ts` is PURE: no network, no clock, no model. That is what
// makes every fence in it testable and certain, and it is not being given up
// for this. The deterministic fences remain the real protection. They are the
// ones that know our ceiling never goes in writing, that every figure has to be
// on the file, and that call one carries no number at all.
//
// This is a belt on top of those braces. It runs AFTER the pure test has passed
// and BEFORE the press commits, and it answers one question a rule cannot:
// reading this like a person, does the money in it actually make sense against
// the file?
//
// ---------------------------------------------------------------------------
// IT FAILS OPEN, DELIBERATELY, AND SAYS SO
// ---------------------------------------------------------------------------
//
// If the model is down, slow, or answers rubbish, the press goes through and
// the fact is recorded. Failing closed would mean one provider outage stops
// every offer in the business, and it would be protecting a gap the
// deterministic fences already cover. An outage is not a reason to believe a
// deal is wrong.
//
// What DOES stop the business is a PATTERN: see `shouldBreak` below, which is
// the circuit breaker Hugo asked for.

// llm.js is imported LAZILY, inside auditMoneyMove. It builds a Supabase client
// at module load, so a static import would drag that into every consumer of the
// pure parts of this file (the breaker rule, the prompt builder, the move list)
// and make them untestable without live credentials. Pure things stay pure.
import type { DealState } from './deal-state.js';

/** Cheap on purpose. This is a second reader, not a second brain: the expensive
 *  model already made the decision and the deterministic fences already ran. */
export const AUDITOR_MODEL = 'claude-haiku-4-5-20251001';
const AUDITOR_MAX_TOKENS = 500;

/** The moves worth a second opinion: the ones where a wrong answer costs real
 *  money. Everything else (a call, a note, a comparison, a stage move) is
 *  either reversible or carries no figure. */
export const MONEY_MOVES = [
  'draft_offer_email', 'draft_counter_reply', 'send_email', 'fetch_ballpark',
] as const;

export interface MoneyVerdict {
  /** false = the auditor thinks this is wrong and the press should stop. */
  agrees: boolean;
  /** Why, in one plain sentence, shown verbatim to the human. */
  reason: string;
  /** The auditor could not be reached or could not be understood. `agrees` is
   *  true in that case (fail open) and this says which, so a run of them is
   *  visible rather than looking like a run of approvals. */
  unavailable?: string;
}

const SYSTEM = [
  'You are the SECOND pair of eyes on a property deal-sourcing move that involves money.',
  'A first model has already decided this, and a set of hard-coded rules has already passed it.',
  'Your ONLY job is to catch something both of them missed.',
  '',
  'You are NOT here to have an opinion about strategy, tone, or whether the price is a good one.',
  'Do not object because you would have negotiated differently. Do not object to wording.',
  'Do not object because information is missing: a fact nobody has yet is normal on these deals.',
  '',
  'Refuse ONLY for something a person would call a mistake in the money:',
  '  1. A figure in the text that contradicts the figures on the file.',
  '  2. A figure presented as ours that is ABOVE our own maximum for this house.',
  '  3. Arithmetic that does not add up, or a number that has clearly slipped a digit.',
  '  4. The text offering more than one different price for the same house.',
  '  5. A price put to the branch on a house the file says we have not valued at all.',
  '',
  'NOT a mistake: an attached proof of funds whose statement total is below the offer.',
  'The facts tell you how the purchase completes (statement funds plus a facility);',
  'that structure is the buyer\'s own design and is deliberately explained in the email.',
  '',
  'When in doubt, AGREE. A false alarm stops a real deal, and the hard-coded rules',
  'have already checked the things that can be checked exactly.',
  '',
  'Return ONLY a JSON object: {"agrees": true|false, "reason": "one short sentence"}',
].join('\n');

/** What the auditor is allowed to see. Deliberately just the money and the
 *  text: no transcript, no pinned note, no history. A second reader with the
 *  whole file would start second-guessing the decision instead of checking the
 *  arithmetic, which is the job the first model already did. */
export function auditorPrompt(args: {
  state: DealState; action: string; subject?: string | null; body?: string | null;
  proof?: { totalGbp?: number | null; fundingNote?: string | null } | null;
}): string {
  const m = args.state.money;
  return JSON.stringify({
    action: args.action,
    house: args.state.address,
    board_column: args.state.board.column,
    money_on_file: {
      asking: m.asking,
      our_opening_offer: m.open,
      our_maximum: m.ceiling,
      hugos_written_maximum: m.pinnedCeiling,
      // DealState.money carries no `cmv`: worth-today lives on the property
      // row, and tmv (worth done up, minus the works) is what this state holds.
      // Caught by the new api/ type check, which is the first thing that has
      // ever checked this directory.
      worth_done_up_minus_works: m.tmv,
      worth_done_up: m.gdv,
      works_cost: m.refurb,
      works_cost_is_a_stand_in: m.refurbAssumed,
      every_figure_legitimately_on_file: m.figuresOnFile,
    },
    // THE ATTACHMENT, when one is going. Its first live verdict (17 Aug,
    // twenty-three minutes after it shipped) blocked the Zest send for
    // "offer exceeds available liquidity by £1,529", which is not a mistake:
    // the statement total plus the bridging facility IS how every purchase
    // completes, and the reader had never been told. Same disease as the
    // email writer that morning: an executor missing part of the file.
    proof_of_funds_attached: args.proof
      ? {
        statement_total: args.proof.totalGbp ?? null,
        how_the_purchase_completes: args.proof.fundingNote
          ?? 'the statement funds together with a facility; a statement total below the offer is the designed structure, not a shortfall',
      }
      : null,
    text_about_to_be_sent: { subject: args.subject ?? '', body: args.body ?? '' },
  });
}

/** Ask the second model. NEVER throws: a failure is an approval plus a note. */
export async function auditMoneyMove(args: {
  state: DealState; action: string; subject?: string | null; body?: string | null;
  proof?: { totalGbp?: number | null; fundingNote?: string | null } | null;
}): Promise<MoneyVerdict> {
  let out = '';
  try {
    const { callLLM } = await import('./llm.js');
    out = await callLLM(
      AUDITOR_MODEL, SYSTEM,
      [{ role: 'user', content: auditorPrompt(args) }], AUDITOR_MAX_TOKENS,
    );
  } catch (e) {
    return { agrees: true, reason: '', unavailable: `error: ${String(e).slice(0, 100)}` };
  }
  if (!out.trim()) return { agrees: true, reason: '', unavailable: 'silent' };

  try {
    const match = out.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : out) as { agrees?: unknown; reason?: unknown };
    // Only an EXPLICIT false stops a press. Anything else is an approval, so a
    // model that answers in a shape we did not expect cannot block the business.
    if (parsed.agrees === false) {
      return { agrees: false, reason: String(parsed.reason ?? 'The second reader disagreed.').slice(0, 240) };
    }
    return { agrees: true, reason: String(parsed.reason ?? '').slice(0, 240) };
  } catch {
    return { agrees: true, reason: '', unavailable: 'unparseable' };
  }
}

// ---------------------------------------------------------------------------
// THE CIRCUIT BREAKER
// ---------------------------------------------------------------------------

/** How many disagreements inside the window before money moves stop. */
export const BREAKER_STRIKES = 3;
/** The window, in hours. */
export const BREAKER_WINDOW_HOURS = 24;

/** Should money moves be stopped altogether right now.
 *
 *  Hugo, 2026-08-17: "implement a circuit breaker if the AI detects a pattern
 *  of wrong offers or a heartbeat failure in the infrastructure."
 *
 *  ONE disagreement is a caught mistake, which is the system working and is
 *  worth nothing more than a blocked press. THREE inside a day is a pattern:
 *  either the file is wrong, the engine is wrong, or the drafting is wrong, and
 *  in every one of those cases the right move is to stop sending money out
 *  until a person has looked.
 *
 *  Pure, so it is testable without a database. The caller supplies the recent
 *  disagreement timestamps.
 */
export function shouldBreak(
  disagreementsAt: string[], now: Date,
): { broken: boolean; strikes: number } {
  const cutoff = now.getTime() - BREAKER_WINDOW_HOURS * 3_600_000;
  const strikes = disagreementsAt
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t) && t >= cutoff)
    .length;
  return { broken: strikes >= BREAKER_STRIKES, strikes };
}

/** The words the human sees when the breaker is open. Named here rather than
 *  written at the call site so the reason and the rule cannot drift apart. */
export function breakerMessage(strikes: number): string {
  return `Money moves are stopped. The second reader has disagreed ${strikes} times `
    + `in the last ${BREAKER_WINDOW_HOURS} hours, which is a pattern rather than a one off. `
    + 'Check the figures on these deals before any more money goes out, then clear the '
    + 'breaker in Settings.';
}
