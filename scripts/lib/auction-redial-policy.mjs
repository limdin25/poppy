// When an AUCTION OFFICE may be dealt back onto Pedro's Auction queue.
//
// Hugo asked, 2026-09-18: "when you have a lot of properties from one auction,
// what do we do? ... do we have enough auction so we don't call the same
// auction too many times? And when you call the auction, do we inquire about
// all of them?" The decision, and why it is not the Houses rule:
//
//   1. One call per office covers every lot of theirs on our list. The office
//      is one contact and the lots sit in the Lots tab.
//   2. Calling an auctioneer often is fine AS LONG AS EACH CALL IS ABOUT
//      SOMETHING NEW. An estate agent gets a 14-day rest after a conversation
//      (redial-policy.mjs), because the agent does not want us. An auctioneer
//      is paid to shift unsold lots, and those lots sell in days: a 14-day hold
//      would sit on a lot until somebody else bought it. So:
//        - at most one call a day per office (MIN_GAP_HOURS)
//        - an office he has spoken to comes back only when it holds a lot he
//          has not asked about yet (a lot still at status 'new')
//        - lots he HAS asked about are followed up through their own next step
//          (call back, director decides), never by the nightly queue
//        - nobody answered: try again the next day, three tries, then weekly
//
// Pure, no I/O, so tests/auction-assign.test.ts proves it without a database.

import { NOBODY_ANSWERED } from './redial-policy.mjs'

/** Lot statuses Pedro has not asked about. 'no_answer' is here because nobody
 *  told him anything about the lot. Every other outcome he presses in the Lots
 *  tab (api/crm/auction-outcome.ts) takes the lot out. */
export const UNASKED = new Set(['new', 'call_queued', 'no_answer'])

export const MIN_GAP_HOURS = 20
export const SILENT_DAILY_TRIES = 3
export const SILENT_WEEKLY_GAP_HOURS = 7 * 24

/** Outcome names on the Auction board that mean nobody picked up. The two
 *  shared names are the ones wk_apply_outcome also treats as no answer. */
export const AUCTION_NOBODY_ANSWERED = new Set([...NOBODY_ANSWERED])

/**
 * @param {object} a
 * @param {string|null} a.lastCallAt   ISO time of the last outbound call, null if never rung
 * @param {string|null} a.lastOutcome  board column name pressed on that call, null if none
 * @param {number} a.silentTries       unanswered calls in a row, newest first
 * @param {number} a.unaskedLots       lots at this office still at status 'new'
 * @param {number} [a.nowMs]
 * @returns {{ deal: boolean, back: boolean, reason: string }}
 *   deal = put a queue row down; back = behind everything never rung
 */
export function decideAuctionDeal({ lastCallAt, lastOutcome, silentTries = 0, unaskedLots = 0, nowMs = Date.now() }) {
  if (unaskedLots <= 0) return { deal: false, back: false, reason: 'every lot here has been asked about' }
  if (!lastCallAt) return { deal: true, back: false, reason: 'never rung' }

  const hours = (nowMs - Date.parse(lastCallAt)) / 3_600_000
  const silent = !lastOutcome || AUCTION_NOBODY_ANSWERED.has(lastOutcome)
  if (silent) {
    const gap = silentTries >= SILENT_DAILY_TRIES ? SILENT_WEEKLY_GAP_HOURS : MIN_GAP_HOURS
    if (hours < gap) {
      return { deal: false, back: false, reason: `nobody answered ${silentTries}x, next try after ${gap}h` }
    }
    return { deal: true, back: true, reason: `nobody answered ${silentTries}x, trying again` }
  }
  if (hours < MIN_GAP_HOURS) return { deal: false, back: false, reason: 'spoken to today already' }
  return { deal: true, back: true, reason: `${unaskedLots} lot(s) not asked about yet` }
}
