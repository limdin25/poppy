// The proof of funds: who may have it, and when it gets attached.
//
// This is Hugo's certified Revolut balance sheet. It names the company, and it
// lists the account number, sort code and IBAN of every account it holds. That
// is precisely the material bank-mandate fraud is built from, so the rules
// around it are not style, and each of these tests exists because breaking it
// would be silent: an over-shared bank statement looks exactly like a working
// feature until somebody uses it.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { needsProofOfFunds } from '../src/features/crm/components/contacts/ContactSmsModal'
import type { NextStepBrief } from '../api/lib/next-step-brief'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

// THE RULE AND THE SIGNING MOVED TO api/lib/proof-of-funds.ts on 17 Aug so the
// cockpit's email gate could attach the same document the pipeline modal does.
// Every rule below is unchanged, pinned where it now lives.
const ROUTE = read('api/lib/proof-of-funds.ts') + read('api/crm/proof-of-funds.ts')
const SEND = read('supabase/functions/wk-email-send/index.ts')

const brief = (over: Partial<NextStepBrief>): NextStepBrief => ({
  version: 1,
  written_at: '2026-08-14T12:00:00.000Z',
  verdict: 'KEEP',
  headline: 'KEEP: Zest Hull, Welwyn Park Road',
  step: 'Chase the agent',
  who: 'PEDRO',
  asking: 125000,
  offer: 103600,
  ceiling: 103600,
  ladder: '',
  why: [],
  do_now: [],
  blockers: [],
  board: null,
  confidence: { level: 'high', why: '', raise: null },
  ...over,
})

describe('it is attached only when the branch actually asked for it', () => {
  it('attaches on the deal that is waiting on it', () => {
    expect(needsProofOfFunds({
      brief: brief({
        blockers: ['The branch wants proof of funds before the offer goes to the vendor. A dated bank statement is enough.'],
      }),
    })).toBe(true)
  })

  it('reads it out of Hugo\'s own pinned note too', () => {
    expect(needsProofOfFunds({
      pinnedNote: 'Blocker (Hugo, today): Agent will not put the offer forward without proof of funds.',
    })).toBe(true)
  })

  it('never attaches speculatively', () => {
    expect(needsProofOfFunds(null)).toBe(false)
    expect(needsProofOfFunds({})).toBe(false)
    expect(needsProofOfFunds({
      brief: brief({ blockers: ['No video walkthrough yet.'], do_now: ['Ring Doug back.'] }),
    })).toBe(false)
    // A branch chasing OUR funding of the refurb is not asking us to prove it.
    expect(needsProofOfFunds({ pinnedNote: 'They asked how the refurb is funded.' })).toBe(false)
  })
})

describe('the document itself never leaks', () => {
  it('lives in the PRIVATE bucket, never in the public attachments one', () => {
    expect(ROUTE).toMatch(/const BUCKET = 'proof-of-funds'/)
    // The name appears in a comment saying why NOT that bucket. What must
    // never appear is a read from it.
    expect(ROUTE).not.toMatch(/from\(['"]crm-attachments/)
    // getPublicUrl on this bucket would hand out a permanent, guessable link.
    expect(ROUTE).not.toMatch(/getPublicUrl/)
    expect(ROUTE).toMatch(/createSignedUrl/)
  })

  it('the link dies, and within the hour', () => {
    expect(ROUTE).toMatch(/TTL_SECONDS = 60 \* 60/)
    expect(ROUTE).toMatch(/createSignedUrl\(path, PROOF_TTL_SECONDS\)/)
  })

  it('staff only, decided by the database and not by this file', () => {
    expect(ROUTE).toMatch(/supabase\.auth\.getUser\(jwt\)/)
    expect(ROUTE).toMatch(/rpc\('wk_is_agent_or_admin'\)/)
    expect(ROUTE).toMatch(/status: 403/)
  })

  it('which file is current is a pointer, not a hardcoded path', () => {
    // A proof of funds goes stale. Replacing it must never need a deploy.
    expect(ROUTE).toMatch(/\.eq\('key', 'proof_of_funds'\)/)
    expect(ROUTE).not.toMatch(/statement-of-balances/)
  })

  it('having no document on file is an answer, not a 500', () => {
    expect(ROUTE).toMatch(/available: false/)
  })
})

describe('the attachment arrives with a name a human would write', () => {
  it('the filename is never read off the end of a signed url', () => {
    // A signed url ends in ?token=eyJhbGciOi..., and that would have become the
    // filename on Hugo's bank statement.
    expect(SEND).toMatch(/attachment_name/)
    expect(SEND).toMatch(/attachment_url\.split\('\?'\)\[0\]\.split\('\/'\)\.pop\(\)/)
  })
})
