import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  lineAlive,
  LINE_STATUS_CACHE_TTL_DAYS,
  LTI_CACHE_TTL_DAYS,
  LINE_STATUS_GBP_PER_LOOKUP,
  LINE_STATUS_MAX_SPEND_GBP,
  LINE_STATUS_MIN_ANSWER_RATE,
  spendCheck,
  answerVerdict,
} from '../api/lib/twilio-lookup.js'
import {
  lineAlive as lineAliveMjs,
  LINE_STATUS_CACHE_TTL_DAYS as TTL_MJS,
  LINE_STATUS_MAX_SPEND_GBP as CAP_MJS,
  LINE_STATUS_MIN_ANSWER_RATE as MIN_RATE_MJS,
  spendCheck as spendCheckMjs,
  answerVerdict as answerVerdictMjs,
  maxSpendGbp,
  warnIfShort,
} from '../scripts/lib/line-status.mjs'

// Hugo, 2026-07-28: Maria cold-texted 100 UK plumbers and 5 numbers were dead on
// the network. Our own check is libphonenumber, an OFFLINE rulebook. It proves
// a well-formed, allocated GB mobile and nothing else (api/lib/phone-validation.ts
// hardcodes active_status:'unknown'). Twilio Lookup line_type_intelligence was
// no help either: all 8 dead numbers came back valid:true, type:mobile, on real
// carriers. Only line_status asks the subscriber's own operator.
//
// Ground truth from the live API on those exact numbers (2026-07-28):
//   +447969101205 inactive   +447866015878 inactive
//   +447388630835 inactive   +447393559230 inactive
//   ...and every number that actually delivered came back "reachable".
// Real response shape, confirmed not guessed:
//   { "phone_number": "+447969101205", "valid": true,
//     "line_status": { "status": "inactive", "error_code": null }, ... }

const root = resolve(__dirname, '..')

describe('lineAlive: only "inactive" is screened out', () => {
  it('screens out inactive (the four real dead numbers)', () => {
    const r = lineAlive('inactive')
    expect(r.line_alive).toBe(false)
    expect(r.line_status_reason).toBe('inactive')
    expect(lineAliveMjs('inactive')).toBe(false)
  })

  it('KEEPS unreachable, the handset is off right now but the lead is alive', () => {
    // The one that would quietly destroy good leads. "unreachable" is a real,
    // paying subscriber whose phone is switched off or out of signal; the
    // network queues the SMS and delivers it when the phone comes back.
    const r = lineAlive('unreachable')
    expect(r.line_alive).toBe(true)
    expect(r.line_status_reason).toBe('unreachable')
    expect(lineAliveMjs('unreachable')).toBe(true)
    expect(lineAliveMjs('unreachable')).not.toBe(false)
  })

  it('keeps active and reachable', () => {
    for (const s of ['active', 'reachable']) {
      expect(lineAlive(s).line_alive).toBe(true)
      expect(lineAliveMjs(s)).toBe(true)
    }
  })

  it('keeps "unknown", Twilio could not reach the operator, not evidence of death', () => {
    expect(lineAlive('unknown').line_alive).toBe(null)
    expect(lineAliveMjs('unknown')).toBe(null)
    // never a hard drop
    expect(lineAlive('unknown').line_alive).not.toBe(false)
    expect(lineAliveMjs('unknown')).not.toBe(false)
  })

  it('is case-insensitive, so a shape change in casing cannot flip the rule', () => {
    expect(lineAlive('INACTIVE').line_alive).toBe(false)
    expect(lineAlive('Unreachable').line_alive).toBe(true)
    expect(lineAliveMjs('INACTIVE')).toBe(false)
    expect(lineAliveMjs('Unreachable')).toBe(true)
  })

  it('fails OPEN on a status Twilio has not documented yet', () => {
    expect(lineAlive('something_new').line_alive).toBe(null)
    expect(lineAliveMjs('something_new')).toBe(null)
  })
})

describe('fail open on API error, so a bad minute at Twilio never drops a lead', () => {
  it('null / empty status is "no answer", never "dead"', () => {
    for (const bad of [null, '', undefined as unknown as null]) {
      const r = lineAlive(bad)
      expect(r.line_alive).toBe(null)
      expect(r.line_alive).not.toBe(false)
      expect(lineAliveMjs(bad)).toBe(null)
    }
    expect(lineAlive(null).line_status_reason).toBe('lookup_failed')
  })

  it('a 200 with line_status:null is treated as no answer, not as dead', () => {
    // The real API answers HTTP 200 with "line_status": null for a number it has
    // no data for (verified live on +4470000). Reading that as "dead" would
    // delete leads on Twilio's coverage gaps.
    const src = readFileSync(resolve(root, 'api/lib/twilio-lookup.ts'), 'utf8')
    const fn = src.split('async function lineStatusOne')[1] ?? ''
    expect(fn).toMatch(/if \(!ls \|\| !ls\.status\) return \{ status: null[^}]*ok: false \}/)
    const mjs = readFileSync(resolve(root, 'scripts/lib/line-status.mjs'), 'utf8')
    expect(mjs).toMatch(/if \(!ls \|\| !ls\.status\) return \{ status: null[^}]*ok: false \}/)
  })

  it('missing Twilio credentials drops nobody, then stops the run', () => {
    // Two separate promises. (a) Nothing is ever added to `dead` when the screen
    // could not run, so no lead is deleted by an outage. (b) The run does not
    // then carry on as if it had been screened: with no credentials nothing
    // answers, so the answer-rate guard below takes over and aborts.
    const mjs = readFileSync(resolve(root, 'scripts/lib/line-status.mjs'), 'utf8')
    expect(mjs).toMatch(/cannot screen\. Keeping every number \(fail open\)/)
    const guard = mjs.split('if (!sid || !token)')[1]?.split('} else {')[0] ?? ''
    expect(guard).not.toMatch(/dead\.add/)
    expect(guard).toMatch(/answered stays 0/)
  })
})

describe('the cache TTL is short, and is NOT the 90-day line-type TTL', () => {
  it('uses 7 days, not 90', () => {
    // Line TYPE is a property of the numbering plan and never really changes, so
    // 90 days is right for it. Line STATUS is live state: a subscription alive
    // today can be cut off next week, and a 90-day-old "reachable" would quietly
    // re-open the exact hole this screen exists to close.
    expect(LTI_CACHE_TTL_DAYS).toBe(90)
    expect(LINE_STATUS_CACHE_TTL_DAYS).toBe(7)
    expect(LINE_STATUS_CACHE_TTL_DAYS).not.toBe(LTI_CACHE_TTL_DAYS)
    expect(LINE_STATUS_CACHE_TTL_DAYS).toBeLessThanOrEqual(14)
  })

  it('the .mjs twin the scripts import agrees on the TTL', () => {
    expect(TTL_MJS).toBe(LINE_STATUS_CACHE_TTL_DAYS)
  })

  it('reads its own cache table, never phone_lti_cache', () => {
    const src = readFileSync(resolve(root, 'api/lib/twilio-lookup.ts'), 'utf8')
    const section = src.split('async function lineStatusCacheRead')[1] ?? ''
    expect(section).toMatch(/phone_line_status_cache/)
    // Sharing the LTI table would inherit its 90-day rows.
    expect(section.split('async function lineStatusOne')[0]).not.toMatch(/phone_lti_cache/)
  })

  it('only writes the numbers it actually looked up, so a cache hit never re-stamps checked_at', () => {
    // Verified live 2026-07-28 the same way the LTI cache was: three numbers
    // screened cold (Twilio billed 3, usage went 114 -> 117), then screened
    // twice more. checked_at was byte-identical afterwards and the usage counter
    // did not move. The mechanism is this: the write is fed from `misses`, never
    // from the full input list.
    for (const [rel, marker] of [
      ['api/lib/twilio-lookup.ts', 'await lineStatusCacheWrite('],
      ['scripts/lib/line-status.mjs', 'await cacheWrite('],
    ] as const) {
      const src = readFileSync(resolve(root, rel), 'utf8')
      const write = src.split(marker)[1]?.split('\n\n')[0] ?? ''
      expect(write, rel).toMatch(/misses|answered/)
      expect(write, rel).not.toMatch(/\bunique\b/)
    }
  })

  it('the LTI path still uses its own 90-day table, unchanged', () => {
    const src = readFileSync(resolve(root, 'api/lib/twilio-lookup.ts'), 'utf8')
    const section = src.split('async function cacheRead')[1]?.split('async function cacheWrite')[0] ?? ''
    expect(section).toMatch(/phone_lti_cache/)
    expect(section).toMatch(/LTI_CACHE_TTL_DAYS/)
  })
})

describe('the cache table migration', () => {
  const mig = readFileSync(
    resolve(root, 'supabase/migrations/20260728000006_line_status_cache.sql'),
    'utf8',
  )

  it('creates phone_line_status_cache keyed by number, with a checked_at stamp', () => {
    expect(mig).toMatch(/create table if not exists phone_line_status_cache/i)
    expect(mig).toMatch(/e164 text primary key/i)
    expect(mig).toMatch(/line_status text/i)
    expect(mig).toMatch(/checked_at timestamptz not null default now\(\)/i)
  })

  it('is service-role only, mirroring phone_lti_cache (RLS on, no policies)', () => {
    expect(mig).toMatch(/alter table phone_line_status_cache enable row level security/i)
    expect(mig).not.toMatch(/create policy/i)
  })
})

describe('the paid gate is wired into every lead path, and runs LAST', () => {
  const gated = [
    'feed-maria-leads.mjs',
    'process-plumber-leads.mjs',
    'assign-agent-batches.mjs',
    'scrape-trade-leads.mjs',
    'assign-trade-leads-to-pedro-marr.mjs',
    'import-plumber-leads.mjs',
    'blast-maria-website-opener.mjs',
  ]

  it('every import script and the send path import the screen', () => {
    for (const f of gated) {
      const src = readFileSync(resolve(root, 'scripts', f), 'utf8')
      expect(src, f).toMatch(/from '\.\/lib\/line-status\.mjs'/)
    }
  })

  it('spends money only after the free checks, so the offline phone gate is first', () => {
    // Cheapest first: format (free, offline) -> Google/website/review checks ->
    // line_status (paid). If the paid call ever moved above the free ones we
    // would be buying lookups for leads we were about to throw away anyway.
    for (const f of ['feed-maria-leads.mjs', 'process-plumber-leads.mjs', 'assign-agent-batches.mjs', 'import-plumber-leads.mjs']) {
      const src = readFileSync(resolve(root, 'scripts', f), 'utf8')
      const freeGate = src.indexOf('isTextableUkMobile(phone)')
      const paidGate = src.indexOf('dropDeadNumbers(')
      expect(freeGate, `${f}: free phone gate`).toBeGreaterThan(-1)
      expect(paidGate, `${f}: paid line-status gate`).toBeGreaterThan(-1)
      expect(paidGate, `${f}: paid gate must run after the free one`).toBeGreaterThan(freeGate)
    }
  })

  it('feed-maria-leads screens after the Google website/review checks too', () => {
    const src = readFileSync(resolve(root, 'scripts/feed-maria-leads.mjs'), 'utf8')
    expect(src.indexOf('dropDeadNumbers(')).toBeGreaterThan(src.indexOf('await findOwnWebsite('))
    expect(src.indexOf('dropDeadNumbers(')).toBeGreaterThan(src.indexOf('await lookupPlace('))
  })

  it('screens before anything is written to the CRM', () => {
    const src = readFileSync(resolve(root, 'scripts/feed-maria-leads.mjs'), 'utf8')
    expect(src.indexOf('dropDeadNumbers(')).toBeLessThan(src.indexOf(".from('wk_contacts')\n    .insert("))
  })

  it('prints a cost estimate BEFORE it spends, and can be turned off entirely', () => {
    const mjs = readFileSync(resolve(root, 'scripts/lib/line-status.mjs'), 'utf8')
    const estimateAt = mjs.indexOf('to look up ~ GBP')
    const spendAt = mjs.indexOf('await Promise.all(Array.from({ length: Math.min(CONCURRENCY')
    expect(estimateAt).toBeGreaterThan(-1)
    expect(spendAt).toBeGreaterThan(estimateAt)
    expect(mjs).toMatch(/SKIP_LINE_STATUS === '1'/)
    // The no-spend switch must fail OPEN, never drop anyone.
    const noSpend = mjs.split("SKIP_LINE_STATUS === '1'")[1]?.split('return result')[0] ?? ''
    expect(noSpend).toMatch(/result\.unknown\.add\(n\)/)
    expect(noSpend).not.toMatch(/dead\.add/)
  })

  it('prices a lookup at the rate actually billed, about half a penny', () => {
    // Measured on Hugo's account 2026-07-28: 114 line-status lookups = GBP
    // 0.60306, i.e. GBP 0.00529 each, GBP 5.29 per 1,000 leads.
    expect(LINE_STATUS_GBP_PER_LOOKUP).toBeGreaterThan(0.004)
    expect(LINE_STATUS_GBP_PER_LOOKUP).toBeLessThan(0.008)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A real run of the screen, in a real child process, against a stubbed network.
//
// Everything below drives the ACTUAL screenLineStatus, not a copy of its rules.
// The guards it is testing call process.exit, which would take the test runner
// with them, so each case runs in its own `node` process with globalThis.fetch
// replaced before the library is imported. Nothing touches Twilio or Supabase:
// every fetch is answered by the stub, and the child sets its own fake
// credentials first so loadRepoEnv() cannot fill in the real ones.
// ─────────────────────────────────────────────────────────────────────────────

const LIB_URL = pathToFileURL(resolve(root, 'scripts/lib/line-status.mjs')).href

const CHILD = `
process.env.SUPABASE_URL = 'https://fake.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key'
process.env.TWILIO_ACCOUNT_SID = 'ACfake'
process.env.TWILIO_AUTH_TOKEN = 'faketoken'
let twilio = 0
globalThis.fetch = async (url, init) => {
  const u = String(url)
  if (u.includes('lookups.twilio.com')) {
    const mine = ++twilio
    console.log('__TWILIO_CALL__')
    if (process.env.T_MODE === 'fail') return { ok: false, status: 401, json: async () => ({}) }
    if (process.env.T_MODE === 'half' && mine % 2 === 0) return { ok: false, status: 500, json: async () => ({}) }
    if (process.env.T_MODE === 'mostly-fail' && mine % 4 !== 0) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ line_status: { status: 'reachable', error_code: null } }) }
  }
  if (u.includes('phone_line_status_cache')) {
    const isRead = !init || (init.method ?? 'GET') === 'GET'
    if (isRead && process.env.T_CACHE === 'hit') {
      const nums = (decodeURIComponent(u).match(/\\+\\d+/g) || [])
      const now = new Date().toISOString()
      return { ok: true, status: 200, json: async () => nums.map((e164) => ({ e164, line_status: 'reachable', error_code: null, checked_at: now })) }
    }
    return { ok: true, status: 200, json: async () => [] }
  }
  return { ok: false, status: 500, json: async () => ({}) }
}
const { screenLineStatus } = await import(process.env.T_LIB)
const r = await screenLineStatus(JSON.parse(process.env.T_NUMBERS), { label: 'test' })
console.log('__RESULT__' + JSON.stringify({
  checked: r.checked, cached: r.cached, attempted: r.attempted, answered: r.answered,
  billed: r.billed, costGbp: r.costGbp, skipped: r.skipped,
  dead: [...r.dead], unknown: [...r.unknown],
}))
`

function runScreen(opts: {
  count?: number
  mode?: 'ok' | 'fail' | 'half' | 'mostly-fail'
  cache?: 'hit' | 'miss'
  env?: Record<string, string>
}) {
  const numbers = Array.from({ length: opts.count ?? 10 }, (_, i) => `+4479000${String(i).padStart(5, '0')}`)
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      T_LIB: LIB_URL,
      T_NUMBERS: JSON.stringify(numbers),
      T_MODE: opts.mode ?? 'ok',
      T_CACHE: opts.cache ?? 'miss',
      ...(opts.env ?? {}),
    },
  })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  const line = (res.stdout ?? '').split('\n').find((l) => l.startsWith('__RESULT__'))
  return {
    code: res.status,
    out,
    twilioCalls: (out.match(/__TWILIO_CALL__/g) ?? []).length,
    result: line ? JSON.parse(line.slice('__RESULT__'.length)) : null,
    numbers,
  }
}

describe('DEFECT 3: a broken screen must not look like a working one', () => {
  it('a working screen bills what ANSWERED and reports the real cost', () => {
    const r = runScreen({ count: 10, mode: 'ok' })
    expect(r.code).toBe(0)
    expect(r.twilioCalls).toBe(10)
    expect(r.result.attempted).toBe(10)
    expect(r.result.answered).toBe(10)
    expect(r.result.billed).toBe(10)
    expect(r.result.costGbp).toBeCloseTo(10 * LINE_STATUS_GBP_PER_LOOKUP, 6)
    expect(r.out).toContain('10 answered')
  })

  it('a totally dead screen (401 on every lookup) STOPS instead of passing the list through', () => {
    // This is the defect verbatim: wrong credentials, Lookup disabled, or a
    // Twilio outage. Every lookup fails, every number becomes "unknown", the
    // screen keeps all 10, and it used to print "Billed 10 lookup(s) = GBP 0.05"
    // on the way out. A cost line was the only evidence anything had happened,
    // and it was evidence of nothing.
    const r = runScreen({ count: 10, mode: 'fail' })
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('LINE-STATUS SCREEN FAILED. NOTHING WAS ACTUALLY SCREENED.')
    expect(r.out).toContain('Asked Twilio about 10 number(s). Only 0 came back.')
    // it never returns, so no caller can carry on with an unscreened list
    expect(r.result).toBe(null)
    // and it never claims a bill it did not run up
    expect(r.out).not.toMatch(/billed about GBP 0\.05/)
  })

  it('no Twilio credentials at all falls into the same guard, it cannot slip past it', () => {
    // Not runnable as a live case: loadRepoEnv() fills the credentials from the
    // repo .env precisely so a run cannot silently fail open, so on Hugo's
    // machine they are never actually absent. What matters is that the branch
    // has no way out. It warns and falls through, leaving answered at 0, and
    // answerVerdict turns 0-of-N into an abort.
    const mjs = readFileSync(resolve(root, 'scripts/lib/line-status.mjs'), 'utf8')
    const branch = mjs.split('if (!sid || !token)')[1]?.split('} else {')[0] ?? ''
    expect(branch).toMatch(/cannot screen/)
    expect(branch).not.toMatch(/return result/)      // no early exit past the guard
    expect(branch).not.toMatch(/result\.answered =/) // answered stays 0
    expect(answerVerdictMjs(10, 0).ok).toBe(false)   // so the run stops
  })

  it('a partial outage below half answering stops too', () => {
    const r = runScreen({ count: 12, mode: 'mostly-fail' }) // 3 of 12 answer
    expect(r.code).not.toBe(0)
    expect(r.out).toContain('Only 3 came back')
  })

  it('exactly half answering is still a run: it keeps going and bills only the half that answered', () => {
    const r = runScreen({ count: 10, mode: 'half' })
    expect(r.code).toBe(0)
    expect(r.result.attempted).toBe(10)
    expect(r.result.answered).toBe(5)
    expect(r.result.billed).toBe(5)
    // the 5 that did not answer are KEPT, never dropped (fail open per number)
    expect(r.result.dead).toEqual([])
    expect(r.result.unknown.length).toBe(5)
  })

  it('a 100% CACHE HIT is not a failure: 0 attempted, 0 billed, no banner', () => {
    // The guard must never fire on the cheapest possible good outcome. Nothing
    // was asked, so nothing answering is correct, not broken.
    const r = runScreen({ count: 10, mode: 'ok', cache: 'hit' })
    expect(r.code).toBe(0)
    expect(r.twilioCalls).toBe(0)
    expect(r.result.cached).toBe(10)
    expect(r.result.attempted).toBe(0)
    expect(r.result.billed).toBe(0)
    expect(r.result.costGbp).toBe(0)
    expect(r.out).not.toContain('SCREEN FAILED')
    expect(r.out).toContain('billed about GBP 0.00')
  })

  it('answerVerdict is the rule, and both implementations agree on it', () => {
    for (const v of [answerVerdict, answerVerdictMjs]) {
      expect(v(0, 0).ok).toBe(true)          // fully cached, nothing asked
      expect(v(0, 0).reason).toBe('nothing_to_look_up')
      expect(v(100, 100).ok).toBe(true)
      expect(v(100, 50).ok).toBe(true)       // the boundary passes
      expect(v(100, 49).ok).toBe(false)
      expect(v(100, 0).ok).toBe(false)
      expect(v(100, 0).reason).toBe('too_few_answered')
      expect(v(1, 0).ok).toBe(false)
    }
    expect(MIN_RATE_MJS).toBe(LINE_STATUS_MIN_ANSWER_RATE)
  })

  it('the cost line is computed from answered, never from cache misses', () => {
    const mjs = readFileSync(resolve(root, 'scripts/lib/line-status.mjs'), 'utf8')
    expect(mjs).toMatch(/result\.billed = answered\.length/)
    expect(mjs).toMatch(/result\.costGbp = answered\.length \* LINE_STATUS_GBP_PER_LOOKUP/)
    expect(mjs).not.toMatch(/result\.billed = misses\.length/)
    expect(mjs).not.toMatch(/result\.costGbp = misses\.length/)
  })
})

describe('DEFECT 5: a spend cap, checked before anything is bought', () => {
  it('the default cap blocks the runs that would have hurt', () => {
    // The full 11,707-row plumber CSV, the exact number in the review.
    const full = spendCheck(11707)
    expect(full.estimateGbp).toBeCloseTo(62.05, 1)
    expect(full.over).toBe(true)
    expect(full.suggestGbp).toBe(63)
    // assign-agent-batches' default: 1000 leads x 2 agents.
    const twoAgents = spendCheck(2000)
    expect(twoAgents.estimateGbp).toBeCloseTo(10.6, 1)
    expect(twoAgents.over).toBe(false)
    // and the cap itself is a number a person would pick
    expect(LINE_STATUS_MAX_SPEND_GBP).toBe(15)
    expect(CAP_MJS).toBe(LINE_STATUS_MAX_SPEND_GBP)
  })

  it('both implementations price and cap identically', () => {
    for (const n of [0, 1, 100, 2830, 2840, 11707]) {
      expect(spendCheckMjs(n, 15)).toEqual(spendCheck(n, 15))
    }
    // exactly at the cap is allowed; a penny over is not
    expect(spendCheck(1000, 5.3).over).toBe(false)
    expect(spendCheck(1001, 5.3).over).toBe(true)
  })

  it('LINE_STATUS_MAX_SPEND overrides the cap, and a blank one does not mean zero', () => {
    const before = process.env.LINE_STATUS_MAX_SPEND
    try {
      delete process.env.LINE_STATUS_MAX_SPEND
      expect(maxSpendGbp()).toBe(15)
      process.env.LINE_STATUS_MAX_SPEND = '70'
      expect(maxSpendGbp()).toBe(70)
      process.env.LINE_STATUS_MAX_SPEND = ''
      expect(maxSpendGbp()).toBe(15)      // Number('') is 0; a blank var must not cap at zero pounds
      process.env.LINE_STATUS_MAX_SPEND = 'lots'
      expect(maxSpendGbp()).toBe(15)
    } finally {
      if (before === undefined) delete process.env.LINE_STATUS_MAX_SPEND
      else process.env.LINE_STATUS_MAX_SPEND = before
    }
  })

  it('over the cap: it aborts having spent NOTHING, and prints the command to allow it', () => {
    const r = runScreen({ count: 10, mode: 'ok', env: { LINE_STATUS_MAX_SPEND: '0.01' } })
    expect(r.code).not.toBe(0)
    expect(r.twilioCalls).toBe(0)                    // the proof: no lookup was bought
    expect(r.result).toBe(null)
    expect(r.out).toContain('SPEND CAP HIT. NOTHING WAS SPENT, NOTHING WAS WRITTEN OR SENT.')
    expect(r.out).toContain('You have not been charged anything.')
    expect(r.out).toMatch(/LINE_STATUS_MAX_SPEND=1 node /)
    expect(r.out).toMatch(/SKIP_LINE_STATUS=1 node /)
  })

  it('under the cap it runs as normal', () => {
    const r = runScreen({ count: 10, mode: 'ok', env: { LINE_STATUS_MAX_SPEND: '1' } })
    expect(r.code).toBe(0)
    expect(r.twilioCalls).toBe(10)
  })

  it('the no-spend switch is checked BEFORE the cap, so skipping is never blocked', () => {
    const r = runScreen({ count: 10, mode: 'ok', env: { LINE_STATUS_MAX_SPEND: '0.01', SKIP_LINE_STATUS: '1' } })
    expect(r.code).toBe(0)
    expect(r.twilioCalls).toBe(0)
    expect(r.result.skipped).toBe(true)
  })

  it('every script that spends goes through the one capped entry point', () => {
    // The cap lives in screenLineStatus, and dropDeadNumbers is a wrapper around
    // it, so covering every script means letting no script call Twilio Lookup
    // itself. Nothing may talk to lookups.twilio.com outside the library.
    const files = readdirSync(resolve(root, 'scripts')).filter((f) => f.endsWith('.mjs'))
    for (const f of files) {
      const src = readFileSync(resolve(root, 'scripts', f), 'utf8')
      expect(src, f).not.toMatch(/lookups\.twilio\.com/)
    }
    const lib = readFileSync(resolve(root, 'scripts/lib/line-status.mjs'), 'utf8')
    expect(lib).toMatch(/lookups\.twilio\.com/)
    // and the cap is enforced before the workers start
    expect(lib.indexOf('if (spend.over)')).toBeLessThan(lib.indexOf('await Promise.all(Array.from({ length: Math.min(CONCURRENCY'))
  })
})

describe('SKIP_LINE_STATUS: what it actually does, and its clearer alias', () => {
  it('skips ONLY the paid screen, spends nothing, keeps every number unscreened', () => {
    const r = runScreen({ count: 10, mode: 'ok', env: { SKIP_LINE_STATUS: '1' } })
    expect(r.code).toBe(0)
    expect(r.twilioCalls).toBe(0)
    expect(r.result.skipped).toBe(true)
    expect(r.result.dead).toEqual([])                 // it can never drop anyone
    expect(r.result.unknown.length).toBe(10)          // all kept, all unscreened
    expect(r.result.billed).toBe(0)
    expect(r.result.costGbp).toBe(0)
    expect(r.out).toContain('Every number kept UNSCREENED')
  })

  it('NO_LINE_STATUS_SPEND=1 is an alias and does exactly the same thing', () => {
    // The old name was being read as "dry run the whole script", which it has
    // never been: the import still happens, it just happens unscreened. The old
    // name keeps working so nothing anyone has already typed breaks.
    const a = runScreen({ count: 10, mode: 'ok', env: { SKIP_LINE_STATUS: '1' } })
    const b = runScreen({ count: 10, mode: 'ok', env: { NO_LINE_STATUS_SPEND: '1' } })
    expect(b.code).toBe(0)
    expect(b.twilioCalls).toBe(0)
    expect(b.result).toEqual(a.result)
  })

  it('anything other than exactly "1" does NOT skip, so a typo cannot silently unscreen a list', () => {
    const r = runScreen({ count: 10, mode: 'ok', env: { SKIP_LINE_STATUS: 'true' } })
    expect(r.code).toBe(0)
    expect(r.twilioCalls).toBe(10)
    expect(r.result.skipped).toBe(false)
  })
})

describe('DEFECT 7: a short batch says so', () => {
  it('warns loudly with delivered versus requested, and stays quiet when it hit the target', () => {
    const lines: string[] = []
    const orig = console.warn
    console.warn = (...a: unknown[]) => { lines.push(a.join(' ')) }
    try {
      expect(warnIfShort(1000, 950, { label: 'batches', what: 'leads' })).toBe(true)
      expect(warnIfShort(1000, 1000)).toBe(false)
      expect(warnIfShort(1000, 1200)).toBe(false)
      expect(warnIfShort(0, 0)).toBe(false)
    } finally {
      console.warn = orig
    }
    const said = lines.join('\n')
    expect(said).toContain('YOU ASKED FOR 1000, THIS RUN DELIVERED 950')
    expect(said).toContain('50 fewer leads than you asked for')
    expect(said).toContain('(batches)')
    // it must explain WHY, or Hugo reads it as a bug
    expect(said).toMatch(/filled first and screened after/)
    // and it must not invent an automatic top-up loop (runaway spend)
    expect(said).toMatch(/Run it again/)
    expect(lines.length).toBe(1)
  })

  it('every script with a target count warns when it comes up short', () => {
    // The keeper loop stops AT the target, then the paid screen removes dead
    // numbers from that finished list, so the delivered count is normally under
    // the ask. Three of these four used to say nothing at all.
    const wired: Array<[string, string]> = [
      ['feed-maria-leads.mjs', 'COUNT'],
      ['process-plumber-leads.mjs', 'COUNT'],
      ['import-plumber-leads.mjs', 'COUNT'],
      ['assign-agent-batches.mjs', 'NEEDED'],
      ['scrape-trade-leads.mjs', 'WANT'],
    ]
    for (const [f, target] of wired) {
      const src = readFileSync(resolve(root, 'scripts', f), 'utf8')
      expect(src, f).toMatch(/import \{[^}]*warnIfShort[^}]*\} from '\.\/lib\/line-status\.mjs'/)
      expect(src, f).toMatch(new RegExp(`warnIfShort\\(${target},`))
      // and it must warn on the count AFTER the screen, not the one before it
      expect(src.indexOf('warnIfShort('), f).toBeGreaterThan(src.indexOf('LAST GATE') > -1 ? src.indexOf('LAST GATE') : 0)
    }
  })
})

describe('DEFECT 6: a dry run that spends money says so', () => {
  it('blast-maria-website-opener stops claiming to be free', () => {
    const src = readFileSync(resolve(root, 'scripts/blast-maria-website-opener.mjs'), 'utf8')
    // The old header said "DRY RUN BY DEFAULT" with no caveat while the paid
    // screen ran 14 lines above the dry-run exit.
    expect(src).not.toMatch(/DRY RUN BY DEFAULT\. Pass --apply to actually send\./)
    expect(src).toMatch(/NO TEXT IS SENT WITHOUT --apply\. BUT THE DRY RUN IS NOT FREE\./)
    // the header must give the escape hatch for a genuinely free run
    expect(src).toMatch(/SKIP_LINE_STATUS=1/)
    // and it must say it at RUN TIME too, because nobody reads a header
    const noticeAt = src.indexOf('The paid network screen still runs')
    const screenAt = src.indexOf('await screenLineStatus(')
    expect(noticeAt).toBeGreaterThan(-1)
    expect(noticeAt).toBeLessThan(screenAt)
    // the closing dry-run message reports what it actually cost
    expect(src).toMatch(/The network screen did run and cost about GBP/)
  })

  it('the other script that screens before its dry-run exit says it too', () => {
    const src = readFileSync(resolve(root, 'scripts/assign-trade-leads-to-pedro-marr.mjs'), 'utf8')
    expect(src).toMatch(/free of consequences, not free of charge/)
    expect(src.indexOf('The paid network screen still runs')).toBeLessThan(src.indexOf('await dropDeadNumbers('))
  })
})

describe('no lead-import script ever screens on "unreachable"', () => {
  it('nothing in scripts/ or api/lib treats unreachable as a drop', () => {
    const files = [
      ...readdirSync(resolve(root, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`),
      ...readdirSync(resolve(root, 'scripts/lib')).map((f) => `scripts/lib/${f}`),
      'api/lib/twilio-lookup.ts',
    ]
    for (const rel of files) {
      const src = readFileSync(resolve(root, rel), 'utf8')
      // The only permitted mentions are the comments explaining why we keep it
      // and the branch that returns alive. A comparison used to drop would look
      // like `=== 'unreachable'` followed by a false/drop.
      const dropShape = /'unreachable'[^\n]*\)\s*\{?\s*(return (false|\{ line_alive: false)|dead\.add|continue)/
      expect(src, rel).not.toMatch(dropShape)
    }
  })
})
