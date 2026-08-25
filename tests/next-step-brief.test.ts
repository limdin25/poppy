// The next-step brain: after every property call, the instruction in writing.
//
// Hugo, 2026-08-14: "build the brain that always after the call gets the
// exactly instruction for the next step for me to read, so after call fires and
// confirm whats next step with confidence."
//
// Three things have to hold or the brief is worse than nothing, because a
// confidently wrong instruction gets acted on:
//
//   1. It never invents a fact. A missing answer is a BLOCKER, never an
//      assumption, and a house with no valuation never carries a figure.
//   2. It never derives the money. Every number is offerRange()/ladderText()
//      off the engine's own deal blob, which is the single-copy rule
//      api/lib/brrr-offer.ts exists to enforce.
//   3. The confidence is about our EVIDENCE, not about how the call felt.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildNextStepBrief, briefToText, streetOf, compCount, externalDoNow } from '../api/lib/next-step-brief'
import { offerRange } from '../api/lib/brrr-offer'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

/** A well-evidenced house, the shape valuation.py actually sends. */
const VALUED = {
  address: 'Orion Way, Grimsby, DN34',
  agent_name: 'DDM Residential, Grimsby',
  asking_price: 110000,
  bedrooms: 2,
  floor_area_sqm: 62,
  status: 'new',
  deal: {
    strategy: 'brrr',
    bmv_band: 'meets_criteria',
    cmv: {
      estimate: 107000,
      confidence: 'high',
      n_used: 4,
      audit: [
        { included: true, price: 105000, address: '12 ORION WAY', date: '2026-01-20' },
        { included: true, price: 110000, address: '30 ORION WAY', date: '2026-02-11' },
      ],
    },
    offer: { open: 96375, max: 102800, ladder: [96375, 99588, 102800] },
  },
}

const FULL_ANSWERS = {
  best_price_indicated: 'vendor would take 100k',
  condition_notes: 'a bit tired, needs redecorating, kitchen okay',
  video_walkthrough: 'sending it over today',
  branch_contact_name: 'Doug',
}

const NOW = new Date('2026-08-14T12:00:00.000Z')

describe('the verdict is decided by facts, never by tone', () => {
  it('KEEPs a valued house and reads the band off the engine', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'qualified', qualification: FULL_ANSWERS,
      step: 'Do the homework', board: 'Discovery done, evaluating', now: NOW,
    })
    expect(b.verdict).toBe('KEEP')
    // The figures are READ, not worked out here.
    const band = offerRange(VALUED)
    expect(b.offer).toBe(band.min)
    expect(b.ceiling).toBe(band.max)
    expect(b.ladder).toContain('£96,375')
    expect(b.ladder).toContain('£102,800')
    expect(b.headline).toBe('KEEP: DDM Residential, Grimsby, Orion Way')
    expect(b.board).toBe('Discovery done, evaluating')
  })

  it('HOLDs a house with no valuation, and refuses to name a figure', () => {
    const b = buildNextStepBrief({
      property: { ...VALUED, deal: {}, asking_price: null }, outcome: 'qualified',
      qualification: FULL_ANSWERS, step: 'Do the homework', now: NOW,
    })
    expect(b.verdict).toBe('HOLD')
    expect(b.offer).toBeNull()
    expect(b.ceiling).toBeNull()
    expect(b.ladder).toBe('')
    expect(b.blockers.join(' ')).toMatch(/no offer band/i)
    // Not one pound sign anywhere in the instruction on an unpriced house.
    expect(b.do_now.join(' ')).not.toMatch(/£/)
    expect(b.confidence.level).toBe('low')
  })

  it('DROPs a not-for-us, and gives nobody an instruction', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'not_qualified', qualification: FULL_ANSWERS,
      step: '', now: NOW,
    })
    expect(b.verdict).toBe('DROP')
    expect(b.who).toBe('NOBODY')
    expect(b.why).toEqual([])
    expect(b.do_now.join(' ')).toMatch(/six-week follow up/i)
  })

  it('DROPs a deal the auditor withdrew, whatever the call said', () => {
    const b = buildNextStepBrief({
      property: { ...VALUED, status: 'auditor_killed' }, outcome: 'qualified',
      qualification: FULL_ANSWERS, step: 'Do the homework', now: NOW,
    })
    expect(b.verdict).toBe('DROP')
    expect(b.blockers.join(' ')).toMatch(/auditor withdrew/i)
  })
})

describe('the instruction says who, and what, in Pedro words', () => {
  it('a no-answer sends Pedro back to the phone, with no number of ours', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'no_answer', qualification: {},
      step: 'Discovery call', now: NOW,
    })
    expect(b.who).toBe('PEDRO')
    expect(b.do_now.join(' ')).toMatch(/Ring DDM Residential, Grimsby again/)
    expect(b.do_now.join(' ')).toMatch(/no number of ours/i)
    expect(b.do_now.join(' ')).not.toMatch(/£/)
  })

  it('a figure obtained puts the homework on Hugo and names the branch figure', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'figure_obtained', qualification: FULL_ANSWERS,
      step: 'Do the homework', board: 'Ballpark agreed', now: NOW,
    })
    expect(b.who).toBe('HUGO')
    expect(b.do_now.join(' ')).toContain('vendor would take 100k')
    expect(b.do_now.join(' ')).toMatch(/builder for a ballpark/i)
    expect(b.do_now.join(' ')).toMatch(/call two/i)
  })

  it('a chase names the person Pedro spoke to and chases what is missing', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'deciding',
      qualification: { ...FULL_ANSWERS, video_walkthrough: '' },
      step: 'Chase the agent', board: 'Offer sent', now: NOW,
    })
    expect(b.who).toBe('PEDRO')
    expect(b.do_now[0]).toMatch(/Ring Doug at DDM Residential, Grimsby/)
    expect(b.do_now.join(' ')).toMatch(/Ask again for the video walkthrough/)
  })

  it('the offer call carries the opener and never the ceiling out loud', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'callback', qualification: FULL_ANSWERS,
      step: 'Offer call', now: NOW,
    })
    expect(b.do_now.join(' ')).toContain('£96,375')
    expect(b.do_now.join(' ')).toMatch(/never say the ceiling/i)
    // The rungs are the engine's own ladder, which ends AT the ceiling, the
    // same figures the offer strip prints above the script. What is forbidden
    // is announcing the walk-away as a walk-away, not climbing to it.
    expect(b.ladder).toBe('£96,375, then £99,588, then £102,800')
  })
})

describe('what is in the way is the part nobody can hold in their head', () => {
  it('names every missing answer, one line each', () => {
    const b = buildNextStepBrief({
      property: { ...VALUED, floor_area_sqm: null }, outcome: 'callback',
      qualification: { video_walkthrough: 'no' }, step: 'Chase the agent', now: NOW,
    })
    const text = b.blockers.join(' ')
    expect(text).toMatch(/No video walkthrough/i)
    expect(text).toMatch(/No floor area/i)
    expect(text).toMatch(/have not named a figure/i)
    expect(text).toMatch(/condition was never pinned down/i)
  })

  it('"no" is an answer, and it still means the thing is missing', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'callback',
      qualification: { ...FULL_ANSWERS, video_walkthrough: 'no' },
      step: 'Chase the agent', now: NOW,
    })
    expect(b.blockers.join(' ')).toMatch(/No video walkthrough/i)
  })

  it('reads proof of funds out of what the agent actually said', () => {
    // Zest Hull, 2026-08-14: the branch would not put the offer to the vendor
    // without it, and that is the whole deal stopped by one attachment.
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'deciding', qualification: FULL_ANSWERS,
      note: 'Lucy will not send it to the vendor without proof of funds',
      step: 'Chase the agent', now: NOW,
    })
    expect(b.blockers.join(' ')).toMatch(/proof of funds/i)
    expect(b.blockers.join(' ')).toMatch(/bank statement/i)
  })

  it('invents no blocker when everything was answered', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'figure_obtained', qualification: FULL_ANSWERS,
      // An address to write to is part of "everything answered": a branch we
      // cannot email is a deal that cannot be put in writing, so it is its own
      // blocker (added 2026-08-14 after Hugo hit "contact has no email").
      contactEmail: 'doug@ddmresidential.co.uk',
      step: 'Do the homework', now: NOW,
    })
    expect(b.blockers).toEqual([])
  })

  it('a branch with no email cannot be written to, and says so', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'figure_obtained', qualification: FULL_ANSWERS,
      step: 'Do the homework', now: NOW,
    })
    expect(b.blockers.join(' ')).toMatch(/No email address for this branch/i)
  })
})

describe('confidence is about the evidence, not the mood of the call', () => {
  it('a full house of evidence is high, and has nothing left to raise', () => {
    const b = buildNextStepBrief({
      property: VALUED, outcome: 'figure_obtained', qualification: FULL_ANSWERS,
      step: 'Do the homework', now: NOW,
    })
    expect(b.confidence.level).toBe('high')
    expect(b.confidence.raise).toBeNull()
  })

  it('a thin valuation with nothing from the call is low, and says what to get', () => {
    const b = buildNextStepBrief({
      property: {
        ...VALUED, floor_area_sqm: null,
        deal: { cmv: { estimate: 90000, confidence: 'low', n_used: 1 }, offer: { open: 70000, max: 75000 } },
      },
      outcome: 'callback', qualification: {}, step: 'Chase the agent', now: NOW,
    })
    expect(b.confidence.level).toBe('low')
    expect(b.confidence.raise).toMatch(/figure out of the branch/i)
  })

  it('never claims confidence on a house it cannot price', () => {
    const b = buildNextStepBrief({
      property: { ...VALUED, deal: {}, asking_price: null },
      outcome: 'figure_obtained', qualification: FULL_ANSWERS,
      step: 'Do the homework', now: NOW,
    })
    expect(b.confidence.level).toBe('low')
  })
})

describe('the text Hugo reads', () => {
  const b = buildNextStepBrief({
    property: VALUED, outcome: 'deciding', qualification: FULL_ANSWERS,
    step: 'Chase the agent', board: 'Offer sent', now: NOW,
  })
  const text = briefToText(b)

  it('is his own shape: verdict, money, why, next, ladder, board, confidence', () => {
    expect(text.split('\n')[0]).toBe('KEEP: DDM Residential, Grimsby, Orion Way')
    expect(text).toMatch(/Asking: £110,000 \| Our offer: £96,375/)
    expect(text).toMatch(/Why it holds:/)
    expect(text).toMatch(/PEDRO next:/)
    expect(text).toMatch(/Price ladder:/)
    expect(text).toMatch(/Board: Offer sent/)
    expect(text).toMatch(/Confidence: high/)
  })

  it('says the ceiling is never said out loud', () => {
    expect(text).toMatch(/never say it out loud/i)
  })

  it('carries no long dash and no curly punctuation', () => {
    // Standing rule, and this text is emailed and pushed to a phone.
    expect(text).not.toMatch(/[–—‘’“”…]/)
  })
})

describe('it reads the shape the LIVE engine actually sends', () => {
  // Checked against Welwyn Park Road and Orion Way on 2026-08-14. Every one of
  // these was wrong on the first pass, on a fixture that looked plausible.
  const LIVE = {
    address: 'Welwyn Park Road, Hull, North Humberside, HU6',
    agent_name: 'Zest, Hull',
    asking_price: 125000,
    bedrooms: 3,
    floor_area_sqm: 80,
    status: 'new',
    deal: {
      strategy: 'brrr_btl',
      bmv_band: 'strong',
      verdict: 'pass',
      comps_note: '3 sold comps, same style, within 400m, sold in the last 12 months',
      why: 'Open at £97,125, never above £103,600. Worth £140,000 done up, less £10,000 refurb, so true value is £129,500.',
      cmv: { comps: 3, estimate: 129500, confidence: 'high', audit: [] },
      evidence: [
        { address: '107 WELWYN PARK ROAD', price: 145000, date: '2026-02-20' },
        { address: '179 SUTTON ROAD', price: 84000, date: '2025-10-31' },
      ],
      offer: { open: 97125, max: 103600, ladder: [97125, 100363, 103600] },
    },
  }

  it('counts comps from cmv.comps, not only the old n_used / audit rows', () => {
    expect(compCount(LIVE.deal)).toBe(3)
    // The old shape and the bare evidence array both still answer.
    expect(compCount({ cmv: { n_used: 4 } })).toBe(4)
    expect(compCount({ evidence: [{}, {}] })).toBe(2)
    expect(compCount({})).toBe(0)
  })

  it('does not print the engine\'s one-word verdict code in the paragraph', () => {
    const b = buildNextStepBrief({
      property: LIVE, outcome: 'deciding', qualification: FULL_ANSWERS,
      step: 'Chase the agent', now: NOW,
    })
    expect(b.why.join(' ')).not.toMatch(/\bpass\b/)
  })

  it('uses the engine\'s own why, minus the band it already prints twice', () => {
    const b = buildNextStepBrief({
      property: LIVE, outcome: 'deciding', qualification: FULL_ANSWERS,
      step: 'Chase the agent', now: NOW,
    })
    const why = b.why.join(' ')
    expect(why).toContain('Worth £140,000 done up')
    // The walk-away appears in the ladder line and nowhere else.
    expect(why).not.toMatch(/never above/)
  })

  it('does not report "no sold comparables" on a house with three', () => {
    const b = buildNextStepBrief({
      property: LIVE, outcome: 'deciding', qualification: FULL_ANSWERS,
      step: 'Chase the agent', now: NOW,
    })
    expect(b.confidence.why).not.toMatch(/no sold comparables/i)
    expect(b.confidence.level).toBe('high')
  })
})

describe('the street name Pedro says', () => {
  it('is the first part of the address', () => {
    expect(streetOf('Welwyn Park Road, Hull, North Humberside, HU6')).toBe('Welwyn Park Road')
    expect(streetOf(null)).toBe('this property')
  })
})

describe('it is wired into the call, and it is the only brain that writes it', () => {
  const route = read('api/crm/property-outcome.ts')

  it('writes a brief on the property after EVERY outcome', () => {
    expect(route).toMatch(/buildNextStepBrief\(/)
    // Written in the same update as the outcome, so a house can never carry a
    // status from today's call and an instruction from last week's. The call
    // gained the house number on 2026-08-25, so the update went multi-line and
    // viewing_address joined it conditionally; what this pins is that all of it
    // is still ONE write.
    const write = route.slice(route.indexOf(".from('brrr_properties')\n    .update({"));
    for (const field of ['status: outcome', 'qualification: mergedQualification', 'notes,', 'brief,']) {
      expect(`${field} in the outcome write`).toBe(
        write.slice(0, 400).includes(field) ? `${field} in the outcome write` : `${field} MISSING`,
      );
    }
  })

  it('sends the brief to Hugo as the notification body', () => {
    expect(route).toMatch(/briefToText\(brief\)/)
  })

  it('MERGES the answers instead of replacing them', () => {
    // The checklist opens blank on every call, so writing it straight through
    // wiped what the previous call learned: ring a branch twice and the figure
    // from the first call disappeared, which is exactly the fact the brief
    // measures its own confidence on.
    expect(route).toMatch(/const mergedQualification/)
    expect(route).toMatch(/priorAnswers/)
  })

  it('never touches the pinned note, which is Hugo\'s alone', () => {
    expect(route).not.toMatch(/pinned_note/)
  })

  it('does no arithmetic on the money', () => {
    const brain = read('api/lib/next-step-brief.ts')
    expect(brain).toMatch(/from '\.\/brrr-offer\.js'/)
    // No hand-rolled band anywhere: every figure comes from offerRange/ladderText.
    expect(brain).not.toMatch(/\*\s*0\.\d/)
    expect(brain).not.toMatch(/asking\s*\*\s/)
  })
})

describe('one rendering of the brief, in core, not in a feature', () => {
  it('the card lives in core so both features can draw it', () => {
    const card = read('src/core/property/NextStepCard.tsx')
    expect(card).toMatch(/NextStepBrief/)
    // Features never import other features. The dialer, Call history and the
    // admin table all point at the same file.
    for (const f of [
      'src/features/crm/components/live-call/PropertiesPane.tsx',
      'src/features/crm/components/calls/DealSnapshotDrawer.tsx',
      'src/features/admin/pages/PropertiesPage.tsx',
    ]) {
      expect(read(f)).toMatch(/NextStepCard/)
    }
    expect(read('src/features/admin/pages/PropertiesPage.tsx')).not.toMatch(/features\/crm/)
  })

  it('draws nothing at all on a house with neither a note nor a brief', () => {
    const card = read('src/core/property/NextStepCard.tsx')
    expect(card).toMatch(/if \(!note && !brief\) return null/)
  })
})

describe('our ceiling never reaches a model writing to the branch', () => {
  // The walk-away is the one figure in the business that must never reach the
  // person we are negotiating against. `do_now` is written for Pedro and Hugo
  // and states it twice: the band ("opens at X and stops at Y") and the ladder,
  // whose last rung IS the ceiling. The very next line of the same array reads
  // "Never say the ceiling out loud", and the whole array was being handed to
  // SYSTEM_FOLLOW_UP as "say the parts that concern THEM".

  it('strips every do-now line carrying one of our figures', () => {
    expect(externalDoNow([
      'Ring them back on Granton Avenue.',
      "Today's band opens at £109,455 and stops at £123,250. Confirm before call two.",
      'Climb one rung at a time: £109,455, £116,352, £123,250.',
      'Chase the video, then send it to the builder.',
    ])).toEqual([
      'Ring them back on Granton Avenue.',
      'Chase the video, then send it to the builder.',
    ])
  })

  it('catches GBP written out as well as the symbol', () => {
    expect(externalDoNow(['Open at GBP 95,000.', 'Ask who is handling it.']))
      .toEqual(['Ask who is handling it.'])
  })

  it('survives nothing at all', () => {
    expect(externalDoNow(null)).toEqual([])
    expect(externalDoNow(undefined)).toEqual([])
  })

  it('the drafter uses the fence, and never the raw array', () => {
    // The fence lives server-side on purpose: a filter at the caller would be
    // one forgotten call away from leaking again.
    const drafter = read('api/crm/draft-offer-email.ts')
    expect(drafter).toMatch(/externalDoNow\(c\.doNow\)/)
    expect(drafter).not.toMatch(/\(c\.doNow \?\? \[\]\)\.map/)
  })

  it('the brief really does put the ceiling in do_now, which is why the fence exists', () => {
    // If this ever stops being true the fence is harmless, but the fact it IS
    // true is the whole reason it was needed. Pinned so nobody removes the
    // fence on the assumption the brief is already safe.
    const brief = read('api/lib/next-step-brief.ts')
    expect(brief).toMatch(/Climb one rung at a time/)
    expect(brief).toMatch(/Never say the ceiling out loud/)
  })
})
