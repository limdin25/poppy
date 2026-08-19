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
  // Current board names (Hugo's two-call funnel, 2026-08-14)...
  'Discovery done, evaluating', 'Ready for call 2', 'Ballpark agreed',
  'Viewing booked', 'Offer sent', 'Offer accepted', 'Sent to investor',
  'Deal closed',
  // ...and every older name, kept so a call dispositioned before a rename
  // still reads as a conversation rather than a cold row to re-deal.
  'Discovery done', 'Offer with vendor', 'Needs viewing',
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

/** How long a branch where a human actually answered stays off the queue,
 *  even when the office lists a new house. Hugo, 2026-08-13: "pedro is
 *  calling same agent for another deal... please stop that and blacklist
 *  that agent for 2 weeks." Before this, a new listing reopened a spoken-to
 *  office after just 20 hours, so a busy agency was getting Pedro's opener
 *  again a day after telling him no. The 20-hour gap now only applies to
 *  offices that never picked up. */
export const SPOKEN_BRANCH_COOLDOWN_HOURS = 14 * 24

/** THE VOICEMAIL CADENCE.
 *
 *  Hugo, 2026-08-16: "voicemail should go to the end of the calling list, every
 *  day for maybe three days, and then again back in one week."
 *
 *  So an office nobody has reached is tried on three consecutive days, and if
 *  it is still silent after that it drops to weekly. The point is not to give
 *  up on it, it is to stop a branch that never answers eating a slot every
 *  single day forever while offices nobody has tried wait behind it.
 *
 *  Attempts are counted as calls where NOBODY ANSWERED, not calls in total. */
export const VOICEMAIL_DAILY_ATTEMPTS = 3
export const VOICEMAIL_WEEKLY_GAP_HOURS = 7 * 24

/** How long to wait before ringing a silent office again. */
export function voicemailGapHours(attempts = 0, minGapHours = REDIAL_MIN_GAP_HOURS) {
  return attempts >= VOICEMAIL_DAILY_ATTEMPTS ? VOICEMAIL_WEEKLY_GAP_HOURS : minGapHours
}

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
  /** How many times we have rung this branch WITHOUT reaching anybody. Drives
   *  the voicemail cadence: daily for the first three, weekly after that. */
  unansweredAttempts = 0,
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
  // a deal the auditor killed at 16:30 is not a reason to ring anybody.
  //
  // The gap depends on what happened last time. An office where a HUMAN
  // answered is blacklisted for two weeks (SPOKEN_BRANCH_COOLDOWN_HOURS),
  // however many houses it lists in between: they have heard the pitch, and
  // ringing them about a different door a day later reads as a call centre.
  // An office that never picked up only waits the ordinary 20 hours. A null
  // outcome counts as unanswered, same rule as the redial-unanswered mode.
  const spoke = Boolean(lastOutcome) && !NOBODY_ANSWERED.has(lastOutcome)
  const reopenGap = spoke ? SPOKEN_BRANCH_COOLDOWN_HOURS : minGapHours
  const listed = newestListedAt ? new Date(newestListedAt).getTime() : NaN
  if (Number.isFinite(listed) && listed > called && hours >= reopenGap) {
    return { queue: true, back: true, reason: `new listing since we rang ${ago}${said}` }
  }

  if (mode !== 'unanswered') {
    return { queue: false, back: false, reason: `already called ${ago}${said}` }
  }

  if (lastOutcome && !NOBODY_ANSWERED.has(lastOutcome)) {
    return { queue: false, back: false, reason: `they gave a real answer ${ago}${said}` }
  }
  // THE CADENCE. Three daily tries, then weekly, so a branch that never picks
  // up cannot hold a slot in front of offices nobody has tried at all.
  const gap = voicemailGapHours(unansweredAttempts, minGapHours)
  if (hours < gap) {
    const wait = gap >= VOICEMAIL_WEEKLY_GAP_HOURS ? 'on the weekly cadence now' : 'too soon to try again'
    return {
      queue: false,
      back: false,
      reason: `called ${ago}${said}, ${unansweredAttempts} silent ${unansweredAttempts === 1 ? 'try' : 'tries'}, ${wait}`,
    }
  }
  return {
    queue: true,
    back: true,
    reason: `nobody answered ${ago}${said} (${unansweredAttempts} silent so far)`,
  }
}

/** The mode named by the command line. Kept here so the flag names and the
 *  policy live together. `--unanswered-only` is the original spelling and still
 *  works: it always meant "only the offices that never picked up". */
export function redialModeFromArgv(argv) {
  if (argv.includes('--redial-all')) return 'all'
  if (argv.includes('--redial-unanswered') || argv.includes('--unanswered-only')) return 'unanswered'
  return 'never'
}
