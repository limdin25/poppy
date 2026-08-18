// THE SECOND READER, AND THE CIRCUIT BREAKER BEHIND IT.
//
// Hugo, 2026-08-17, choosing where a cheap second model should sit: "only on
// money decisions... two models must agree or the press is blocked", and
// "implement a circuit breaker if the AI detects a pattern of wrong offers or
// a heartbeat failure in the infrastructure."
//
// The two things these tests exist to hold:
//
//   1. It is a BELT, not a replacement. The deterministic fences in
//      deal-stress-test.ts stay pure, stay first, and stay the real protection.
//   2. It FAILS OPEN. A model that is down, slow or talking nonsense must never
//      be able to stop the business, because an outage is not evidence that a
//      deal is wrong. A PATTERN of real disagreements is, and that is the
//      breaker's job.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  shouldBreak, breakerMessage, MONEY_MOVES, BREAKER_STRIKES, BREAKER_WINDOW_HOURS,
  auditorPrompt, AUDITOR_MODEL,
} from '../api/lib/money-auditor'
import { buildDealState } from '../api/lib/deal-state'

const NOW = new Date('2026-08-17T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const state = () => buildDealState({
  property: {
    id: 'p1',
    address: 'Welwyn Park Road, Hull, HU6',
    asking_price: 125000,
    deal: {
      cmv: { estimate: 129500, confidence: 'high' },
      gdv: { estimate: 140000 }, tmv: 125000,
      offer: { open: 97125, max: 103600, ladder: [97125, 100363, 103600] },
    },
  },
  columnName: 'Nurturing',
  now: NOW,
})

describe('it only guards the moves that cost money', () => {
  it('covers the ballpark and every email that can carry a figure', () => {
    expect(MONEY_MOVES).toContain('draft_offer_email')
    expect(MONEY_MOVES).toContain('draft_counter_reply')
    expect(MONEY_MOVES).toContain('send_email')
    expect(MONEY_MOVES).toContain('fetch_ballpark')
  })

  it('does NOT slow down the moves that carry no figure', () => {
    // Hugo chose "only on money decisions" over "on every cockpit order",
    // precisely so a call, a note or a comparison is not made to wait.
    for (const free of ['call_branch', 'add_note', 'compare_comps', 'hold',
      'move_stage', 'mark_lost', 'book_followup']) {
      expect(MONEY_MOVES as readonly string[]).not.toContain(free)
    }
  })

  it('is a cheap model, because the expensive one already decided', () => {
    expect(AUDITOR_MODEL).toMatch(/haiku/)
  })
})

describe('what the second reader is allowed to see', () => {
  const p = () => JSON.parse(auditorPrompt({
    state: state(), action: 'draft_offer_email',
    subject: 'Welwyn Park Road', body: 'We can offer GBP 97,125.',
  })) as Record<string, unknown>

  it('gets the money and the exact text, and that is the job', () => {
    const money = p().money_on_file as Record<string, unknown>
    expect(money.our_opening_offer).toBe(97125)
    expect(money.our_maximum).toBe(103600)
    expect(Array.isArray(money.every_figure_legitimately_on_file)).toBe(true)
    expect((p().text_about_to_be_sent as Record<string, string>).body).toContain('97,125')
  })

  it('is NOT given the transcript, the pinned note or the history', () => {
    // A second reader holding the whole file starts second-guessing the
    // decision instead of checking the arithmetic, which is the job the first
    // model already did.
    const keys = Object.keys(p())
    for (const k of ['conversation', 'transcript', 'pinnedNote', 'brief', 'calls', 'writing']) {
      expect(keys).not.toContain(k)
    }
  })
})

describe('the reader knows how a purchase completes', () => {
  // Its first live verdict, 23 minutes after shipping, blocked the Zest send
  // for "offer exceeds available liquidity by £1,529". Hugo: "doesnt matter
  // because we use bridge loan... bake in for this and for the future." The
  // statement total plus the bridging facility IS the structure; a reader that
  // cannot see that calls the design a mistake.

  it('the attachment facts travel to the reader when a statement rides along', () => {
    const p = JSON.parse(auditorPrompt({
      state: state(), action: 'send_email',
      subject: 'x', body: 'y',
      proof: { totalGbp: 102071, fundingNote: 'company accounts together with a bridging facility' },
    })) as Record<string, unknown>
    const pof = p.proof_of_funds_attached as Record<string, unknown>
    expect(pof.statement_total).toBe(102071)
    expect(String(pof.how_the_purchase_completes)).toContain('bridging facility')
  })

  it('no attachment means no attachment block, not an empty one', () => {
    const p = JSON.parse(auditorPrompt({
      state: state(), action: 'send_email', subject: 'x', body: 'y',
    })) as Record<string, unknown>
    expect(p.proof_of_funds_attached).toBeNull()
  })

  it('the rules say a statement below the offer is NOT a mistake', () => {
    const SRC = readFileSync('api/lib/money-auditor.ts', 'utf8')
    expect(SRC).toMatch(/NOT a mistake: an attached proof of funds whose statement total is below the offer/)
  })

  it('the route hands the reader the proof it is attaching', () => {
    const route = readFileSync('api/crm/cockpit-action.ts', 'utf8')
    const call = route.slice(route.indexOf('auditMoneyMove({'), route.indexOf('if (!second.agrees)'))
    expect(call).toMatch(/proof: proof\?\.available/)
    expect(call).toMatch(/fundingNote: proof\.fundingNote/)
  })

  it('the writer keeps the mention short: attached, total, how it completes', () => {
    const draft = readFileSync('api/crm/draft-offer-email.ts', 'utf8')
    // The completion sentence itself is NOT written here. It was, until
    // 17 Aug evening, and a hardcoded funding sentence is the same fault as a
    // hardcoded balance: replace the statement and the email keeps explaining
    // the old one. It is read from the settings row beside the document.
    expect(draft).toMatch(/HOW THE PURCHASE COMPLETES, written in the words of the completion facts you are given/)
    expect(draft).toMatch(/never present the funding structure as a weakness/)
    expect(draft).toMatch(/no need to over explain/)
  })
})

describe('the circuit breaker', () => {
  it('one disagreement is a caught mistake, not a pattern', () => {
    expect(shouldBreak([hoursAgo(1)], NOW)).toEqual({ broken: false, strikes: 1 })
    expect(shouldBreak([hoursAgo(1), hoursAgo(3)], NOW).broken).toBe(false)
  })

  it('three inside the window stops money going out', () => {
    const r = shouldBreak([hoursAgo(1), hoursAgo(5), hoursAgo(20)], NOW)
    expect(r.broken).toBe(true)
    expect(r.strikes).toBe(BREAKER_STRIKES)
  })

  it('old disagreements fall out of the window', () => {
    // Otherwise the breaker latches shut for ever on a bad afternoon three
    // weeks ago, and a breaker nobody can clear gets switched off entirely.
    const r = shouldBreak([hoursAgo(25), hoursAgo(48), hoursAgo(100)], NOW)
    expect(r.broken).toBe(false)
    expect(r.strikes).toBe(0)
  })

  it('is never tripped by rubbish timestamps', () => {
    expect(shouldBreak(['', 'not a date', 'null'], NOW)).toEqual({ broken: false, strikes: 0 })
    expect(shouldBreak([], NOW).broken).toBe(false)
  })

  it('says what happened and what to do, in English', () => {
    const msg = breakerMessage(4)
    expect(msg).toMatch(/Money moves are stopped/)
    expect(msg).toMatch(/4 times/)
    expect(msg).toMatch(new RegExp(`${BREAKER_WINDOW_HOURS} hours`))
    expect(msg).not.toMatch(/[–—]/)   // Hugo's rule, enforced not remembered
  })
})

describe('it fails OPEN, and the reasons are written down', () => {
  const SRC = readFileSync('api/lib/money-auditor.ts', 'utf8')

  it('a model that is down, silent or unparseable APPROVES', () => {
    // Failing closed would mean one provider outage stops every offer in the
    // business, to protect a gap the deterministic fences already cover.
    for (const path of ['unavailable: `error:', "unavailable: 'silent'", "unavailable: 'unparseable'"]) {
      expect(SRC).toContain(path)
    }
    // Every one of those paths returns agrees:true.
    const failures = SRC.match(/return \{ agrees: true, reason: '', unavailable/g) ?? []
    expect(failures.length).toBeGreaterThanOrEqual(2)
  })

  it('ONLY an explicit false stops a press', () => {
    // So a model answering in a shape nobody expected cannot block the board.
    expect(SRC).toMatch(/parsed\.agrees === false/)
  })

  it('the prompt tells it to agree when in doubt', () => {
    expect(SRC).toMatch(/When in doubt, AGREE/)
    expect(SRC).toMatch(/A false alarm stops a real deal/)
  })
})

describe('the pure fences are untouched', () => {
  it('the stress test still has no model and no network in it', () => {
    // The whole reason the second reader lives in its own file and runs from
    // the route: deal-stress-test.ts is pure, and that is what makes every
    // fence in it certain and testable.
    const stress = readFileSync('api/lib/deal-stress-test.ts', 'utf8')
    expect(stress).not.toMatch(/callLLM|money-auditor|fetch\(/)
  })

  it('the second reader runs AFTER the fences passed, never instead', () => {
    const route = readFileSync('api/crm/cockpit-action.ts', 'utf8')
    expect(route.indexOf('if (!report.ok)')).toBeLessThan(route.indexOf('auditMoneyMove('))
    // and before anything commits
    expect(route.indexOf('auditMoneyMove(')).toBeLessThan(route.indexOf('const execution = ACTION_EXECUTION'))
  })

  it('the breaker is checked before we pay for another opinion', () => {
    const route = readFileSync('api/crm/cockpit-action.ts', 'utf8')
    expect(route.indexOf('moneyBreaker(supabase, now)')).toBeLessThan(route.indexOf('auditMoneyMove('))
  })
})
