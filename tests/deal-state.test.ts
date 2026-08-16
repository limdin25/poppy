// Layer 1 of the Deal Manager: everything the system knows about one deal,
// gathered deterministically so the fences on top of it are checkable.
//
// The five gaps it exists to close (docs/AI_DEAL_MANAGER_PLAN.md section 1):
// nothing watches a deal between events, an email reply changes no
// instruction, the overnight machine never tells Pedro a known branch cut its
// price, past Offer accepted there is no code, and Pedro's day has an order
// but no priorities.

import { describe, it, expect } from 'vitest'
import {
  buildDealState, figuresIn, figuresAreOnFile, STALE_HOURS, CHECKLIST_KEYS,
  TRANSCRIPT_CAP, type DealStateInput,
} from '../api/lib/deal-state'

const NOW = new Date('2026-08-14T18:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const base = (over: Partial<DealStateInput> = {}): DealStateInput => ({
  property: {
    id: 'p1',
    address: 'Orion Way, Grimsby, DN34',
    status: 'new',
    asking_price: 110000,
    deal: {
      comps_tier: 'good',
      gdv: { estimate: 92667 },
      tmv: 82167,
      refurb: { low: 6891 },
      offer: { open: 64074, max: 68345, ladder: [64074, 66210, 68345] },
    },
    brief: {
      written_at: hoursAgo(48),
      step: 'Chase the agent',
      do_now: ['Ring Doug. Chase the answer.'],
      blockers: [],
      confidence: { level: 'medium' },
    },
  },
  contact: { id: 'c1', name: 'DDM Residential, Grimsby', phone: '01472 404591' },
  columnName: 'Nurturing',
  now: NOW,
  ...over,
})

describe('the money is read, never derived', () => {
  it('reads the engine figures off the deal blob', () => {
    const s = buildDealState(base())
    expect(s.money).toMatchObject({
      asking: 110000, gdv: 92667, tmv: 82167,
      open: 64074, ceiling: 68345, refurb: 6891, compsTier: 'good',
    })
  })

  it('collects every figure legitimately on file, including the ladder', () => {
    const s = buildDealState(base())
    expect(s.money.figuresOnFile).toEqual(
      expect.arrayContaining([110000, 92667, 82167, 64074, 68345, 6891, 66210]),
    )
  })

  it('is empty rather than guessing when the engine has said nothing', () => {
    const s = buildDealState(base({
      property: { id: 'p1', asking_price: null, deal: null },
    }))
    expect(s.money.figuresOnFile).toEqual([])
    expect(s.money.gdv).toBeNull()
  })
})

describe('the reply-after-brief gap, which is the one that cost money', () => {
  it('spots a branch that has written since the brief was written', () => {
    // Lexi rejected the offer at 08:38 and the card still said "chase the
    // agent" seven hours later.
    const s = buildDealState(base({
      messages: [{
        id: 'm1', direction: 'inbound', channel: 'email',
        created_at: hoursAgo(9), subject: 'Update on Offer',
        body: 'Our vendors have rejected your offer, they want nearer 110,000.',
      }],
    }))
    expect(s.writing.replySinceBrief).toBe(true)
    expect(s.writing.lastInboundPreview).toContain('rejected')
  })

  it('does not fire when the brief is newer than the reply', () => {
    const s = buildDealState(base({
      messages: [{ id: 'm1', direction: 'inbound', created_at: hoursAgo(72) }],
    }))
    expect(s.writing.replySinceBrief).toBe(false)
  })

  it('fires when there is no brief at all, because look-at-it is the safe answer', () => {
    const s = buildDealState(base({
      property: { ...base().property, brief: null },
      messages: [{ id: 'm1', direction: 'inbound', created_at: hoursAgo(2) }],
    }))
    expect(s.writing.replySinceBrief).toBe(true)
  })

  it('an inbound we have since written back to is answered, not waiting', () => {
    // Measured 2026-08-16: briefs are NULL on all 208 houses (the outcome
    // press that writes them is almost never used), so a brief-only compare
    // made ANY inbound count forever. Our own later outbound closes it.
    const s = buildDealState(base({
      property: { ...base().property, brief: null },
      messages: [
        { id: 'm1', direction: 'inbound', created_at: hoursAgo(20) },
        { id: 'm2', direction: 'outbound', created_at: hoursAgo(2) },
      ],
    }))
    expect(s.writing.replySinceBrief).toBe(false)
  })

  it('an outbound message of ours is not a reply', () => {
    const s = buildDealState(base({
      messages: [{ id: 'm1', direction: 'outbound', created_at: hoursAgo(2) }],
    }))
    expect(s.writing.replySinceBrief).toBe(false)
    expect(s.writing.lastOutboundAt).toBe(hoursAgo(2))
  })
})

describe('the provisional refurb and the written ceiling', () => {
  it('reads the engine\'s own provisional label', () => {
    const s = buildDealState(base({
      property: {
        ...base().property,
        deal: { ...(base().property.deal ?? {}), refurb: { low: 6891, basis: 'provisional' } },
      },
    }))
    expect(s.money.refurbAssumed).toBe(true)
    expect(buildDealState(base()).money.refurbAssumed).toBe(false)
  })

  it('finds the ceiling Hugo wrote, and never mistakes the asking price for it', () => {
    // Orion Way's real note: quotes the ASKING (110k, the number we must
    // never pay) alongside the ruling. Only ceiling phrases count.
    const s = buildDealState(base({
      property: {
        ...base().property,
        pinned_note: 'Asking: £110k, our offer £96,375. One step to £99,588 max. Never past £102,800.',
      },
    }))
    expect(s.money.pinnedCeiling).toBe(102800)
    expect(buildDealState(base()).money.pinnedCeiling).toBeNull()
  })
})

describe("Hugo's own figures are on the file", () => {
  it('counts figures in the pinned note as legitimately on file', () => {
    // Orion Way, 16 Aug: the offer actually with the vendor (96,375) and the
    // ladder Hugo ruled lived only in the pinned note, so the brain was
    // forbidden from naming the very numbers Hugo decided.
    const s = buildDealState(base({
      property: {
        ...base().property,
        pinned_note: 'Hold at £96,375. If they counter: one step to £99,588 max. Never past £102,800.',
      },
    }))
    for (const n of [96375, 99588, 102800]) {
      expect(s.money.figuresOnFile).toContain(n)
    }
    expect(figuresAreOnFile('Reply holding at 96,375.', s)).toBe(true)
  })
})

describe('the brain has ears: the last conversation rides on the state', () => {
  // Paterson Road, 16 Aug: a 12 minute recorded discovery call with Pedro's
  // note "call back monday", and the brain ordered a Sunday re-ring to re-ask
  // everything, because the checklist was never typed up and the checklist was
  // all it could see.
  it('carries the transcript, the note and the timing', () => {
    const s = buildDealState(base({
      calls: [{ id: 'k1', created_at: hoursAgo(48), duration_sec: 744, agent_note: 'call back monday' }],
      lastConversation: {
        call_id: 'k1', at: hoursAgo(48), duration_sec: 744, note: 'call back monday',
        transcript: 'Pedro: Is it still available?\nBranch: Yes, that one is still available.',
      },
    }))
    expect(s.conversation?.transcript).toContain('still available')
    expect(s.conversation?.note).toBe('call back monday')
    expect(s.calls.lastNote).toBe('call back monday')
  })

  it('is null when no call was recorded, never an empty pretence', () => {
    const s = buildDealState(base({ lastConversation: { transcript: '   ' } }))
    expect(s.conversation).toBeNull()
  })

  it('trims a marathon from the FRONT, keeping the answers and the close', () => {
    const line = 'Branch: some early small talk here.\n'
    const tail = 'Branch: our vendor would take ninety.'
    const s = buildDealState(base({
      lastConversation: { transcript: line.repeat(400) + tail },
    }))
    expect(s.conversation!.transcript.length).toBeLessThanOrEqual(TRANSCRIPT_CAP + 40)
    expect(s.conversation!.transcript).toContain('ninety')
    expect(s.conversation!.transcript).toContain('(start of call trimmed)')
  })
})

describe('nothing watching a deal between events', () => {
  it('calls a deal stale once nobody has touched it for three days', () => {
    const s = buildDealState(base({ property: { ...base().property, updated_at: hoursAgo(STALE_HOURS + 1) } }))
    expect(s.clock.stale).toBe(true)
  })

  it('is not stale while something is still happening', () => {
    const s = buildDealState(base({ messages: [{ id: 'm', direction: 'outbound', created_at: hoursAgo(2) }] }))
    expect(s.clock.stale).toBe(false)
  })

  it('counts hours sitting in the current column', () => {
    const s = buildDealState(base({
      contact: { id: 'c1', stage_moved_at: hoursAgo(100) },
    }))
    expect(s.board.hoursInColumn).toBeCloseTo(100, 0)
  })

  it('reports an overdue follow-up', () => {
    const s = buildDealState(base({
      followups: [{ id: 'f1', due_at: hoursAgo(5), note: 'Ring Doug', status: 'pending' }],
    }))
    expect(s.followups.overdue).toBe(true)
    expect(s.followups.hoursOverdue).toBeCloseTo(5, 0)
    expect(s.followups.note).toBe('Ring Doug')
  })

  it('a follow-up in the future is not overdue', () => {
    const s = buildDealState(base({
      followups: [{ id: 'f1', due_at: hoursAgo(-10), status: 'pending' }],
    }))
    expect(s.followups.overdue).toBe(false)
  })

  it('ignores a completed follow-up', () => {
    const s = buildDealState(base({
      followups: [{ id: 'f1', due_at: hoursAgo(5), status: 'done' }],
    }))
    expect(s.followups.nextDueAt).toBeNull()
  })
})

describe('the checklist becomes blockers, never assumptions', () => {
  it('counts what the call never established', () => {
    const s = buildDealState(base({
      property: {
        ...base().property,
        qualification: { still_available: 'yes', why_selling: 'probate', condition_notes: '' },
      },
    }))
    expect(s.checklist.answered).toBe(2)
    expect(s.checklist.total).toBe(CHECKLIST_KEYS.length)
    expect(s.checklist.missing).toContain('condition_notes')
    expect(s.checklist.missing).toContain('water')
  })
})

describe('calls and the builder', () => {
  it('takes the newest call whatever order they arrive in', () => {
    const s = buildDealState(base({
      calls: [
        { id: 'old', created_at: hoursAgo(50), disposition: 'No pickup' },
        { id: 'new', created_at: hoursAgo(3), disposition: 'Discovery done, evaluating' },
      ],
    }))
    expect(s.calls.count).toBe(2)
    expect(s.calls.lastOutcome).toBe('Discovery done, evaluating')
    expect(s.calls.hoursSinceLast).toBeCloseTo(3, 0)
  })

  it('reports the builder position', () => {
    const s = buildDealState(base({
      property: { ...base().property, assigned_builder_id: 'b1', viewing_quote: 24000 },
      builderMatches: [{ id: 'b1', name: 'A Builder' }],
    }))
    expect(s.builder).toMatchObject({ matches: 1, booked: true, quote: 24000 })
    // and the quote is a figure on file, so the Manager may repeat it
    expect(s.money.figuresOnFile).toContain(24000)
  })
})

describe('the figure fence', () => {
  it('finds money in a sentence', () => {
    expect(figuresIn('Open at GBP 64,074 and never above £68,345.'))
      .toEqual([64074, 68345])
  })

  it('ignores small numbers and dates, which are not money', () => {
    expect(figuresIn('Ring them in 2 days, on the 14th, about 3 houses')).toEqual([])
  })

  it('treats a bare four-digit year as a year, not a price', () => {
    expect(figuresIn('They listed it back in 2025 and cut in 2026')).toEqual([])
    // but the same digits with a currency symbol ARE money
    expect(figuresIn('a deposit of GBP 2025')).toEqual([2025])
  })

  it('catches a comma-grouped number with no currency symbol', () => {
    // The hole that let "They want 105,000" through the fence.
    expect(figuresIn('They want 105,000 for it')).toEqual([105000])
  })

  it('passes an instruction that only repeats figures on file', () => {
    const s = buildDealState(base())
    expect(figuresAreOnFile('Hold at GBP 64,074. Never go past 68,345.', s)).toBe(true)
  })

  it('REFUSES a figure the Manager invented', () => {
    // The whole point. Splitting the difference is arithmetic, and arithmetic
    // is the code's job, not the model's.
    const s = buildDealState(base())
    expect(figuresAreOnFile('Try them at GBP 66,000 as a compromise.', s)).toBe(false)
  })

  it('REFUSES a figure taken from the branch rather than the file', () => {
    const s = buildDealState(base())
    expect(figuresAreOnFile('They want 105,000, so offer that.', s)).toBe(false)
  })

  it('allows an instruction with no figures at all', () => {
    const s = buildDealState(base())
    expect(figuresAreOnFile('Ring Doug and ask where the vendor stands.', s)).toBe(true)
  })

  it('refuses everything when the file has no figures', () => {
    const s = buildDealState(base({ property: { id: 'p1', deal: null } }))
    expect(figuresAreOnFile('Offer GBP 60,000.', s)).toBe(false)
    expect(figuresAreOnFile('Ring them back.', s)).toBe(true)
  })
})

describe('it never throws on a thin deal', () => {
  it('survives a property with nothing on it', () => {
    const s = buildDealState({ property: { id: 'p1' }, now: NOW })
    expect(s.propertyId).toBe('p1')
    expect(s.calls.count).toBe(0)
    expect(s.brief.doNow).toEqual([])
    expect(s.clock.stale).toBe(false)
    expect(s.checklist.missing.length).toBe(CHECKLIST_KEYS.length)
  })
})
