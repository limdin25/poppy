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

/** The pipeline, spelled out. A stage may only produce the actions that stage
 *  already allows, which is what "without changing the process" means in code.
 *  An action outside the list is a validation error, and a validation error
 *  means fall back to the brief. The Manager cannot invent a step. */
export const ACTIONS_BY_STAGE: Record<string, string[]> = {
  'Discovery done, evaluating': ['wait_for_engine', 'chase_missing_fact', 'escalate_hugo'],
  'Ready for call 2': ['make_offer_call', 'chase_email_reply', 'rebook_followup'],
  'Ballpark agreed': ['send_offer_email', 'chase_written_confirmation'],
  'Needs viewing': ['book_builder', 'chase_video_for_builder', 'escalate_hugo'],
  'Offer sent': ['chase_the_answer', 'hold'],
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
  if (instruction.length > 600) {
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
  return {
    attention: state.followups.overdue ? 70 : state.clock.stale ? 50 : 20,
    action: 'hold',
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
