// Pricing can only be defined ONCE.
//
// Before this test there were four independent hardcoded price tables
// (api/lib/review-plans.ts, api/lib/vsl-settings.ts, src/features/reviews/lib.ts,
// src/features/landing/LandingPage.tsx) plus two Stripe price-id lists. They had
// already drifted: the video page advertised Pro as "up to 200 review requests"
// while the send engine enforced 300, and TRIAL_DAYS said 14 while all three
// checkouts hardcoded 10.
//
// This is the thing that stops them growing back. It is worth more than any of
// the individual copy fixes.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const CANON = 'api/lib/review-plans.ts'

/** Every .ts/.tsx under a dir, skipping node_modules/dist/build output. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (['node_modules', 'dist', 'out', '.git', 'coverage'].includes(entry)) continue
    const rel = join(dir, entry)
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(rel)
  }
  return out
}

const SOURCE_FILES = [...walk('api'), ...walk('src')]

describe('pricing has exactly one source of truth', () => {
  it('no Stripe reviews price id is hardcoded outside the canon', () => {
    // vsl-settings owns the separate one-time £1 price (it reads process.env,
    // which the canon deliberately cannot).
    const allowed = new Set([CANON, 'api/lib/vsl-settings.ts'])
    const offenders = SOURCE_FILES.filter((f) => {
      if (allowed.has(f)) return false
      return /price_1Tv[A-Za-z0-9]+/.test(read(f))
    })
    expect(offenders).toEqual([])
  })

  it('no tier price is written as a literal outside the canon', () => {
    const offenders = SOURCE_FILES.filter((f) => {
      if (f === CANON) return false
      return /£(99|179|279)\b/.test(read(f))
    })
    expect(offenders).toEqual([])
  })

  it('every Stripe trial length reads TRIAL_DAYS', () => {
    const withTrial = SOURCE_FILES.filter((f) => /trial_period_days/.test(read(f)))
    expect(withTrial.length).toBeGreaterThan(0)
    for (const f of withTrial) {
      expect(read(f)).toMatch(/trial_period_days: TRIAL_DAYS/)
      expect(read(f)).not.toMatch(/trial_period_days: \d/)
    }
  })

  it('the canon agrees with what the send engine actually enforces', () => {
    const canon = read(CANON)
    expect(canon).toMatch(/TRIAL_DAYS = 10/)
    expect(canon).toMatch(/POUND_ENTRY_GBP = 1/)
    // Pro: the VSL page used to say 200 while capForPlan returned 300.
    expect(canon).toMatch(/requestsPerMonth: 300/)
  })

  it('the canon stays importable from the browser', () => {
    // Comments are stripped first — the file explains WHY it may not use
    // process.env, and that explanation shouldn't trip its own guard.
    const canon = read(CANON)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // Both would break the src → api/lib import: relative specifiers need .js
    // suffixes under node16, and secrets must never ship to a client bundle.
    expect(canon).not.toMatch(/^import .* from '\.\.?\//m)
    expect(canon).not.toMatch(/process\.env/)
  })

  it('the £1 is charged on every door, not just the video page', () => {
    for (const f of ['api/vsl/checkout.ts', 'api/billing/checkout.ts', 'api/crm/subscribe-lead.ts']) {
      expect(read(f)).toMatch(/VSL_POUND_PRICE/)
    }
  })

  it('no live surface promises nothing is charged', () => {
    // report-html.ts is the FROZEN 22–24 July call audit. It quotes what an
    // agent actually said on a real call; rewriting it would falsify the
    // record, so it is excluded deliberately rather than "fixed".
    const historical = new Set(['api/lib/report-html.ts'])
    const offenders = SOURCE_FILES.filter((f) =>
      !historical.has(f) &&
      /nothing(’|')?s? charged for \d+ days|before you(’|')?ve paid a penny/i.test(read(f)))
    expect(offenders).toEqual([])
  })
})

describe('the sales floor never quotes the monthly tiers', () => {
  // The call motion changed on 2026-07-26: the agent's only job is permission
  // to send the video. The coach prompt and the script were rewritten then —
  // these two surfaces were missed and still read the tiers aloud.
  it('the objections playbook answers price with the pound', () => {
    const objections = read('src/features/crm/data/salesObjections.ts')
    expect(objections).not.toMatch(/£(99|179|279)\b/)
    expect(objections).toMatch(/starts at a pound|£1/i)
  })

  it('the coach seed cannot revert the audit-call motion', () => {
    // seed-coach-facts.mjs and seed-audit-call-motion.sql both write
    // wk_coach_facts. Whichever runs last wins, and the .mjs used to restore
    // the retired "£99/mo … nothing charged for 10 days" copy.
    const seed = read('scripts/seed-coach-facts.mjs')
    expect(seed).not.toMatch(/£(99|179|279)\b/)
    expect(seed).not.toMatch(/nothing charged for \d+ days/i)
  })

  it('the always-visible script FAQ matches the pound offer', () => {
    // The reachability walk in vsl-funnel-events.test.ts only covers the node
    // graph; the FAQ rail and calculator render unconditionally and were missed.
    const script = read('src/core/content/one-call-script.html')
    const faqStart = script.indexOf('function renderFAQ')
    const faq = faqStart > -1 ? script.slice(faqStart) : script
    expect(faq).not.toMatch(/nothing(’|')?s charged for \d+ days/i)
  })
})
