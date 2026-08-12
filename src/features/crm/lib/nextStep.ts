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
  call: 'Call the agent',
  photos: 'Ask for photos',
  numbers: 'Confirm the numbers',
  builder: 'Hugo prices the works',
  offer: 'Send the offer',
  chase: 'Chase the agent',
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
    // Hugo is next: confirm the GDV and the works before anyone offers.
    case 'figure_obtained':
    case 'qualified':
      return STEP.numbers;
    // Alive, but the branch has not given a number yet. Ring them back.
    case 'deciding':
    case 'follow_up':
    case 'callback':
      return STEP.chase;
    // Never reached anybody, so the first call has still not happened.
    case 'no_answer':
      return STEP.call;
    case 'not_qualified':
      return '';
    default:
      return null;
  }
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
