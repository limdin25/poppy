// Nothing in this codebase may place an automated call to an estate agent.
//
// The AI property qualifier ("Elsie Property Qualifier", Retell agent
// agent_539daa8b3bedf3d3de876276a2) was a June experiment. It made 26 real
// calls and was retired on 2026-08-09. Hugo: "the robot, it doesn't exist, we
// don't want to use that any more, no more robot calls for the properties,
// that was just a test."
//
// Estate agents are rung by a human agent through the CRM dialer. That is the
// only path, and this file exists so it stays the only path.
//
// This replaces tests/property-human-call-isolation.test.ts, which pinned the
// rules that kept the two channels from ringing the same switchboard. With one
// channel left there is nothing to isolate, so the job of the test changed from
// "keep them apart" to "there is only one of them".

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const exists = (p: string) => existsSync(resolve(root, p))

const LIB = read('api/lib/brrr.ts')
const OUTCOME = read('api/crm/property-outcome.ts')
const INGEST = read('api/properties/ingest.ts')
const ADMIN = read('api/admin/properties/index.ts')
const PAGE = read('src/features/admin/pages/PropertiesPage.tsx')
const VERCEL = read('vercel.json')

describe('the dialer that placed the calls is gone', () => {
  it('the cron route no longer exists', () => {
    expect(exists('api/cron/process-property-calls.ts')).toBe(false)
  })

  it('the script that created the Retell qualifier agent no longer exists', () => {
    // Keeping it around is an invitation to run it and rebuild the agent.
    expect(exists('scripts/create-property-qualifier-agent.mjs')).toBe(false)
  })

  it('Vercel has no property-call cron left to fire', () => {
    expect(VERCEL).not.toMatch(/process-property-calls/)
    // And the file it would point at is not registered under any other name.
    const crons: Array<{ path: string }> = JSON.parse(VERCEL).crons || []
    expect(crons.filter((c) => /propert/i.test(c.path))).toEqual([])
  })
})

describe('nothing left can start a call', () => {
  it('ingest does not queue anything, and does not even import the queuer', () => {
    // "Send to Elsie" files the property and stops. Before 2026-08-09 it also
    // queued a robot dial whenever auto_queue_on_ingest was on.
    expect(INGEST).not.toMatch(/queuePropertyCall/)
    expect(INGEST).not.toMatch(/auto_queue_on_ingest/)
    expect(INGEST).toMatch(/call_queued: false/)
  })

  it('the admin Call agent action refuses instead of queueing', () => {
    expect(ADMIN).not.toMatch(/queuePropertyCall/)
    expect(ADMIN).toMatch(/status:\s*410/)
  })

  it('the admin Properties page has no Call agent button', () => {
    // A dead button that returns 410 is worse than no button.
    expect(PAGE).not.toMatch(/Call agent/)
    expect(PAGE).not.toMatch(/run\('call'/)
  })

  it('no file anywhere calls queuePropertyCall', async () => {
    // The function still exists in api/lib/brrr.ts and is exercised by its own
    // unit coverage, but it must have zero callers in the product. If this ever
    // finds one, somebody has re-armed the robot.
    const { execSync } = await import('node:child_process')
    const hits = execSync(
      "grep -rn 'queuePropertyCall(' api src supabase scripts || true",
      { cwd: root, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      // The definition itself is not a caller.
      .filter((l) => !/api\/lib\/brrr\.ts:\d+:export async function queuePropertyCall/.test(l))
    expect(hits).toEqual([])
  })
})

describe('the human path is untouched by the removal', () => {
  it('a human outcome still writes channel human with a null retell_call_id', () => {
    // Shape kept deliberately. brrr_property_calls still carries the retired
    // AI rows' columns, and a human row must stay distinguishable from the 26
    // historical robot calls if they are ever restored from the backup.
    expect(OUTCOME).toMatch(/channel:\s*'human'/)
    expect(OUTCOME).toMatch(/retell_call_id:\s*null/)
    expect(OUTCOME).toMatch(/status:\s*'completed'/)
  })

  it('the outcome route requires a bearer token and staff membership', () => {
    expect(OUTCOME).toMatch(/Authorization/)
    expect(OUTCOME).toMatch(/supabase\.auth\.getUser\(jwt\)/)
    expect(OUTCOME).toMatch(/rpc\('wk_is_agent_or_admin'\)/)
    expect(OUTCOME).toMatch(/status:\s*403/)
  })

  it('only accepts the four outcomes', () => {
    expect(OUTCOME).toMatch(/const OUTCOMES = \['qualified', 'not_qualified', 'callback', 'no_answer'\]/)
    // An allowlist, never the raw body value straight into the update.
    expect(OUTCOME).toMatch(/OUTCOMES\.includes\(outcome\)/)
  })

  it('records the call before anything else can go wrong', () => {
    // Losing what an agent typed is never acceptable.
    expect(OUTCOME.indexOf("from('brrr_property_calls').insert"))
      .toBeLessThan(OUTCOME.indexOf("in('status', ['pending', 'dialing'])"))
  })

  it('files a qualified deal through the shared function, not a second copy', () => {
    expect(OUTCOME).toMatch(/pushPropertyToPipeline\(/)
    expect(OUTCOME).not.toMatch(/from\('deals'\)/)
    expect(OUTCOME).not.toMatch(/from\('pipeline_stages'\)/)
  })

  it('the Retell webhook still cannot bind an event to a human row', () => {
    // Belt and braces: the qualifier is retired, but if any stray Retell event
    // for an old property call ever arrives, it matches on retell_call_id and a
    // human row's is null, so it can never attach to Pedro's work.
    expect(LIB).toMatch(/\.eq\('retell_call_id',\s*call\.call_id\)/)
    expect(LIB).toMatch(/\.not\('retell_call_id',\s*'is',\s*null\)/)
  })
})
