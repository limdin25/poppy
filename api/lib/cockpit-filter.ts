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

/** We answered them in writing and the ball is in their court. Hugo, 16 Aug:
 *  "I replied. So why still on the list?" The card sits here off the desk
 *  until they write back (rule 1), a follow-up comes due (rule 2), or the
 *  silence runs past WAITING_HOURS, at which point it returns as a chase. */
export const WAITING_COLUMN = 'Waiting on their answer';
export const WAITING_HOURS = 96;

/** Where a live deal can sit. Everything from the first real conversation to
 *  the money, plus the two holding columns that still mean somebody is
 *  working it. */
export const LIVE_COLUMNS = [
  'Booked',
  'Discovery done, evaluating',
  'Ready for call 2',
  'Ballpark agreed',
  'Viewing booked',
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
  | 'moved_by_hand'
  | 'scheduled'
  | 'waiting_reply'
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
export function isCockpitDeal(
  state: DealState,
  now: Date = new Date(),
  /** When a HUMAN last moved this card's stage by hand from the cockpit, off
   *  the press log. Passed in rather than read here, so this file stays pure
   *  and the rule stays testable with a fixture. */
  opts: { handMovedAt?: string | null } = {},
): CockpitDecision {
  const column = (state.board.column ?? '').trim();

  // ---- 0. A HUMAN MOVED IT. THAT IS THE ANSWER. ------------------------
  //
  // Hugo, 17 Aug: "When I move a lead to a pipeline column, that's it. If I'm
  // in the cockpit and I move to a column, it goes away from the cockpit." He
  // said it twice, the second time rejecting a version that booked Pedro's
  // callback along with the move: "it is not obliged to book the time for the
  // follow up." So the move alone clears the card, with no time on it and no
  // second press.
  //
  // IT SITS ABOVE THE UNREAD-REPLY RULE, AND ONLY JUST. Rule 1 exists because
  // an unanswered reply was provably costing money, so the only thing allowed
  // to outrank it is a person who has SEEN it: a hand move happens with the
  // card and its reply on the screen. Hence the comparison rather than a flat
  // hide. A message that lands AFTER the move falls through to rule 1 and the
  // card comes straight back, and an overdue follow-up falls through to rule 2.
  //
  // WHY THE PRESS AND NOT THE COLUMN. `wk_contacts.stage_moved_at` changes on
  // every column write and most of them are the machine's: a discovery call
  // outcome moves a card into "Discovery done, evaluating", and hiding on that
  // stamp would hide the exact deal the cockpit exists to price. Only a human
  // pressing Move the stage counts, so this arrives from the press log.
  //
  // SAID OUT LOUD, because it is Hugo's call and not the machine's: a card set
  // aside this way has no time on it, so nothing re-surfaces it on its own. It
  // is on the board in the column he chose, and the cockpit footer counts it.
  if (opts.handMovedAt) {
    const movedTs = Date.parse(opts.handMovedAt);
    const inboundTs = state.writing.lastInboundAt ? Date.parse(state.writing.lastInboundAt) : 0;
    const theyWroteSince = inboundTs > movedTs;
    if (Number.isFinite(movedTs) && !theyWroteSince && !state.followups.overdue) {
      return {
        inCockpit: false,
        why: 'moved_by_hand',
        reason: column
          ? `You moved this to ${column} by hand. It comes back if they write or a follow up comes due.`
          : 'You moved this by hand. It comes back if they write or a follow up comes due.',
      };
    }
  }

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

  // ---- 3. Decided and booked: the work has a TIME now ------------------
  //
  // Hugo, 16 Aug: "I click confirm, it goes to Pedro for the callback, and
  // it goes away from the cockpit." A deal whose next follow-up sits in the
  // FUTURE, with nothing else waiting, is not a decision, it is an
  // appointment. It comes back the moment the follow-up is due (rule 2) or
  // the branch writes (rule 1).
  if (state.followups.nextDueAt && !state.followups.overdue) {
    return {
      inCockpit: false,
      why: 'scheduled',
      reason: 'Approved and booked. It comes back when the callback is due or the branch writes.',
    };
  }

  // ---- 3b. We replied, the ball is in their court ----------------------
  //
  // Hugo, 16 Aug, on DDM: "So I replied it. So why still on the list?" After
  // the counter goes out there is nothing to decide until they answer, so
  // the card waits here off the desk. Rule 1 brings it back the moment they
  // write; four days of silence brings it back as a chase, because a counter
  // nobody answers is not a closed conversation, it is a stalled one.
  if (column === WAITING_COLUMN) {
    const sentAt = state.writing.lastOutboundAt ? Date.parse(state.writing.lastOutboundAt) : NaN;
    const hoursQuiet = Number.isFinite(sentAt) ? (now.getTime() - sentAt) / 3_600_000 : 0;
    if (hoursQuiet > WAITING_HOURS) {
      return {
        inCockpit: true,
        why: 'live_column',
        reason: `We replied ${Math.round(hoursQuiet / 24)} days ago and they have gone quiet. Chase it.`,
      };
    }
    return {
      inCockpit: false,
      why: 'waiting_reply',
      reason: 'We answered them. It comes back when they write or after four days of silence.',
    };
  }

  // ---- 4. Somebody spoke to them and they said no ----------------------
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

/** The cockpit list, in one call. `handMovedAt` is looked up per property when
 *  the caller has the press log to hand; without it the hand-move rule simply
 *  never fires, which is the old behaviour. */
export function cockpitDeals<T extends { state: DealState }>(
  all: readonly T[],
  now: Date = new Date(),
  handMovedAt?: (state: DealState) => string | null | undefined,
): T[] {
  return all.filter((d) => isCockpitDeal(
    d.state, now, { handMovedAt: handMovedAt?.(d.state) ?? null },
  ).inCockpit);
}
