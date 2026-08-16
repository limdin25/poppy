// The fences the Deal Manager works behind.
//
// "The AI decides attention and words. Code decides money and moves."
//
// It may never move a card, send anything, name a figure that is not already
// on the file, or override the deterministic brief. Every one of those is a
// validation rule here, and every failure has the SAME answer: fall back to
// the brief, log what was refused, carry on. Never an error page, never a
// blank card.

import { describe, it, expect } from 'vitest'
import { buildDealState, type DealStateInput } from '../api/lib/deal-state'
import {
  validateVerdict, fallbackVerdict, allowedActions, baselineAttention,
  deterministicFlags, ACTIONS_BY_STAGE, FLAGS,
} from '../api/lib/deal-manager-contract'

const NOW = new Date('2026-08-14T18:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const stateWith = (over: Partial<DealStateInput> = {}) => buildDealState({
  property: {
    id: 'p1',
    address: 'Orion Way, Grimsby, DN34',
    asking_price: 110000,
    deal: {
      gdv: { estimate: 92667 }, tmv: 82167,
      offer: { open: 64074, max: 68345, ladder: [64074, 66210, 68345] },
    },
    brief: { written_at: hoursAgo(48), do_now: ['Ring Doug. Chase the answer.'] },
  },
  columnName: 'Offer sent',
  now: NOW,
  ...over,
})

const good = {
  attention: 80,
  action: 'chase_the_answer',
  who: 'PEDRO',
  instruction: 'Ring Doug and ask where the vendor stands. Do not move on price.',
  flags: ['reply_unread'],
  evidence: ['writing.replySinceBrief'],
}

describe('a well-formed verdict passes', () => {
  it('accepts an answer that stays inside every fence', () => {
    const r = validateVerdict(good, stateWith())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.verdict.action).toBe('chase_the_answer')
  })

  it('may repeat a figure that IS on the file', () => {
    const r = validateVerdict(
      { ...good, instruction: 'Hold at GBP 64,074. Never past 68,345.' },
      stateWith(),
    )
    expect(r.ok).toBe(true)
  })
})

describe('the figure fence: code decides money', () => {
  it('refuses a figure the Manager invented', () => {
    const r = validateVerdict(
      { ...good, instruction: 'Offer them GBP 66,000 to split the difference.' },
      stateWith(),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invented_figure')
  })

  it("refuses the branch's own number repeated back as an instruction", () => {
    const r = validateVerdict(
      { ...good, instruction: 'They want 105,000, so go to that.' },
      stateWith(),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invented_figure')
  })
})

describe('the action fence: code decides moves', () => {
  it('refuses an action that stage does not allow', () => {
    // send_offer_email belongs to Ballpark agreed, not Offer sent.
    const r = validateVerdict({ ...good, action: 'send_offer_email' }, stateWith())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('action_not_allowed')
  })

  it('refuses an action nobody has ever defined', () => {
    const r = validateVerdict({ ...good, action: 'move_the_card' }, stateWith())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('action_not_allowed')
  })

  it('allows flag_mismatch and hold from any stage', () => {
    for (const stage of Object.keys(ACTIONS_BY_STAGE)) {
      expect(allowedActions(stage)).toContain('flag_mismatch')
      expect(allowedActions(stage)).toContain('hold')
    }
  })

  it('an unknown column allows only the universal actions', () => {
    // close_lost is universal on purpose: a deal can die anywhere, and Hugo's
    // three-roads law needs the lost road to always exist.
    expect(allowedActions('Some New Column').sort()).toEqual(['close_lost', 'flag_mismatch', 'hold'])
    expect(allowedActions(null).sort()).toEqual(['close_lost', 'flag_mismatch', 'hold'])
  })

  it('every stage in the pipeline has a closed action list', () => {
    for (const [stage, actions] of Object.entries(ACTIONS_BY_STAGE)) {
      expect(actions.length, stage).toBeGreaterThan(0)
    }
  })
})

describe('the shape fences', () => {
  it.each([
    ['not_an_object', null],
    ['not_an_object', 'a string'],
  ])('refuses %s', (reason, raw) => {
    const r = validateVerdict(raw, stateWith())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe(reason)
  })

  it('refuses an attention score outside 0 to 100', () => {
    for (const attention of [-1, 101, NaN, 'high']) {
      const r = validateVerdict({ ...good, attention }, stateWith())
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('bad_attention')
    }
  })

  it('refuses an unknown owner', () => {
    const r = validateVerdict({ ...good, who: 'MARIA' }, stateWith())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_who')
  })

  it('refuses an empty or enormous instruction', () => {
    expect(validateVerdict({ ...good, instruction: '  ' }, stateWith()).ok).toBe(false)
    expect(validateVerdict({ ...good, instruction: 'x'.repeat(601) }, stateWith()).ok).toBe(false)
  })

  it('refuses an unknown flag', () => {
    const r = validateVerdict({ ...good, flags: ['vibes_are_off'] }, stateWith())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_flag')
  })

  it('accepts every flag on the closed list', () => {
    const r = validateVerdict({ ...good, flags: [...FLAGS] }, stateWith())
    expect(r.ok).toBe(true)
  })

  it("refuses a long dash, because that is Hugo's standing rule", () => {
    const r = validateVerdict(
      { ...good, instruction: 'Ring Doug — he is expecting you.' },
      stateWith(),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('long_dash')
  })
})

describe('the fallback IS the product as it stands today', () => {
  it('uses the deterministic brief when the Manager cannot be trusted', () => {
    const v = fallbackVerdict(stateWith())
    expect(v.instruction).toBe('Ring Doug. Chase the answer.')
    expect(v.action).toBe('hold')
  })

  it("prefers Hugo's pinned note over anything generated", () => {
    const v = fallbackVerdict(stateWith({
      property: {
        id: 'p1',
        brief: { do_now: ['machine says this'] },
        pinned_note: 'Hugo says do this instead',
      },
    }))
    expect(v.instruction).toBe('Hugo says do this instead')
  })

  it('never returns a blank card, even with nothing on file', () => {
    const v = fallbackVerdict(buildDealState({ property: { id: 'p1' }, now: NOW }))
    expect(v.instruction.length).toBeGreaterThan(10)
    expect(v.who).toBe('PEDRO')
  })

  it('never suggests holding through an unanswered reply', () => {
    // Orion Way, 16 Aug: the vendors' written rejection was ON the card, the
    // model happened to be silent, and the primary button said "Hold, nothing
    // today". The fallback now picks a reply-shaped action the stage allows.
    const v = fallbackVerdict(stateWith({
      messages: [{ id: 'm', direction: 'inbound', created_at: hoursAgo(2), channel: 'email', body: 'Rejected, they want closer to asking.' }],
    }))
    expect(v.action).toBe('reply_with_counter')
    expect(allowedActions('Offer sent')).toContain('reply_with_counter')
  })
})

describe('attention that code is certain about', () => {
  it('a branch that wrote to us and was ignored outranks everything', () => {
    const ignored = stateWith({
      messages: [{ id: 'm', direction: 'inbound', created_at: hoursAgo(2) }],
    })
    const quiet = stateWith()
    expect(baselineAttention(ignored)).toBeGreaterThan(baselineAttention(quiet))
    expect(baselineAttention(ignored)).toBeGreaterThanOrEqual(70)
  })

  it('flags what it is certain of without asking a model', () => {
    const s = stateWith({
      messages: [{ id: 'm', direction: 'inbound', created_at: hoursAgo(2) }],
      followups: [{ id: 'f', due_at: hoursAgo(5), status: 'pending' }],
    })
    expect(deterministicFlags(s)).toEqual(
      expect.arrayContaining(['reply_unread', 'overdue_followup']),
    )
  })

  it('every deterministic flag is on the closed list', () => {
    const s = stateWith({
      messages: [{ id: 'm', direction: 'inbound', created_at: hoursAgo(2) }],
      followups: [{ id: 'f', due_at: hoursAgo(5), status: 'pending' }],
      property: { id: 'p1', updated_at: hoursAgo(200) },
    })
    for (const f of deterministicFlags(s)) {
      expect(FLAGS as readonly string[]).toContain(f)
    }
  })

  it('caps at 100', () => {
    const s = stateWith({
      messages: [{ id: 'm', direction: 'inbound', created_at: hoursAgo(1) }],
      followups: [{ id: 'f', due_at: hoursAgo(50), status: 'pending' }],
      property: {
        id: 'p1', updated_at: hoursAgo(500),
        pinned_note: 'x',
        brief: { blockers: ['a', 'b'] },
      },
    })
    expect(baselineAttention(s)).toBe(100)
  })
})
