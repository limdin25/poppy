// What to do next with a property deal, worked out from what has actually
// happened to it.
//
// Hugo 2026-08-12: "the brain should add a tag on the deal on the pipeline
// telling us what to do next."
//
// The tags themselves live in components/templates/dealProcessSteps.ts, which
// is also what the Deal process page, the pipeline chip, the dialer panel and
// the offer strip all read. This file only decides WHICH of them a deal is on.
// A test pins every tag here against that list, so a renamed step cannot
// silently leave a card pointing at nothing.
//
// Deliberately dumb and deterministic. No model decides what to do next.

import { DEAL_STAGES } from '../components/templates/dealProcessSteps';

export const STEP = {
  call: 'Discovery call',
  homework: 'Do the homework',
  builder: 'Builder ballpark',
  offerCall: 'Offer call',
  offer: 'Email the offer',
  chase: 'Chase the agent',
  viewing: 'Book the viewing',
  writing: 'Get it in writing',
} as const;

export type StepTag = (typeof STEP)[keyof typeof STEP];

/** Every tag this file can write, so a test can check they all exist. */
export const WRITEABLE_STEPS: StepTag[] = Object.values(STEP);

/** True when the tag is one the deal process actually has a step for. */
export function isKnownStep(tag: string): boolean {
  return DEAL_STAGES.some((s) => s.tag === tag);
}

/** What a call outcome means for the next step.
 *
 *  null = leave the tag alone (an outcome that says nothing about progress).
 *  '' = clear it (this deal is dead, so there is nothing to do next). */
export function stepForOutcome(outcome: string): StepTag | '' | null {
  switch (outcome) {
    // A figure came out of the branch, which is the whole point of the call.
    // The homework is next: the deal gets built from what the agent said,
    // before anyone rings back with a number of ours.
    case 'figure_obtained':
    case 'qualified':
      return STEP.homework;
    // The branch has our ballpark and is deciding. Chase them for the answer.
    case 'deciding':
      return STEP.chase;
    // Ring them back, but it says NOTHING about where the deal is. These used
    // to map to Chase the agent, and Chase is an offer-mode step, so pressing
    // "Call back" on a first call flipped the card into offer mode: script
    // pane titled CALL 2, offer email in the Email tab, figure armed on the
    // strip. The exact failure the two-call split exists to prevent, from a
    // button Pedro presses all day. Leave the tag alone and the card keeps
    // the stage it was really on.
    case 'follow_up':
    case 'callback':
      return null;
    // Never reached anybody, so the first call has still not happened.
    case 'no_answer':
      return STEP.call;
    case 'not_qualified':
      return '';
    default:
      return null;
  }
}

/** Which of the two calls the property script pane shows for a branch.
 *
 *  Hugo 2026-08-13: "on the 2nd call the script must change so pedro must see
 *  a new script." Discovery until the homework has produced a confirmed
 *  figure; the offer view from 'Offer call' onward. Unknown, missing or
 *  mid-homework steps are DISCOVERY, because the safe wrong answer is the one
 *  with no money section on the screen. */
export function callModeForStep(step?: string | null): 'discovery' | 'offer' {
  const s = (step ?? '').trim();
  const offerSteps = new Set<string>([
    STEP.offerCall, STEP.offer, STEP.chase, STEP.viewing, STEP.writing, 'Renegotiate',
  ]);
  return offerSteps.has(s) ? 'offer' : 'discovery';
}

/** The custom_fields patch for a deal whose offer has just gone out by email.
 *
 *  Hugo 2026-08-12, item 5 on the list: nothing recorded that an offer had been
 *  sent, so nothing could chase it and nothing could measure it. */
export function offerSentFields(offerPrice: number, whenIso: string): Record<string, string> {
  return {
    offer_sent_at: whenIso,
    offer_price: String(Math.round(offerPrice)),
    next_step: STEP.chase,
  };
}
