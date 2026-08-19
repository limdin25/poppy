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
export function callModeForStep(
  step?: string | null,
  /** The branch card's own fields. A confirmed ballpark lives here as
   *  `ballpark_confirmed_at`, written by applyBallpark alongside the step. */
  fields?: Record<string, string> | null,
): 'discovery' | 'offer' {
  const s = (step ?? '').trim();
  const offerSteps = new Set<string>([
    STEP.offerCall, STEP.offer, STEP.chase, STEP.viewing, STEP.writing, 'Renegotiate',
  ]);
  if (offerSteps.has(s)) return 'offer';

  // A CONFIRMED BALLPARK IS NEVER UNLEARNED.
  //
  // Hugo, 2026-08-18: "the callback script for the 2nd call where we mention
  // the ballpark and if accepted we book a viewing is not there at all."
  // `no_answer` writes 'Discovery call', so a branch with an AGREED figure
  // that simply did not pick up was demoted to call one, and Pedro rang back
  // reading the discovery script at a branch waiting for a number. The
  // ballpark is the second signal, and it only ever promotes.
  //
  // THE SIGNAL IS THE CONFIRMATION STAMP, NEVER BARE offer_open (19 Aug,
  // Pedro at 09:30: "the script is now property call 2, i cannot call the new
  // leads"). offer_open is written by the nightly assign for every PRICED
  // branch before anyone has rung it (the band is Pedro's homework on call
  // one), and the room sync re-stamps it whenever a priced house is merely
  // selected. Promoting on it flipped the whole fresh queue to call two the
  // first night the machine ran. `ballpark_confirmed_at` is written by
  // applyBallpark alone, the one place a ballpark is actually confirmed.
  if ((fields?.ballpark_confirmed_at ?? '').trim()) return 'offer';
  return 'discovery';
}

/** Board columns that mean the discovery call has already happened, so the
 *  next conversation with this branch is call two.
 *
 *  Mirrors PROPERTY_STAGES in api/crm/cockpit.ts (drift-pinned by a test):
 *  these are the stages from "the ballpark is set" onward. The earlier stages
 *  ('Booked', 'Discovery done, evaluating', 'Nurturing', 'Follow up') and the
 *  no-contact ones ('Voicemail', 'No pickup', 'Not interested') say nothing
 *  about which call is next, so they promote nothing. */
export const CALL2_COLUMNS = new Set<string>([
  'Ready for call 2', 'Ballpark agreed', 'Needs viewing',
  'Offer sent', 'Waiting on their answer', 'Offer accepted',
]);

/** callModeForStep plus the card's own board column.
 *
 *  Hugo 2026-08-18, after Jones & Chapman: "on call number two that we make
 *  the call directly from the pipeline, it should not open the first script,
 *  this is a callback." The column IS his instruction: a card he or the brain
 *  has put in 'Ready for call 2' opens on call two even when the step tag was
 *  knocked back by a no_answer, or the money fields are missing because the
 *  card was dragged there by hand. With no money on file the offer view shows
 *  its STOP guard and empty slots, which is honest; the discovery script at a
 *  branch waiting for our number is not.
 *
 *  PROMOTE-ONLY, like the offer_open signal inside callModeForStep: a column
 *  can arm the offer view, no column ever demotes it.
 *
 *  The board's own Fetch-ballpark button (PipelinesPage) deliberately keeps
 *  plain callModeForStep, so a Ready-for-call-2 card without money keeps the
 *  button that fetches the money. */
export function callModeForCard(
  step?: string | null,
  fields?: Record<string, string> | null,
  columnName?: string | null,
): 'discovery' | 'offer' {
  if (callModeForStep(step, fields) === 'offer') return 'offer';
  if (columnName && CALL2_COLUMNS.has(columnName.trim())) return 'offer';
  return 'discovery';
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
