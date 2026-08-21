// A branch Pedro has already called must not be dealt back to him.
//
// The day this went wrong (2026-08-11) he sent two screenshots an hour apart:
// "the leads repeated, this one I have already spoken earlier to she said" and
// "even this one i think ive already called this". Both were true. McDonald of
// Bispham said no at 15:03 UK and the queue handed the office back at 17:30.
// Seventeen branches were rung twice or three times that day, and the repeats
// were inserted ABOVE 58 offices nobody had ever rung.
//
// These tests hold the new rule: having been called is a reason NOT to deal a
// branch, and a redial must be asked for and goes to the back of the queue.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  decideRedial, redialModeFromArgv, SPOKE_TO_A_HUMAN, NOBODY_ANSWERED, REDIAL_MIN_GAP_HOURS,
  VOICEMAIL_DAILY_ATTEMPTS,
  VOICEMAIL_WEEKLY_GAP_HOURS,
  voicemailGapHours,
  listedAtOf
} from '../scripts/lib/redial-policy.mjs'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const NOW = Date.parse('2026-08-11T17:30:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

describe('a branch nobody has rung', () => {
  it('is queued, at the front', () => {
    const d = decideRedial({ lastCallAt: null, nowMs: NOW })
    expect(d.queue).toBe(true)
    expect(d.back).toBe(false)
  })
})

describe('the default: called once is called enough', () => {
  it('refuses McDonald, told us no two and a half hours earlier', () => {
    const d = decideRedial({ lastCallAt: hoursAgo(2.5), lastOutcome: 'Not interested', nowMs: NOW })
    expect(d.queue).toBe(false)
    expect(d.reason).toMatch(/already called/)
  })

  it('refuses a branch that was called and had NO outcome pressed', () => {
    // 16 of Pedro's first 55 calls ended with nothing pressed. Under the old
    // guard those were indistinguishable from a branch never touched.
    expect(decideRedial({ lastCallAt: hoursAgo(1), lastOutcome: null, nowMs: NOW }).queue).toBe(false)
  })

  it('refuses a branch that rang out, even days later', () => {
    expect(decideRedial({ lastCallAt: hoursAgo(72), lastOutcome: 'No pickup', nowMs: NOW }).queue).toBe(false)
  })
})

describe('--redial-unanswered: only the offices nobody picked up', () => {
  const mode = 'unanswered'

  it('holds back every outcome that means a human spoke to us', () => {
    for (const outcome of SPOKE_TO_A_HUMAN) {
      const d = decideRedial({ lastCallAt: hoursAgo(48), lastOutcome: outcome, mode, nowMs: NOW })
      expect(d.queue, `${outcome} must never be redialled`).toBe(false)
    }
  })

  it('holds back Ballpark, the best outcome on a property call', () => {
    // Ballpark was missing from the old list, so the one branch that had
    // actually named a figure was eligible to be rung again and asked afresh.
    expect(SPOKE_TO_A_HUMAN.has('Ballpark')).toBe(true)
    expect(decideRedial({ lastCallAt: hoursAgo(48), lastOutcome: 'Ballpark', mode, nowMs: NOW }).queue).toBe(false)
  })

  it('re-deals a voicemail from yesterday, at the BACK', () => {
    const d = decideRedial({ lastCallAt: hoursAgo(REDIAL_MIN_GAP_HOURS + 1), lastOutcome: 'Voicemail', mode, nowMs: NOW })
    expect(d.queue).toBe(true)
    expect(d.back).toBe(true)
  })

  it('refuses that same voicemail two hours later', () => {
    const d = decideRedial({ lastCallAt: hoursAgo(2), lastOutcome: 'Voicemail', mode, nowMs: NOW })
    expect(d.queue).toBe(false)
    expect(d.reason).toMatch(/too soon/)
  })

  it('treats an unknown outcome as a conversation, not as a no-answer', () => {
    // Fails safe: a column somebody adds later must not become a licence to
    // ring a branch back.
    expect(NOBODY_ANSWERED.has('Interested')).toBe(false)
    expect(decideRedial({ lastCallAt: hoursAgo(99), lastOutcome: 'Some new column', mode, nowMs: NOW }).queue).toBe(false)
  })
})

describe('a house the branch listed after we rang them', () => {
  // Hugo, 2026-08-13: "pedro is calling same agent for another deal... please
  // stop that and blacklist that agent for 2 weeks." An office where a human
  // answered waits two weeks even when it lists a new house; only an office
  // that never picked up reopens on the ordinary 20-hour gap.

  it('an office a human answered stays blacklisted for two weeks', () => {
    const d = decideRedial({
      lastCallAt: hoursAgo(30), lastOutcome: 'Not interested',
      newestListedAt: hoursAgo(2), nowMs: NOW,
    })
    expect(d.queue).toBe(false)
  })

  it('reopens a spoken-to office at the back once the two weeks have passed', () => {
    const d = decideRedial({
      lastCallAt: hoursAgo(15 * 24), lastOutcome: 'Not interested',
      newestListedAt: hoursAgo(2), nowMs: NOW,
    })
    expect(d.queue).toBe(true)
    expect(d.back).toBe(true)
    expect(d.reason).toMatch(/new listing/)
  })

  it('an office that never picked up reopens on the 20-hour gap', () => {
    const d = decideRedial({
      lastCallAt: hoursAgo(30), lastOutcome: 'Voicemail',
      newestListedAt: hoursAgo(2), nowMs: NOW,
    })
    expect(d.queue).toBe(true)
    expect(d.back).toBe(true)
    expect(d.reason).toMatch(/new listing/)
  })

  it('does NOT reopen an unanswered office the same afternoon', () => {
    // McDonald said no at 15:03 and a batch landed at 16:30. Ringing back at
    // 17:30 is the exact complaint that started all this.
    const d = decideRedial({
      lastCallAt: hoursAgo(2.5), lastOutcome: 'No pickup',
      newestListedAt: hoursAgo(1), nowMs: NOW,
    })
    expect(d.queue).toBe(false)
  })

  it('does not count a listing that was already on file when we rang', () => {
    const d = decideRedial({
      lastCallAt: hoursAgo(30), lastOutcome: 'Not interested',
      newestListedAt: hoursAgo(50), nowMs: NOW,
    })
    expect(d.queue).toBe(false)
  })
})

describe('--redial-all: everything back, but still behind the fresh stock', () => {
  it('queues a branch that said no, and sends it to the back', () => {
    const d = decideRedial({ lastCallAt: hoursAgo(1), lastOutcome: 'Not interested', mode: 'all', nowMs: NOW })
    expect(d.queue).toBe(true)
    expect(d.back).toBe(true)
  })
})

describe('the flags', () => {
  it('defaults to never, which is what the overnight machine runs', () => {
    expect(redialModeFromArgv(['--refresh', '--apply'])).toBe('never')
  })

  it('accepts both spellings of the unanswered flag', () => {
    expect(redialModeFromArgv(['--redial-unanswered'])).toBe('unanswered')
    expect(redialModeFromArgv(['--unanswered-only'])).toBe('unanswered')
  })

  it('accepts --redial-all', () => {
    expect(redialModeFromArgv(['--redial-all'])).toBe('all')
  })
})

describe('the assign script actually applies the policy', () => {
  const src = read('scripts/assign-properties-to-pedro-houses.mjs')

  it('reads call history on every run, not only under a flag', () => {
    // The whole bug was a guard that only looked at the queue. If this call
    // ever moves back inside an `if (SOME_FLAG)` the repeats come back.
    expect(src).toMatch(/const history = await callHistoryByPhone\(/)
    expect(src).toMatch(/decideRedial\(/)
  })

  it('sends a redial to the back of the live queue', () => {
    expect(src).toMatch(/priority: back \? minPriority - 1 - i : maxPriority/)
    expect(src).toMatch(/currentMinPendingPriority/)
  })

  it('--refresh loads the untouched branches too, not only the held ones', () => {
    // The overnight machine's ONLY assign step is `--refresh --apply`. While
    // --refresh swapped the channel filter instead of widening it, that run
    // could not queue a branch it had never seen, so a whole night's scrape
    // stayed invisible to Pedro.
    expect(src).toMatch(/if \(!REFRESH\) q = q\.eq\('call_channel', 'ai'\)/)
    expect(src).not.toMatch(/REFRESH \? q\.eq\('call_channel', 'human'\)/)
  })

  it('never queues a held-back branch, only refreshes it', () => {
    const start = src.indexOf('for (const { branch, reason } of heldBack)')
    const end = src.indexOf("say('─'.repeat(64))", start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(src.slice(start, end)).not.toMatch(/wk_dialer_queue/)
  })
})

describe('the voicemail cadence: three daily tries, then weekly', () => {
  // Hugo, 2026-08-16: "voicemail should go to the end of the calling list,
  // every day for maybe three days, and then again back in one week."
  //
  // The point is not to give up on a silent office, it is to stop one eating a
  // slot every single day forever while offices nobody has tried wait behind
  // it. Before this, `--redial-unanswered` retried on a flat 20 hours however
  // many times it had already failed.
  const H = 3600000
  const now = Date.now()
  const tryAt = (attempts, hoursAgo) => decideRedial({
    lastCallAt: new Date(now - hoursAgo * H).toISOString(),
    lastOutcome: 'Voicemail',
    mode: 'unanswered',
    nowMs: now,
    unansweredAttempts: attempts,
  })

  it('waits the ordinary gap for the first three tries', () => {
    expect(tryAt(1, 10).queue).toBe(false)
    expect(tryAt(1, 22).queue).toBe(true)
    expect(tryAt(2, 22).queue).toBe(true)
  })

  it('drops to weekly once three tries have gone unanswered', () => {
    expect(tryAt(3, 22).queue).toBe(false)
    expect(tryAt(3, 22).reason).toContain('weekly')
    expect(tryAt(3, 24 * 8).queue).toBe(true)
  })

  it('stays weekly however many times it has failed', () => {
    expect(tryAt(9, 24 * 3).queue).toBe(false)
    expect(tryAt(9, 24 * 8).queue).toBe(true)
  })

  it('says how many silent tries there have been, so the queue log reads', () => {
    expect(tryAt(2, 30).reason).toContain('2 silent')
  })

  it('leaves a branch that ANSWERED alone, whatever the count', () => {
    // The cadence is about silence. An office that gave a real answer is held
    // by the two-week cooldown, not by this.
    const spoke = decideRedial({
      lastCallAt: new Date(now - 30 * H).toISOString(),
      lastOutcome: 'Discovery done, evaluating',
      mode: 'unanswered', nowMs: now, unansweredAttempts: 0,
    })
    expect(spoke.queue).toBe(false)
  })

  it('holds the numbers Hugo asked for', () => {
    expect(VOICEMAIL_DAILY_ATTEMPTS).toBe(3)
    expect(VOICEMAIL_WEEKLY_GAP_HOURS).toBe(7 * 24)
    expect(voicemailGapHours(0)).toBe(REDIAL_MIN_GAP_HOURS)
    expect(voicemailGapHours(3)).toBe(VOICEMAIL_WEEKLY_GAP_HOURS)
  })
})

// ---------------------------------------------------------------------------
// THE LISTED-SINCE RULE, AND THE LANE WHERE IT WAS DEAD.   (2026-08-21)
//
// decideRedial has understood since 2026-08-11 that a house a branch had not
// listed when we last rang is a new reason to ring them. The DISCOVERY assign
// script never handed it a date, so on that lane the rule could not fire at
// all and a called branch was held back for ever rather than for a fortnight.
// Measured on the night of 2026-08-20: 17 of 62 pool branches held back, on a
// run that queued 2 against a target of 250.
// ---------------------------------------------------------------------------
describe('when a house went on the market', () => {
  const NOW2 = Date.parse('2026-08-21T09:00:00Z')

  it('is the scrape stamp less the days it has been listed', () => {
    const at = listedAtOf(
      { days_on_market: 10, scraped_at: '2026-08-21T00:00:00Z' }, NOW2)
    expect(at).toBe('2026-08-11T00:00:00.000Z')
  })

  it('falls back to now when the scrape stamp is missing, not to the epoch', () => {
    const at = listedAtOf({ days_on_market: 0 }, NOW2)
    expect(Date.parse(at as string)).toBe(NOW2)
  })

  it('refuses to invent a date it cannot know', () => {
    // Unknown must keep the old behaviour, which is that nothing reopens.
    expect(listedAtOf({}, NOW2)).toBeNull()
    expect(listedAtOf({ days_on_market: null }, NOW2)).toBeNull()
    expect(listedAtOf({ days_on_market: 'soon' }, NOW2)).toBeNull()
    expect(listedAtOf({ days_on_market: -1 }, NOW2)).toBeNull()
    expect(listedAtOf({ days_on_market: 99999 }, NOW2)).toBeNull()
  })

  it('reopens an office that never picked up once the 20 hours are up', () => {
    const v = decideRedial({
      lastCallAt: new Date(NOW2 - 30 * 3_600_000).toISOString(),
      lastOutcome: 'Voicemail',
      newestListedAt: new Date(NOW2 - 2 * 3_600_000).toISOString(),
      nowMs: NOW2,
    })
    expect(v.queue).toBe(true)
    expect(v.back).toBe(true)          // behind the offices nobody has tried
  })

  it('still holds an office that ANSWERED for the full fourteen days', () => {
    const spoke = (hoursSinceCall: number) => decideRedial({
      lastCallAt: new Date(NOW2 - hoursSinceCall * 3_600_000).toISOString(),
      lastOutcome: 'Not interested',
      newestListedAt: new Date(NOW2 - 1 * 3_600_000).toISOString(),
      nowMs: NOW2,
    })
    expect(spoke(13 * 24).queue).toBe(false)
    expect(spoke(15 * 24).queue).toBe(true)
  })

  it('a house listed BEFORE we rang is not a new reason to ring', () => {
    const v = decideRedial({
      lastCallAt: new Date(NOW2 - 30 * 3_600_000).toISOString(),
      lastOutcome: 'Voicemail',
      newestListedAt: new Date(NOW2 - 40 * 3_600_000).toISOString(),
      nowMs: NOW2,
    })
    expect(v.queue).toBe(false)
  })
})

describe('the discovery assign script actually uses it', () => {
  const src = read('scripts/assign-discovery-branches.mjs')

  it('hands the policy a listing date instead of leaving the rule dead', () => {
    expect(src).toContain('listedAtOf')
    expect(src).toMatch(/newestListedAt:\s*listedAtOf\(p, nowMs\)/)
  })

  it('queues reopened branches BEHIND the ones nobody has rung', () => {
    // Priorities count downwards here, so the only way to honour `back` is to
    // place every fresh branch before any reopened one.
    expect(src).toMatch(/for \(const pass of \[false, true\]\)/)
    expect(src).toMatch(/verdict\.back !== pass/)
  })

  it('says how many were reopened, because a silent change of who gets rung is how the repeats happened', () => {
    expect(src).toMatch(/rung before and reopened \(queued behind the fresh ones\)/)
  })
})

describe('a verdicts file we cannot act on is refused, not obeyed', () => {
  const src = read('scripts/assign-discovery-branches.mjs')

  it('refuses one written before the engine learned that unread is not failed', () => {
    // The file on disk on 2026-08-21 listed 33,734 houses as failed, including
    // every house whose comparables had simply not been fetched yet.
    expect(src).toContain("hasOwnProperty.call(verdicts, 'not_judged')")
    expect(src).toMatch(/REFUSING to re-test/)
  })

  it('refuses a stale one, because a verdict is about the day it was taken', () => {
    expect(src).toMatch(/VERDICTS_MAX_AGE_HOURS = 24/)
  })

  it('still queues branches when the re-test is skipped', () => {
    // Adding branches is the job; re-testing is the extra. A bad verdicts file
    // must not become an empty night.
    expect(src).toMatch(/verdicts = null/)
    expect(src).not.toMatch(/verdicts.*process\.exit/)
  })
})

describe('the discount floor announces itself every night', () => {
  it('both assign scripts print the value they are actually running', () => {
    // The VPS runs COPIES. On 2026-08-21 the priced copy was still on 0.15,
    // two days after the floor moved to 0.20, and nothing said so because the
    // test that pins the value reads the repo and the repo was right.
    for (const f of ['scripts/assign-discovery-branches.mjs',
                     'scripts/assign-properties-to-pedro-houses.mjs']) {
      expect(read(f)).toMatch(/minimum discount in force: \$\{Math\.round\(MIN_LOCAL_DISCOUNT \* 100\)\}%/)
    }
  })
})
