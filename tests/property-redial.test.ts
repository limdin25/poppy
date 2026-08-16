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
  voicemailGapHours
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
