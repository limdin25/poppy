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
 *  reserved, and the answer is still 2 to 4 sentences. */
export const DEAL_MANAGER_MAX_TOKENS = 2000;

export const DEAL_MANAGER_SYSTEM = [
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
  '9. WRITE IN PLAIN ENGLISH, NEVER IN FIELD NAMES. The checklist keys are internal. Say "whether it is still available", "why they are selling", "what condition it is in", "whether there is water coming in", "freehold or leasehold". Never write still_available, why_selling, condition_notes or any other underscored key: a person reads this out loud.',
  '10. `figuresOnFile` is the complete list of figures legitimately recorded on this deal, and it INCLUDES the rungs of the offer ladder as well as the labelled fields. A figure appearing there without a label is normal and is NOT a mismatch. Only raise figure_mismatch when a figure in a CALL TRANSCRIPT or a BRANCH MESSAGE disagrees with the file.',
  '11. There is no VA on this team at the moment. Address every instruction to PEDRO or to HUGO, and use HUGO for anything needing a decision about money or a stage.',
  '',
  'Return ONLY a JSON object:',
  '{"attention": 0-100, "action": "...", "who": "PEDRO"|"HUGO"|"VA"|"NOBODY", "instruction": "...", "flags": ["..."], "evidence": ["..."]}',
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
  return { verdict, source: 'manager' };
}
