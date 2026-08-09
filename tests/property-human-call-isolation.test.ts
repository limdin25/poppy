// A human agent's property calls must be invisible to the AI qualifier.
//
// Both channels write to the same two tables on purpose, so /admin/properties
// shows ONE timeline per property instead of two half-histories. That only
// stays safe because of four properties of the data the human path writes, each
// of which makes an existing AI query skip the row without that query being
// changed. None of those four is obvious from reading either file alone, which
// is what this test is for.
//
// The danger is concrete and expensive. If the AI ever picks up a row Pedro
// created, it dials an estate agency Pedro is mid-negotiation with, from a
// different number, having already been told "I've just had a phone call from
// the same number" once — the complaint that put the 30-minute spacing rule in
// the cron in the first place.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const CRON = read('api/cron/process-property-calls.ts')
const LIB = read('api/lib/brrr.ts')
const OUTCOME = read('api/crm/property-outcome.ts')
const INGEST = read('api/properties/ingest.ts')
const MIGRATION = read('supabase/migrations/20260809000001_property_human_calls.sql')

describe('the human row is shaped so the AI never picks it up', () => {
  it('writes status completed, so the cron (which selects pending) skips it', () => {
    expect(OUTCOME).toMatch(/status:\s*'completed'/)
    expect(CRON).toMatch(/\.eq\('status',\s*'pending'\)/)
  })

  it('writes channel human and a null retell_call_id', () => {
    expect(OUTCOME).toMatch(/channel:\s*'human'/)
    expect(OUTCOME).toMatch(/retell_call_id:\s*null/)
  })

  it('the Retell webhook matches on retell_call_id, which a human row lacks', () => {
    // A null can never equal an incoming Retell call_id, so handleBrrrCallEvent
    // cannot bind a Retell event to a human call record.
    expect(LIB).toMatch(/\.eq\('retell_call_id',\s*call\.call_id\)/)
  })

  it('the stuck-extraction sweeper explicitly requires a retell_call_id', () => {
    expect(LIB).toMatch(/\.not\('retell_call_id',\s*'is',\s*null\)/)
  })

  it('queuePropertyCall only treats pending/dialing as "already queued"', () => {
    // If this ever included 'completed', a human outcome would permanently
    // block the property from ever being queued again.
    expect(LIB).toMatch(/\.in\('status',\s*\['pending',\s*'dialing'\]\)/)
  })
})

describe('the one deliberate crossover', () => {
  it('the same-agency spacing DOES see human calls, and that is intentional', () => {
    // This is the exception to everything above. The cron looks back 30 minutes
    // over ('dialing','completed') to find offices already rung. Human rows are
    // 'completed', so they land in that window — which is what we want: after
    // Pedro rings a branch, the AI must not ring it for half an hour.
    //
    // If someone "tidies" this to exclude human rows, the two channels start
    // ringing the same switchboard minutes apart with nothing to stop them.
    expect(CRON).toMatch(/\.in\('status',\s*\['dialing',\s*'completed'\]\)/)
    expect(CRON).toMatch(/SPACING_MS = 30 \* 60 \* 1000/)
  })
})

describe('the AI cannot take a branch a human owns', () => {
  it('the cron retires a claimed row whose property went human', () => {
    expect(CRON).toMatch(/call_channel === 'human'/)
    expect(CRON).toMatch(/branch assigned to a human agent/)
  })

  it('ingest will not auto-queue an AI call on a human branch', () => {
    expect(INGEST).toMatch(/data\.call_channel !== 'human'/)
  })

  it('a re-send cannot reset a human branch back to ai', () => {
    // The upserted row must not carry call_channel at all — if it did, every
    // "Send to Elsie" on an already-assigned property would hand the branch
    // back to the robot silently.
    const rowBlock = INGEST.slice(INGEST.indexOf('const row = {'), INGEST.indexOf('};', INGEST.indexOf('const row = {')))
    expect(rowBlock).not.toMatch(/call_channel/)
    // ...but it must be READ back, or the guard above has nothing to test.
    expect(INGEST).toMatch(/\.select\('id, status, call_channel'\)/)
  })

  it('call_channel defaults to ai, so nothing changes until a script says so', () => {
    expect(MIGRATION).toMatch(/call_channel text not null default 'ai'/)
    expect(MIGRATION).toMatch(/check \(call_channel in \('ai', 'human'\)\)/)
  })
})

describe('the outcome route is gated and cannot be called by a stranger', () => {
  it('requires a bearer token and staff membership', () => {
    expect(OUTCOME).toMatch(/Authorization/)
    expect(OUTCOME).toMatch(/supabase\.auth\.getUser\(jwt\)/)
    expect(OUTCOME).toMatch(/rpc\('wk_is_agent_or_admin'\)/)
    expect(OUTCOME).toMatch(/status:\s*403/)
  })

  it('only accepts the four outcomes the AI path also uses', () => {
    expect(OUTCOME).toMatch(/const OUTCOMES = \['qualified', 'not_qualified', 'callback', 'no_answer'\]/)
    // An allowlist, never the raw body value straight into the update.
    expect(OUTCOME).toMatch(/OUTCOMES\.includes\(outcome\)/)
  })

  it('holds back the property update while an AI call is in flight', () => {
    // Otherwise whichever writer finishes last wins, arbitrarily.
    expect(OUTCOME).toMatch(/\.in\('status',\s*\['pending',\s*'dialing'\]\)/)
    expect(OUTCOME).toMatch(/property_updated: false/)
  })

  it('still records the call even when it holds the property back', () => {
    // Losing what an agent typed is never acceptable. The insert must come
    // BEFORE the in-flight check in the file.
    expect(OUTCOME.indexOf("from('brrr_property_calls').insert"))
      .toBeLessThan(OUTCOME.indexOf("in('status', ['pending', 'dialing'])"))
  })

  it('files a qualified deal through the same function the AI path uses', () => {
    // Not a second copy of the create-or-move-a-deal rule.
    expect(OUTCOME).toMatch(/pushPropertyToPipeline\(/)
    expect(OUTCOME).not.toMatch(/from\('deals'\)/)
    expect(OUTCOME).not.toMatch(/from\('pipeline_stages'\)/)
  })
})
