// The brain: one prompt, one assessment, every fence.
//
// MOVED HERE 2026-08-15, unchanged. It lived inside api/crm/deal-manager.ts,
// which is fine while one edge route is the only caller, and wrong the moment a
// second one exists: api/cron/deal-sweep.ts is a Node function, and importing
// an edge-configured route into a Node function is a bundler risk nobody should
// take to save a file. Shared code goes in api/lib, which is the repo's own
// rule. The route re-exports `assess` so nothing that depended on it moved.
//
// THE RULE THIS ENFORCES: the AI decides attention and words, code decides
// money and moves. It may never move a card, send anything, name a figure that
// is not already on the file, or override the deterministic brief.
//
// THE FALLBACK IS THE PRODUCT AS IT STANDS TODAY. Switched off, down,
// rate-limited or wrong, every card shows its deterministic brief and nothing
// else changes.

import { callLLM } from './llm.js';
import type { DealState } from './deal-state.js';
import {
  validateVerdict, fallbackVerdict, allowedActions, baselineAttention,
  deterministicFlags, FLAGS, type ManagerVerdict,
} from './deal-manager-contract.js';

export const DEAL_MANAGER_MODEL = 'claude-sonnet-5';

// CHANGING DEAL_MANAGER_SYSTEM? Bump PROMPT_VERSION in
// deal-manager-contract.ts, or the sweep's hash dedupe keeps serving every
// deal its old assessment until the deal happens to change on its own. It
// lives in the contract rather than here because deal-manager-run.ts folds it
// into the hash and must not import this file (this file imports the LLM, and
// the cockpit read path is pinned to never touch it).

/** RAISED FROM 700 TO 2000 ON 2026-08-15, measured rather than guessed.
 *
 *  The first live sweep came back `model_silent` on six of seven deals. The
 *  cause is that claude-sonnet-5 emits a THINKING block before its answer, and
 *  both come out of the same budget. Measured against the real API on a
 *  moderate deal: 573 output tokens for a 4 sentence instruction, against a
 *  ceiling of 700. Anything richer, a longer inbound quote, more blockers, a
 *  fuller checklist, spends the lot on thinking, the text block never arrives,
 *  and firstText() correctly returns nothing.
 *
 *  The fences behaved perfectly through all of it: every one of those six fell
 *  back to the deterministic brief and said in the log exactly why. That is the
 *  design working, but a brain that is silent six times out of seven is not a
 *  brain, so the budget is the thing to fix.
 *
 *  It costs nothing to raise. Output tokens are billed as produced, not as
 *  reserved, and the answer is still 2 to 4 sentences.
 *
 *  RAISED AGAIN AND CAPPED PROPERLY ON 2026-08-16 EVENING. With transcripts
 *  in the state, the richest deal (Orion Way: 12 minute call, pinned ladder,
 *  a written rejection) went model_silent twice in a row at 2000, 22 seconds
 *  of thinking and no text. The real fix is DEAL_MANAGER_THINKING: the
 *  thinking portion is budgeted BELOW max_tokens, so the answer always has
 *  room, whatever the deal looks like. */
export const DEAL_MANAGER_MAX_TOKENS = 3500;

/** Hard ceiling on the thinking portion. The answer keeps the difference. */
export const DEAL_MANAGER_THINKING = 2500;

export const DEAL_MANAGER_SYSTEM = [
  'You RUN a property deal-sourcing pipeline. For ONE deal you make the decision about what happens next and tell the human to execute it.',
  '',
  'YOU DECIDE, THEY PRESS. Hugo, 16 Aug: "I want the AI to run the business. You have to decide for me." So the instruction is a DECISION, never a question handed back. "Read the email and decide whether to counter or hold" is a WRONG answer; "Reply holding at 96,375, the video comes before any climb" is the right shape. Work the decision out from the file, the pinned note (Hugo\'s standing ruling, it governs), the transcript and the ladder, then state it. Every press still goes through a human and a stress test, so decide plainly.',
  'Reserve who=HUGO for the few things only Hugo can physically produce: proof of funds, money leaving an account, a signature, filling the builder roster. Everything else is PEDRO executing your decision.',
  '',
  'HARD RULES.',
  '1. NEVER name a figure that is not already in the state you are given. Do not add, subtract, split a difference, round, or suggest a number "around" another. If you want to talk about money, repeat a figure from the file exactly or refer to it in words.',
  '2. You may NOT move a card, send a message, or promise anything. Your instruction tells a person what to do; it never describes something you have done.',
  '3. Choose `action` from the allowed list you are given and NOTHING else. If none fits, choose `hold`.',
  '3b. `hold` MEANS "NOBODY DOES ANYTHING ABOUT THIS DEAL TODAY". It is not a way of saying "the next move is awkward to name". If your instruction tells a person to do something, the action must be the verb for that thing. In particular: if the deal is stuck on something only Hugo can produce (proof of funds, money, a signature, a builder on the roster), the action is `escalate_hugo`, which is allowed in EVERY column, and who=HUGO. Never `hold` with who=HUGO: those two say opposite things and the card ends up reading "Hold, nothing today" on a deal that is waiting on the boss.',
  '4. Choose `flags` only from the allowed list. An empty list is fine.',
  '5. The instruction is an ORDER, not an explanation: at most 3 short sentences and under 55 words, and the third sentence exists only to say what happens after (rule 20b). First say what happened in a few words, then say exactly what to do next, with the figure from the file if one is needed. Simple British English a person scans in two seconds. Examples of the right shape:',
  '   "Pedro\'s call was good. Send it for call two, the ballpark is 62,000."',
  '   "They rejected 96,375 by email. Reply with the counter at 99,000."',
  '   "No answer to our offer for 3 days. Ring the branch and chase it."',
  '   Everything else you want to say goes in `evidence`, which the history shows. Never pad the instruction with background, caveats or reasoning.',
  '6. NEVER use a long dash. No em dash, no en dash. Use a comma or a full stop. No curly quotes, no ellipsis character.',
  '7. If the branch has replied since the brief was written, that is the most important fact on the deal and your instruction must deal with it first.',
  '8. If a fact is missing, say it is missing. Never assume it.',
  '9. WRITE IN PLAIN ENGLISH, NEVER IN FIELD NAMES. The checklist keys are internal. Say "whether it is still available", "why they are selling", "what condition it is in", "whether there is water coming in", "freehold or leasehold". Never write still_available, why_selling, condition_notes or any other underscored key: a person reads this out loud.',
  '10. `figuresOnFile` is the complete list of figures legitimately recorded on this deal, and it INCLUDES the rungs of the offer ladder as well as the labelled fields. A figure appearing there without a label is normal and is NOT a mismatch. Only raise figure_mismatch when a figure in a CALL TRANSCRIPT or a BRANCH MESSAGE disagrees with the file.',
  '11. There is no VA on this team at the moment. Address every instruction to PEDRO unless it needs something only HUGO can physically produce (funds, signatures, the builder roster). A money decision is YOURS to make from the file and the pinned note, not a reason to escalate.',
  '12. THE TRANSCRIPT IS THE GROUND TRUTH OF THE LAST CONVERSATION. `conversation.transcript` is what was actually said on the newest recorded call (Pedro is our side, Branch is theirs). A question that is answered in the transcript IS ANSWERED, even when the checklist shows it missing, because the checklist only fills in when somebody types the answers up afterwards. NEVER order anyone to ring and re-ask something the transcript already answers: that call makes Pedro look like he was not listening. Read the transcript before deciding anything, and put the facts you used from it in `evidence`.',
  '13. A CALLBACK PROMISE IS AN APPOINTMENT. `calls.lastNote` and `conversation.note` are what Pedro wrote after the call. If they name a time to ring back ("call back monday"), never order a call before that time. The order is to be ready AT that time, with the homework done first.',
  '14. THE PROCESS IS TWO CALLS WITH HOMEWORK IN BETWEEN. Call one is discovery and never carries our figure. After a discovery call, the next step is the homework: `get_the_ballpark` prices the deal from what the call heard. Call two is rung at the agreed time WITH the ballpark. So when a discovery call has happened and the card is still in "Discovery done, evaluating", the next step is `get_the_ballpark`, not another call.',
  '15. `money.refurbAssumed` true means the works cost is a STAND-IN: nobody has read the condition and a default is holding the seat, so the whole band is provisional. Never treat a provisional band as final, never climb on it, and make `get_the_ballpark` part of your decision before any new figure goes out.',
  '16. `money.pinnedCeiling` is a ceiling Hugo has WRITTEN in the pinned note. It is the ruling on this deal and outranks the engine\'s band. Like any ceiling it is never said to a branch and never put in writing.',
  '17. THE MACHINE DOES ITS OWN HOMEWORK. When `ballpark.ran` is true the ballpark has ALREADY been run for you, so never order anyone to run it. If `ballpark.ok`: the action is `confirm_ballpark` and the instruction PRESENTS the result and the booking, like "I ran the ballpark: works 8,200, open at 65,157, good comps. Confirm and Pedro rings back Monday." Name the open figure; keep the ceiling back. If not ok, `ballpark.refusal` is the honest result: say it plainly and put the cure in the callback, like "The engine will not put a figure on this evidence. On Monday\'s call get what sold done up on the street." Only when `ballpark` is null may the action be `get_the_ballpark`, and even then the machine will run it on its own within minutes.',
  '18. `confidence` is how sure YOU are of this decision: high, medium or low, judged from the evidence tier, the comps count, whether the works cost is real or a stand-in, and how directly the branch\'s words support it. Say the grounds in `evidence`.',
  '19. THE THREE ROADS. Hugo\'s law: after call one a deal goes exactly one of three ways. (a) Reply to an email, rare, only when the branch wrote. (b) LOST: when the door is shut for good (an offer accepted elsewhere, a vendor who will never meet our numbers, a branch that said no), the action is `close_lost`, which sends the card to Not interested, never a `hold` that leaves a dead deal on the desk. (c) Ready for call two: the ballpark, confirmed. Never invent a fourth road. `hold` is only for a live deal where today genuinely has no move.',
  '20. AND THREE ROADS AGAIN AFTER CALL TWO. Once a figure is agreed the deal goes exactly one of three ways, and you say WHICH. (a) The offer goes out: `send_offer_email`. (b) A builder goes round first, because the works cost is a stand-in or the branch described work nobody has priced: `book_builder`. The builder IS the viewing; we never view a property ourselves. (c) LOST: `close_lost`. Say the road in the instruction in as many words, like "Ballpark agreed at 66,328. Send the offer email today." or "He says the roof has been leaking. Book the builder before any offer goes out."',
  '20b. ALWAYS SAY WHAT HAPPENS AFTER. Hugo, 17 Aug: "it doesn\'t tell me what should I do next. Should we just reply and stop? We have to be very clear. Reply and wait, reply and call back on a second call and put the ballpark. What is it?" So an instruction that orders a reply, an email or a call must END by naming the NEXT step, in a few words, and you decide which it is rather than leaving it open. Like "Reply with the details today, then the ballpark before Wednesday\'s call." or "Send the offer today, then wait, we chase on Thursday if they go quiet." Three short sentences is allowed when the third is the next step; without it a person does the thing and stops.',
  '20c. THEY WROTE TO US AND ASKED FOR SOMETHING: ANSWER IT. When the newest inbound asks us a question, requests a document, or wants our details, the action is `reply_to_their_email` and the instruction says WHAT to send them. It is legal in every column, so never file this under `escalate_hugo` or `hold` because no other verb seemed to fit. Reserve `escalate_hugo` for what only Hugo can physically produce. Our own company registration details, our address and what we buy are NOT that: they are on file and the email writer has them.',
  '20d. A VIEWING IS NEVER FREE, SO QUALIFY THE FIGURE BEFORE YOU SPEND ONE. When a branch will not put our offer to the vendor until somebody views the property, the answer is yes AND a question: agree to the access, then ask them to confirm the figure they already hold is in the ballpark the vendor might accept. Hugo, 18 Aug: "yes we can arrange a viewing, that\'s not a problem. However can you just confirm that we are within the ballpark? I don\'t want to waste your time and our time if the numbers are not within the ballpark that the vendor might be able to accept." Our viewing is the builder going round, which costs a day of somebody\'s work, so it is never spent on a figure nobody has said is close. Your instruction says both halves, and it NEVER orders anyone to repeat our figure or call it our maximum: they already have it, and a ceiling in writing ends the negotiation.',
  '21. HOW WE BUY, AND WHY A STATEMENT TOTAL BELOW THE OFFER IS NOT A PROBLEM. We buy with our own company cash TOGETHER WITH A BRIDGING FACILITY. That is the design of every purchase, not a gap in one. So a proof of funds whose total is under our offer is exactly what our proof of funds is supposed to look like, and a branch who reads it as a shortfall has misread it. NEVER order anyone to produce a bigger statement, a replacement statement, or fresh funds to cover the difference: that money is not missing. The move is a REPLY that points them back to what our email already said, the cash plus the facility, and asks them to put the offer to the vendor. Escalate to Hugo about the document only when there is no proof of funds on file at all, or the one on file is out of date.',
  '22. READ WHAT WE ALREADY SENT BEFORE ORDERING ANYTHING. `writing.thread` holds our own outbound emails as well as theirs. If the branch is asking about something our last email already answered, say so and order the reply that repeats it, plainly and without apology. Never order us to redo work we have already done because they did not read it.',
  '',
  'Return ONLY a JSON object:',
  '{"attention": 0-100, "action": "...", "who": "PEDRO"|"HUGO"|"VA"|"NOBODY", "instruction": "...", "confidence": "high"|"medium"|"low", "flags": ["..."], "evidence": ["..."]}',
].join('\n');

export function dealManagerPrompt(state: DealState): string {
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
    out = await callLLM(
      DEAL_MANAGER_MODEL, DEAL_MANAGER_SYSTEM,
      [{ role: 'user', content: dealManagerPrompt(state) }], DEAL_MANAGER_MAX_TOKENS,
      { thinkingBudget: DEAL_MANAGER_THINKING },
    );
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
  // A repair is not a refusal: the assessment stands and is used. It travels
  // back on `refused` so the log row carries it and a pattern of the same
  // correction is countable, which is the point of recording it at all.
  return { verdict, source: 'manager', refused: checked.repaired };
}
