// Whether a branch Pedro has ALREADY CALLED may be dealt back onto his queue.
//
// Pure functions, no I/O, so tests/property-redial.test.ts can prove them
// without a database.
//
// Why this file exists (2026-08-11). Pedro, mid-shift, on two branches in a
// row: "the leads repeated, this one I have already spoken earlier to she
// said", and "even this one i think ive already called this". He was right
// both times. McDonald of Bispham told him no at 15:03 UK and the queue handed
// the same office back to him at 17:30. Clive Watkin said no twice, two hours
// apart, then got a third ring.
//
// The cause was a guard that only ever looked at the queue, never at the call
// history: assign-properties-to-pedro-houses.mjs skipped a branch when it still
// had a `pending` or `dialing` row, and queued it otherwise. A branch he had
// just finished with is, by definition, no longer pending. So the run re-dealt
// precisely the offices he had already worked, and inserted them ABOVE the
// untouched stock, where the picker takes them first.
//
// So the rule is now the other way round: having been called is a reason NOT to
// deal a branch, and a redial has to be asked for.

/**
 * Outcomes that mean a human at the branch actually talked to us. A branch
 * sitting on one of these is a conversation to follow up deliberately, never a
 * cold row to deal back onto the queue.
 *
 * Ballpark belongs here and its absence was a real hole: it is the BEST thing
 * that can happen on a property call (the branch named a figure), and until
 * 2026-08-11 it was the one good outcome not on this list, so the only branches
 * worth protecting most were the ones eligible to be rung again.
 */
export const SPOKE_TO_A_HUMAN = new Set([
  // Current board names (renamed 2026-08-13 to match the two-call process)...
  'Discovery done', 'Ballpark agreed', 'Offer with vendor',
  // ...and the old names, kept so a call dispositioned before the rename
  // still reads as a conversation rather than a cold row to re-deal.
  'Interested', 'Not interested', 'Booked', 'Nurturing', 'Ballpark', 'Deciding',
])

/** Outcomes that mean nobody picked up. Everything else that was pressed is
 *  treated as a conversation, because guessing wrong in that direction only
 *  costs us a lead, and guessing wrong the other way rings a real person back
 *  to ask them the same questions. */
export const NOBODY_ANSWERED = new Set(['Voicemail', 'No pickup'])

/** The minimum gap before an unanswered branch may be tried again. Hugo,
 *  2026-08-10: "the offices that didn't pick up, they should go to the end of
 *  the list", meaning tomorrow, not in an hour. */
export const REDIAL_MIN_GAP_HOURS = 20

/**
 * Decide whether a branch should be put on the dialer queue.
 *
 * @param opts.lastCallAt   ISO timestamp of the most recent call to this branch
 *                          by this agent, or null when it has never been called
 * @param opts.lastOutcome  the pipeline column pressed on that call, or null
 *                          when nothing was pressed
 * @param opts.newestListedAt  when the branch's newest CALLABLE listing was
 *                          filed. A house that appeared after the last call is
 *                          a new reason to ring, not a repeat of the old one.
 * @param opts.mode         'never' (default), 'unanswered' or 'all'
 * @param opts.nowMs        Date.now() from the caller, so this stays pure
 * @param opts.minGapHours  override REDIAL_MIN_GAP_HOURS
 * @returns {{queue: boolean, back: boolean, reason: string}}
 *          `back` means: queue it BEHIND everything already waiting. A branch
 *          rung before must never leapfrog one nobody has spoken to yet.
 */
export function decideRedial({
  lastCallAt = null,
  lastOutcome = null,
  newestListedAt = null,
  mode = 'never',
  nowMs,
  minGapHours = REDIAL_MIN_GAP_HOURS,
} = {}) {
  const called = lastCallAt ? new Date(lastCallAt).getTime() : NaN
  if (!Number.isFinite(called)) {
    return { queue: true, back: false, reason: 'never called' }
  }

  const hours = (nowMs - called) / 3_600_000
  const ago = hours < 24 ? `${Math.max(0, Math.round(hours))}h ago` : `${Math.round(hours / 24)}d ago`
  const said = lastOutcome ? `, ${lastOutcome}` : ', no outcome pressed'

  if (mode === 'all') {
    return { queue: true, back: true, reason: `redial-all (called ${ago}${said})` }
  }

  // A house the branch had not listed when we last rang. This is the one thing
  // that reopens a branch on its own, and without it the default rule slowly
  // starves the queue: the scraper brings 33 towns of new stock every night to
  // offices that were all rung once, and none of it would ever be dealt.
  //
  // Only CALLABLE listings count, because the caller passes the filtered set:
  // a deal the auditor killed at 16:30 is not a reason to ring anybody. And the
  // same gap applies, so a house listed an hour after the call waits until
  // tomorrow rather than ringing the same office twice in an afternoon.
  const listed = newestListedAt ? new Date(newestListedAt).getTime() : NaN
  if (Number.isFinite(listed) && listed > called && hours >= minGapHours) {
    return { queue: true, back: true, reason: `new listing since we rang ${ago}${said}` }
  }

  if (mode !== 'unanswered') {
    return { queue: false, back: false, reason: `already called ${ago}${said}` }
  }

  if (lastOutcome && !NOBODY_ANSWERED.has(lastOutcome)) {
    return { queue: false, back: false, reason: `they gave a real answer ${ago}${said}` }
  }
  if (hours < minGapHours) {
    return { queue: false, back: false, reason: `called ${ago}${said}, too soon to try again` }
  }
  return { queue: true, back: true, reason: `nobody answered ${ago}${said}` }
}

/** The mode named by the command line. Kept here so the flag names and the
 *  policy live together. `--unanswered-only` is the original spelling and still
 *  works: it always meant "only the offices that never picked up". */
export function redialModeFromArgv(argv) {
  if (argv.includes('--redial-all')) return 'all'
  if (argv.includes('--redial-unanswered') || argv.includes('--unanswered-only')) return 'unanswered'
  return 'never'
}
