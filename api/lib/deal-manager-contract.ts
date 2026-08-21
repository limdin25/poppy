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
 *  checklist was all it could see.
 *  v4, 2026-08-16 night: THE BRAIN DECIDES. Hugo: "I want the AI to run the
 *  business. You have to decide for me." The instruction is a decision, never
 *  a question handed back; who=HUGO only for what Hugo alone can physically
 *  produce. Plus refurbAssumed (a provisional band never climbs and never
 *  ships) and pinnedCeiling (Hugo's written ruling governs).
 *  v5, 2026-08-16 late: THE APPROVAL DESK. The machine runs the ballpark
 *  itself (ballpark-runner cron); when `ballpark.ran` the decision is
 *  confirm_ballpark presenting the numbers and the callback, never an order
 *  to go and fetch them. Verdicts carry `confidence`.
 *  v6, 2026-08-16: THE THREE ROADS. After call one a deal goes exactly one
 *  of three ways (reply to an email, lost, or ready for call two), close_lost
 *  became universal so the brain can order a door shut (Hunters: "mark the
 *  deal dead" had no button), and Waiting on their answer joined the board.
 *  v7, 2026-08-17: HOLD STOPS BEING THE DUSTBIN. escalate_hugo is universal,
 *  rule 3b forbids hold when the instruction is an order, and hold with
 *  who=HUGO is repaired to escalate_hugo instead of being thrown away. Found
 *  on Zest Hull: eight correct assessments in a row ("Email Pedro your bank
 *  statement", who=HUGO) all rendered as "Hold, nothing today", because the
 *  one verb that fitted was not legal in Nurturing.
 *  v8, 2026-08-17: THREE ROADS AFTER CALL TWO as well (rule 20). Hugo: "after
 *  2nd call same thing, tell us if lost and or we should book a builder."
 *  book_builder joined 'Ballpark agreed'; it had been legal only in Needs
 *  viewing, and nothing moves a card there on its own, so the builder road was
 *  unreachable from the column deals actually land in.
 *  v9, 2026-08-17 evening: THE BRIDGE IS HOW WE BUY (rules 21 and 22). Zest
 *  Hull again: the branch wrote back that our proof of funds fell short of the
 *  103,600 offer, and the brain agreed with her and ordered Hugo to produce a
 *  replacement statement covering the full amount. Our own email had explained
 *  the structure two paragraphs earlier, company accounts plus a bridging
 *  facility, and the brain never saw that sentence because the thread cap cut
 *  it off mid word. The cap is fixed in deal-state.ts; these rules are the
 *  other half, so a brain that CAN see our email is also told the money in it
 *  was never short.
 *  v10, 2026-08-17 night: AND THEN WHAT (rules 20b, 20c). Hugo, on Stanks
 *  Drive: "it doesn't tell me what should I do next. Should we just reply and
 *  stop? Reply and wait, reply and call back on a second call and put the
 *  ballpark. What is it?" Every order that ends in a reply, an email or a call
 *  now names the step after it, and `reply_to_their_email` became a universal
 *  action because a branch asking us seven questions during discovery could
 *  only be filed under escalate_hugo: the card read "reply with them today"
 *  above a blue button reading "Send it to Hugo".
 *  v11, 2026-08-18: A VIEWING IS NEVER FREE (rule 20d). Zest asked for a
 *  viewing before putting our offer to the vendor and the draft agreed to it
 *  while restating our maximum, which spends a builder's day on a figure
 *  nobody has said is close AND puts our ceiling in writing. Hugo: "yes we can
 *  arrange a viewing, that's not a problem. However can you just confirm that
 *  we are within the ballpark? I don't want to waste your time and our time."
 *  Both halves, and never our figure again. */
export const PROMPT_VERSION = 11;

/** The pipeline, spelled out. A stage may only produce the actions that stage
 *  already allows, which is what "without changing the process" means in code.
 *  An action outside the list is a validation error, and a validation error
 *  means fall back to the brief. The Manager cannot invent a step. */
export const ACTIONS_BY_STAGE: Record<string, string[]> = {
  // get_the_ballpark IS the homework of the two-call process: it hears the
  // discovery call, extracts the facts, asks the engine, and arms call two.
  // Added 2026-08-16 when the brain, blind to the transcript, kept ordering
  // another discovery call instead of the pricing that should follow one.
  // confirm_ballpark: the machine ALREADY ran the homework (ballpark-runner)
  // and the decision is to confirm those numbers and book Pedro's callback.
  // get_the_ballpark remains the order while the run has not happened yet.
  'Discovery done, evaluating': ['confirm_ballpark', 'get_the_ballpark', 'wait_for_engine', 'chase_missing_fact', 'escalate_hugo'],
  'Ready for call 2': ['make_offer_call', 'chase_email_reply', 'rebook_followup'],
  // THE THREE ROADS AFTER CALL TWO (2026-08-17). Hugo: "after 2nd call same
  // thing, tell us if lost and or we should book a builder."
  //
  // Call two ends with a figure agreed, and from there a deal goes exactly one
  // of three ways: the offer goes out, a builder goes round to price the work
  // properly first, or it is lost. `close_lost` is universal so the third road
  // always exists. 'Viewing booked' (renamed from 'Needs viewing' on 19 Aug)
  // is reached by the builder-confirm press in api/lib/builder-outreach.ts, so
  // a card in it has a builder booked onto the viewing already.
  'Ballpark agreed': ['send_offer_email', 'book_builder', 'chase_written_confirmation'],
  'Viewing booked': ['book_builder', 'chase_video_for_builder', 'escalate_hugo'],
  // reply_with_counter: the branch answered our offer with a no or a number,
  // and the reply IS a money move, so it maps to the counter button whose
  // stress test runs decideCounter and the ceiling fences before anything is
  // written. Added 16 Aug: the vendors rejected Orion Way in writing and the
  // brain had no action that could order the reply.
  'Offer sent': ['reply_with_counter', 'chase_the_answer', 'hold'],
  'Offer accepted': ['assemble_investor_pack', 'chase_written_acceptance'],
  'Sent to investor': ['chase_investor', 'hold'],
  'Deal closed': ['hold'],
  // reply_with_counter here too: Orion Way was parked in Nurturing when the
  // vendors' written rejection arrived, and the one action that answers a
  // rejection was not legal in the one column the deal actually sat in.
  Nurturing: ['reply_with_counter', 'chase_the_answer', 'rebook_followup', 'hold'],
  // Where a card sits after WE answered in writing (the send moves it here).
  // Mostly it is off the desk; when it surfaces, it is because they wrote
  // back or went quiet too long, and those are the only plays.
  'Waiting on their answer': ['reply_with_counter', 'chase_the_answer', 'rebook_followup', 'hold'],
};

/** Allowed from ANY stage. flag_mismatch and hold because a wrong column or a
 *  quiet day can happen anywhere; close_lost because a deal can die anywhere
 *  (offer accepted elsewhere, vendor refuses forever) and Hugo's three-roads
 *  law needs the lost road to always exist: "after the first call you have
 *  three options: reply the email, lost, or ready for call two."
 *
 *  escalate_hugo joined them on 2026-08-17, and it is the reason Hugo saw
 *  "Hold, nothing today" on the best deal on the board. Zest Hull sat in
 *  Nurturing with the offer placed and the branch refusing to put it to the
 *  vendors without proof of funds. The brain worked that out correctly eight
 *  times running and wrote the right order every time ("Email Pedro your bank
 *  statement"), but escalate_hugo was legal in only two columns and Nurturing
 *  was not one of them, so the one verb that fitted was unavailable and the
 *  decision fell through to `hold`. The order said do something; the button
 *  said do nothing.
 *
 *  A deal can be blocked on the one thing only Hugo can produce from ANY
 *  column, so the verb for it belongs here. */
export const UNIVERSAL_ACTIONS = [
  'flag_mismatch', 'hold', 'close_lost', 'escalate_hugo',
  // ANSWER THEIR EMAIL. Universal because a branch can write at ANY stage, and
  // on 17 Aug one wrote during discovery: Keeley at Reeds Rains asked us for
  // seven registration details so she could put us on their list. The legal
  // verbs in "Discovery done, evaluating" were the ballpark, a chase for a
  // missing fact, escalate and hold, so the brain wrote the right order,
  // "reply with them today", and had to file it under escalate_hugo. Hugo read
  // a card that said reply today above a blue button that said Send it to
  // Hugo. Third time an action was missing from the one column the deal was
  // sitting in (Nurturing/escalate_hugo, Ballpark agreed/book_builder).
  //
  // `reply_with_counter` is NOT this verb: that one is the money reply and its
  // button runs decideCounter and the ceiling fences. This is the ordinary
  // answer to an ordinary question, and it maps to the follow-up draft, which
  // may not name a figure outside the columns where one has been put to them.
  'reply_to_their_email',
] as const;

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
  /** How sure the brain is of its decision (Hugo, 16 Aug: "how confident are
   *  you on that?"). Optional and lenient: an unknown value becomes null
   *  rather than a refusal, because confidence is information, not a fence. */
  confidence: 'high' | 'medium' | 'low' | null;
}

export type ValidationResult =
  /** `repaired` names a contradiction that was corrected rather than refused.
   *  Present only when something was changed; the caller records it so a
   *  pattern of the same repair is visible instead of being invisibly tidied
   *  away every two minutes. */
  | { ok: true; verdict: ManagerVerdict; repaired?: string }
  | { ok: false; reason: string; detail: string };

/** Every action legal for this deal right now. */
export function allowedActions(columnName: string | null | undefined): string[] {
  const stage = ACTIONS_BY_STAGE[(columnName ?? '').trim()] ?? [];
  return [...new Set([...stage, ...UNIVERSAL_ACTIONS])];
}

/** Is there an appointment at this house that has not happened yet?
 *
 *  Returns a human phrase for the refusal message, or null. TWO sources and
 *  either is enough, because they fail in opposite directions: `viewingAt` is
 *  the exact time but is only filled once something writes it, and the column
 *  is set the moment the agent presses the outcome on the call. On 2026-08-21
 *  both booked viewings had the column and neither had the time.
 *
 *  A viewing with no date recorded counts as ahead of us. That is deliberate:
 *  "we do not know when it is" is a reason to leave the deal alone, not a
 *  licence to bin it.
 */
export function viewingStillAhead(state: DealState, now: Date = new Date()): string | null {
  const at = String(state?.builder?.viewingAt ?? '').trim();
  if (at) {
    const t = new Date(at).getTime();
    // An unreadable date is treated as booked, same reasoning as above.
    if (!Number.isFinite(t)) return 'date unreadable';
    return t >= now.getTime() ? at : null;
  }
  return (state?.board?.column ?? '').trim() === 'Viewing booked'
    ? 'the card is in Viewing booked and no time is recorded'
    : null;
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

  // ---- A BOOKED VIEWING IS NOT A CLOSED DOOR ---------------------------
  //
  // Added 2026-08-21, the day it cost us two deals. Pedro booked two viewings
  // that morning and pressed Viewing booked himself on both. At 12:25 the
  // brain read Ben Rose, Leyland and said "Viewing is booked for Friday 28th
  // at 2pm and the confirmation email is in. Book one of the eight builders
  // for that slot." Three minutes later, on the same deal, it said "The engine
  // will not price this one off the evidence we have. Close it lost today",
  // and the card went to Not interested. Dourish & Day, Stafford went the same
  // way with a viewing booked for the 26th at 2:30. Hugo found them gone from
  // the column and asked where they were.
  //
  // The brain's own rule 19 says what close_lost is for: "an offer accepted
  // elsewhere, a vendor who will never meet our numbers, a branch that said
  // no". Not one of those happened. WE could not price the house, and the
  // brain treated our own failure as their refusal. A branch that has agreed
  // to let a builder in has done the opposite of shutting the door.
  //
  // So the lost road is closed while a viewing is still ahead of us. Every
  // other verb stays legal, including escalate_hugo, and a HUMAN can still
  // move the card by hand: this refuses a machine killing an appointment, not
  // a person deciding to. Once the viewing is behind us the deal can die
  // normally, because by then somebody has actually been to the house.
  if (action === 'close_lost') {
    const booked = viewingStillAhead(state);
    if (booked) {
      return {
        ok: false,
        reason: 'close_lost_over_booked_viewing',
        detail: `a viewing is booked (${booked}); our failure to price a house is not the branch turning us down`,
      };
    }
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

  // "HOLD, NOTHING TODAY" AND "HUGO DOES IT" CANNOT BOTH BE TRUE (2026-08-17).
  //
  // Hugo, looking at the Zest Hull card: "a lot of the time it's not taking the
  // AI, the brain... it says hold nothing for today. Well the answer should be
  // send the email."
  //
  // He was right, and the card was worse than he knew. The brain had decided
  // correctly, eight assessments in a row, that the offer of 103,600 was with
  // the branch and she would not put it to the vendors without proof of funds,
  // and each time it wrote the order "Email Pedro your bank statement" and set
  // who=HUGO. But it also set action=hold, because escalate_hugo was not legal
  // in Nurturing, and hold's button reads "Hold, nothing today".
  //
  // `hold` means there is no move on this deal today. `who: HUGO` means the
  // next move is Hugo's. They contradict each other, so one of them is wrong,
  // and the instruction text says which: it is an order, addressed to Hugo.
  //
  // REPAIRED, NOT REFUSED, and the difference matters. `assess` does not retry:
  // a refusal throws the whole assessment away and falls back to the brief, so
  // refusing this would have replaced a correct order with a blank card. That
  // is the fault Hugo was already looking at. The instruction is the valuable
  // part and it is kept exactly as written; only the verb is corrected, and the
  // correction is recorded so a pattern of it is visible in the log.
  //
  // Narrow on purpose. hold with who=PEDRO or who=NOBODY is left alone: a deal
  // whose next move is a callback already booked for Monday is an HONEST hold,
  // and inventing work for it would be the opposite mistake.
  let repaired: string | undefined;
  let finalAction = action;
  if (action === 'hold' && who === 'HUGO') {
    finalAction = 'escalate_hugo';
    repaired = 'hold_with_who_hugo_became_escalate_hugo';
  }

  const flags = Array.isArray(v.flags) ? v.flags.map(String) : [];
  const badFlag = flags.find((f) => !(FLAGS as readonly string[]).includes(f));
  if (badFlag) {
    return { ok: false, reason: 'unknown_flag', detail: `${badFlag} is not a flag` };
  }

  const evidence = Array.isArray(v.evidence) ? v.evidence.map(String) : [];

  const conf = String(v.confidence ?? '').toLowerCase();
  const confidence = conf === 'high' || conf === 'medium' || conf === 'low' ? conf : null;

  return {
    ok: true,
    repaired,
    verdict: {
      attention: Math.round(attention), action: finalAction, who, instruction,
      flags, evidence, confidence,
    },
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
    confidence: null,
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
