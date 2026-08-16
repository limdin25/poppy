// What the Deal Manager is allowed to say, and what happens when it says
// something else.
//
// Layer 2 of docs/AI_DEAL_MANAGER_PLAN.md. Pure, so every fence is testable
// without a network call.
//
// THE ONE RULE THE WHOLE DESIGN HANGS ON:
//
//   The AI decides attention and words. Code decides money and moves.
//
// The Manager may decide WHICH deal Pedro looks at next, WHAT the instruction
// says, and WHEN somebody is nudged. It may NEVER move a card, send anything,
// name a figure that is not already on the file, or override the deterministic
// brief. Those four stay with the code and the humans, behind fences that
// already exist.
//
// And the deterministic brief is the FALLBACK. If the Manager is down, wrong,
// rate-limited or switched off, the product is exactly what it is today. That
// is the safety story in one sentence: turning the Manager off changes nothing
// except that Pedro is managed by Hugo again.

import type { DealState } from './deal-state.js';
import { figuresAreOnFile } from './deal-state.js';

/** The version of the brain's prompt (DEAL_MANAGER_SYSTEM in deal-brain.ts).
 *  Folded into the state hash by deal-manager-run.ts, so bumping it makes
 *  every cached assessment look stale and the whole board is re-judged on the
 *  next sweep. Bump it whenever the prompt changes in a way the cards should
 *  reflect; without the bump, a rewrite sits invisible until each deal happens
 *  to change on its own. It lives here, not beside the prompt, because the
 *  hash module must never import the LLM.
 *
 *  v2, 2026-08-16: the instruction became an ORDER, 2 short sentences max
 *  (Hugo: "small texts... just tell exactly what the intelligence is asking
 *  us to do").
 *  v3, 2026-08-16 evening: the brain got ears. The transcript of the newest
 *  recorded call is ground truth, a callback note is an appointment, and the
 *  two-call process (discovery, then get_the_ballpark, then call two at the
 *  agreed time) is spelled out. Found on Paterson Road: it ordered Pedro to
 *  re-ring on a Sunday and re-ask twelve questions he had spent twelve
 *  recorded minutes asking, because the checklist was never typed up and the
 *  checklist was all it could see. */
export const PROMPT_VERSION = 3;

/** The pipeline, spelled out. A stage may only produce the actions that stage
 *  already allows, which is what "without changing the process" means in code.
 *  An action outside the list is a validation error, and a validation error
 *  means fall back to the brief. The Manager cannot invent a step. */
export const ACTIONS_BY_STAGE: Record<string, string[]> = {
  // get_the_ballpark IS the homework of the two-call process: it hears the
  // discovery call, extracts the facts, asks the engine, and arms call two.
  // Added 2026-08-16 when the brain, blind to the transcript, kept ordering
  // another discovery call instead of the pricing that should follow one.
  'Discovery done, evaluating': ['get_the_ballpark', 'wait_for_engine', 'chase_missing_fact', 'escalate_hugo'],
  'Ready for call 2': ['make_offer_call', 'chase_email_reply', 'rebook_followup'],
  'Ballpark agreed': ['send_offer_email', 'chase_written_confirmation'],
  'Needs viewing': ['book_builder', 'chase_video_for_builder', 'escalate_hugo'],
  // reply_with_counter: the branch answered our offer with a no or a number,
  // and the reply IS a money move, so it maps to the counter button whose
  // stress test runs decideCounter and the ceiling fences before anything is
  // written. Added 16 Aug: the vendors rejected Orion Way in writing and the
  // brain had no action that could order the reply.
  'Offer sent': ['reply_with_counter', 'chase_the_answer', 'hold'],
  'Offer accepted': ['assemble_investor_pack', 'chase_written_acceptance'],
  'Sent to investor': ['chase_investor', 'hold'],
  'Deal closed': ['hold'],
  Nurturing: ['chase_the_answer', 'rebook_followup', 'hold'],
};

/** Allowed from ANY stage: the card's column disagrees with the evidence. */
export const UNIVERSAL_ACTIONS = ['flag_mismatch', 'hold'] as const;

/** Closed list. A flag outside it is a validation error. */
export const FLAGS = [
  'stale_no_touch', 'reply_unread', 'figure_mismatch', 'stage_mismatch',
  'overdue_followup', 'price_cut_on_known_branch', 'blocked_needs_hugo',
  'pack_incomplete',
] as const;

export const WHO = ['PEDRO', 'HUGO', 'VA', 'NOBODY'] as const;

export interface ManagerVerdict {
  attention: number;
  action: string;
  who: (typeof WHO)[number];
  instruction: string;
  flags: string[];
  evidence: string[];
}

export type ValidationResult =
  | { ok: true; verdict: ManagerVerdict }
  | { ok: false; reason: string; detail: string };

/** Every action legal for this deal right now. */
export function allowedActions(columnName: string | null | undefined): string[] {
  const stage = ACTIONS_BY_STAGE[(columnName ?? '').trim()] ?? [];
  return [...new Set([...stage, ...UNIVERSAL_ACTIONS])];
}

/** Check the Manager's answer against every fence.
 *
 *  Returns a reason rather than throwing, because the caller's response to any
 *  failure is the same and is never an error page: use the deterministic
 *  brief, log what was refused, carry on.
 */
export function validateVerdict(raw: unknown, state: DealState): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'not_an_object', detail: 'the model did not answer with an object' };
  }
  const v = raw as Record<string, unknown>;

  const attention = Number(v.attention);
  if (!Number.isFinite(attention) || attention < 0 || attention > 100) {
    return { ok: false, reason: 'bad_attention', detail: `attention was ${String(v.attention)}` };
  }

  const action = String(v.action ?? '').trim();
  const legal = allowedActions(state.board.column);
  if (!legal.includes(action)) {
    return {
      ok: false, reason: 'action_not_allowed',
      detail: `${action || '(none)'} is not legal in ${state.board.column ?? '(no column)'}`,
    };
  }

  const who = String(v.who ?? '').trim() as (typeof WHO)[number];
  if (!WHO.includes(who)) {
    return { ok: false, reason: 'bad_who', detail: `who was ${String(v.who)}` };
  }

  const instruction = String(v.instruction ?? '').trim();
  if (!instruction) {
    return { ok: false, reason: 'no_instruction', detail: 'the instruction was empty' };
  }
  // 320, not 600: Hugo, 16 Aug, "small texts, I don't want to know so much
  // details". The instruction is an order of at most 2 short sentences; the
  // model is told so in as many words, and this is the backstop when it
  // rambles anyway. Detail belongs in `evidence`, which the history renders.
  if (instruction.length > 320) {
    return { ok: false, reason: 'instruction_too_long', detail: `${instruction.length} characters` };
  }

  // THE FIGURE FENCE. A number the Manager named that is not already on the
  // file was invented, and an offer said out loud cannot be unsaid.
  if (!figuresAreOnFile(instruction, state)) {
    return {
      ok: false, reason: 'invented_figure',
      detail: 'the instruction names a figure that is not on the deal file',
    };
  }

  // Hugo's rule, enforced rather than remembered.
  if (/[–—]/.test(instruction)) {
    return { ok: false, reason: 'long_dash', detail: 'the instruction contains a long dash' };
  }

  const flags = Array.isArray(v.flags) ? v.flags.map(String) : [];
  const badFlag = flags.find((f) => !(FLAGS as readonly string[]).includes(f));
  if (badFlag) {
    return { ok: false, reason: 'unknown_flag', detail: `${badFlag} is not a flag` };
  }

  const evidence = Array.isArray(v.evidence) ? v.evidence.map(String) : [];

  return {
    ok: true,
    verdict: { attention: Math.round(attention), action, who, instruction, flags, evidence },
  };
}

/** What the card says when the Manager is off, down, or refused.
 *
 *  This is the product as it exists today: the deterministic brief, unchanged.
 *  Never an error, never a blank card. */
export function fallbackVerdict(state: DealState): ManagerVerdict {
  const instruction = state.pinnedNote?.trim()
    || state.brief.doNow[0]
    || 'No instruction on file yet. Open the deal and decide the next step.';

  // THE FALLBACK MUST NEVER SUGGEST HOLDING THROUGH AN UNANSWERED REPLY.
  // Seen on Orion Way, 16 Aug: the vendors' rejection was on the card, the
  // model happened to be silent, and the primary button read "Hold, nothing
  // today". A branch that wrote to us gets a reply-shaped action if the stage
  // allows one; 'hold' is only ever the answer when nothing is waiting.
  const legal = allowedActions(state.board.column);
  const action = state.writing.replySinceBrief
    ? (['reply_with_counter', 'chase_email_reply', 'chase_the_answer']
      .find((a) => legal.includes(a)) ?? 'hold')
    : 'hold';

  return {
    attention: state.followups.overdue ? 70 : state.clock.stale ? 50 : 20,
    action,
    who: 'PEDRO',
    instruction,
    flags: deterministicFlags(state),
    evidence: ['brief.do_now', 'pinned_note'],
  };
}

/** The flags code can be certain about without asking a model anything.
 *
 *  These are computed, not judged, so they are true whether the Manager runs
 *  or not, and they are what the morning sweep sorts on when it is off. */
export function deterministicFlags(state: DealState): string[] {
  const out: string[] = [];
  if (state.writing.replySinceBrief) out.push('reply_unread');
  if (state.followups.overdue) out.push('overdue_followup');
  if (state.clock.stale) out.push('stale_no_touch');
  return out;
}

/** How badly this deal wants a human today, computed rather than judged.
 *
 *  The Manager may re-rank within reason, but this is the floor: a branch that
 *  has written to us and been ignored outranks everything, because that is the
 *  one that was actually costing money. */
export function baselineAttention(state: DealState): number {
  let score = 10;
  if (state.writing.replySinceBrief) score += 60;
  if (state.followups.overdue) score += 25;
  if (state.clock.stale) score += 15;
  if (state.brief.blockers.length) score += 10;
  if (state.pinnedNote) score += 5;
  return Math.min(100, score);
}
