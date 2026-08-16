// What belongs in the cockpit, and what belongs back in the calling list.
//
// Hugo, 2026-08-16, looking at the first live version:
//
//   "you are focusing on voicemail and things like this ... if it's in
//    voicemail it doesn't come to the cockpit. Voicemail should go to the end
//    of the calling list, every day for maybe three days, and then again back
//    in one week. The cockpit is for the ones that were called that day or the
//    day before, the ones under nurturing, the ones on the ballpark. Not the
//    ones that didn't pick up."
//
// HE WAS RIGHT, AND THE NUMBERS WERE STARK. Measured on the live board the day
// this was written, of 179 properties the first cockpit put in front of him:
//
//     36  parked in Voicemail
//      7  Not interested
//      4  No pickup
//     77  no column at all, and every call to them a voicemail or no answer
//     20  never rung by anybody
//     35  an actual conversation had happened
//
// So four cards in five were a dial nobody answered. A list like that is not a
// command centre, it is the dialer queue wearing a different hat, and the one
// thing it guarantees is that the deal that matters is somewhere below the
// fold.
//
// THE RULE IN ONE LINE: the cockpit is where a CONVERSATION is waiting on a
// decision. Everything else is a phone number waiting to be rung, and that is
// the dialer's job, on the cadence in scripts/lib/redial-policy.mjs.
//
// SECOND LESSON, 2026-08-16 evening. The first version of this filter had a
// fallback: spoken to but no column, show it anyway, "the board is untidy".
// Hugo looked at the list and said there were 15 deals on the pipeline and 35
// in the cockpit. He was right again, and the reason is that on 14 Aug he had
// asked for a clean CRM and 59 cards were deliberately taken OFF the board
// (column nulled, history kept). The fallback resurrected exactly the branches
// he had wiped: 14 no-column branches carrying ~25 houses, six of them behind
// one Glasgow office. So THE BOARD IS THE CURATED TRUTH. A card with no column
// is off the board because a human took it off, and a real new conversation
// always lands a column (a qualified outcome auto-moves the card, and the
// dialer disposition moves it too). No column means not here, full stop, with
// the same two exceptions as everything else: a branch that wrote to us, and
// an overdue follow-up.

import type { DealState } from './deal-state.js';

/** Parked because nobody spoke. These go back to the calling list, and the
 *  redial cadence decides when. */
export const CALLING_LIST_COLUMNS = ['Voicemail', 'No pickup'];

/** Parked because somebody spoke and said no. Not a deal, not a dial. */
export const CLOSED_DOOR_COLUMNS = ['Not interested'];

/** Where a live deal can sit. Everything from the first real conversation to
 *  the money, plus the two holding columns that still mean somebody is
 *  working it. */
export const LIVE_COLUMNS = [
  'Booked',
  'Discovery done, evaluating',
  'Ready for call 2',
  'Ballpark agreed',
  'Needs viewing',
  'Offer sent',
  'Offer accepted',
  'Sent to investor',
  'Deal closed',
  'Follow up',
  'Nurturing',
];

export type CockpitVerdict =
  | 'branch_replied'
  | 'live_column'
  | 'overdue_followup'
  | 'never_spoke'
  | 'off_board'
  | 'calling_list'
  | 'closed_door'
  | 'finished';

export interface CockpitDecision {
  inCockpit: boolean;
  why: CockpitVerdict;
  /** One plain sentence, so a card that is missing can be explained rather
   *  than just being absent. */
  reason: string;
}

/** Does this deal belong on somebody's screen today?
 *
 *  Pure and ordered: the first rule that matches wins, and the order is the
 *  argument. A branch that has written to us outranks every reason to hide the
 *  card, including the card being parked, because an unread reply is the one
 *  thing that was provably costing money.
 */
export function isCockpitDeal(state: DealState): CockpitDecision {
  const column = (state.board.column ?? '').trim();

  // ---- 1. THEY WROTE TO US. Nothing outranks this. -------------------
  //
  // Even a branch parked in Voicemail is a live deal the moment they answer in
  // writing, and a filter that hid that would recreate the exact failure the
  // cockpit exists to prevent: Lexi's rejection sat unread for seven hours.
  if (state.writing.replySinceBrief) {
    return {
      inCockpit: true,
      why: 'branch_replied',
      reason: 'The branch has written to us since the last instruction was written.',
    };
  }

  // ---- 2. A follow-up somebody promised has come due -------------------
  if (state.followups.overdue) {
    return {
      inCockpit: true,
      why: 'overdue_followup',
      reason: 'A follow-up on this one is overdue.',
    };
  }

  // ---- 3. Somebody spoke to them and they said no ----------------------
  if (CLOSED_DOOR_COLUMNS.includes(column)) {
    return {
      inCockpit: false,
      why: 'closed_door',
      reason: 'They said no. Nothing to decide until something changes.',
    };
  }

  // ---- 4. Nobody spoke. This is a phone number, not a deal. ------------
  //
  // Both halves matter. The column catches the ones an agent parked by hand;
  // the connected-call count catches the 77 that were never given a column at
  // all and would otherwise walk straight through.
  if (CALLING_LIST_COLUMNS.includes(column)) {
    return {
      inCockpit: false,
      why: 'calling_list',
      reason: `Parked in ${column}. It goes back to the calling list, not here.`,
    };
  }
  if (state.calls.connected === 0) {
    return {
      inCockpit: false,
      why: 'never_spoke',
      reason: state.calls.count === 0
        ? 'Nobody has rung this branch yet, so it belongs in the calling list.'
        : `Rung ${state.calls.count} ${state.calls.count === 1 ? 'time' : 'times'} `
          + 'without ever reaching anybody, so it belongs in the calling list.',
    };
  }

  // ---- 5. Not on the board. A human took it off, or never put it on. ---
  //
  // This used to be a fallback that let no-column branches IN, and it was
  // wrong: the 14 Aug board wipe nulled 59 columns on purpose, and the
  // fallback put ~25 of those houses straight back on Hugo's screen. The
  // board is curated by hand now, so off the board means off the cockpit.
  if (!column) {
    return {
      inCockpit: false,
      why: 'off_board',
      reason: 'Not on the pipeline board. A card off the board was taken off on purpose.',
    };
  }

  // ---- 6. A deal that has finished ---------------------------------------
  if (column === 'Deal closed') {
    return {
      inCockpit: false,
      why: 'finished',
      reason: 'This one is done.',
    };
  }

  // ---- 7. A live deal on the board ---------------------------------------
  if (LIVE_COLUMNS.includes(column)) {
    return {
      inCockpit: true,
      why: 'live_column',
      reason: `Live in ${column}.`,
    };
  }

  // A column this file has never heard of: a human made it and parked the
  // card there, so it is board-curated work. Keep it.
  return {
    inCockpit: true,
    why: 'live_column',
    reason: `On the board in ${column}.`,
  };
}

/** The cockpit list, in one call. */
export function cockpitDeals<T extends { state: DealState }>(all: readonly T[]): T[] {
  return all.filter((d) => isCockpitDeal(d.state).inCockpit);
}
