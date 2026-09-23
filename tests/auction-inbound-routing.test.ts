// Which desk an inbound call belongs to, and whether it rings (Hugo,
// 2026-09-18): on the Auction desk an old Houses contact's call does NOT ring,
// it goes to voicemail and waits in Houses. The rule lives in
// api/lib/desk-route.ts and is mirrored verbatim in the Deno TwiML function.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inboundDeskRoute } from '../api/lib/desk-route'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const TWIML = read('supabase/functions/wk-voice-twiml-incoming/index.ts')
const CANON = read('api/lib/desk-route.ts')

describe('inboundDeskRoute', () => {
  it('a Houses contact ringing while he is on Auction goes to voicemail, filed in Houses', () => {
    expect(inboundDeskRoute('houses', 'auction')).toEqual({ desk: 'houses', ring: false })
  })
  it('an auction office ringing while he is on Houses waits on Auction', () => {
    expect(inboundDeskRoute('auction', 'houses')).toEqual({ desk: 'auction', ring: false })
  })
  it('a contact on the desk he is on rings', () => {
    expect(inboundDeskRoute('auction', 'auction')).toEqual({ desk: 'auction', ring: true })
    expect(inboundDeskRoute('houses', 'houses')).toEqual({ desk: 'houses', ring: true })
  })
  it('the Serviced Accommodation desk follows the same rule (2026-09-23)', () => {
    expect(inboundDeskRoute('sa', 'sa')).toEqual({ desk: 'sa', ring: true })
    expect(inboundDeskRoute('sa', 'houses')).toEqual({ desk: 'sa', ring: false })
    expect(inboundDeskRoute('houses', 'sa')).toEqual({ desk: 'houses', ring: false })
    expect(inboundDeskRoute('auction', 'sa')).toEqual({ desk: 'auction', ring: false })
    expect(inboundDeskRoute(null, 'sa')).toEqual({ desk: 'sa', ring: true })
  })
  it('a caller nobody knows rings, filed under the desk he is on', () => {
    expect(inboundDeskRoute(null, 'auction')).toEqual({ desk: 'auction', ring: true })
    expect(inboundDeskRoute(null, 'houses')).toEqual({ desk: 'houses', ring: true })
    expect(inboundDeskRoute(undefined, null)).toEqual({ desk: 'houses', ring: true })
  })
})

describe('the TwiML function uses the same rule', () => {
  it('mirrors the function body verbatim', () => {
    const body = (src: string) => {
      const start = src.indexOf('function inboundDeskRoute(')
      const end = src.indexOf('\n}', start)
      return src.slice(start, end).replace(/^export /m, '')
    }
    expect(body(TWIML)).toBe(body(CANON))
  })
  it('silences the ring by taking the voicemail route, and stamps the desk', () => {
    expect(TWIML).toMatch(/const route = inboundDeskRoute\(contactDesk, agentDesk\);/)
    expect(TWIML).toMatch(/if \(!route\.ring\) \{[\s\S]*?agentClientIdentity = null;/)
    expect(TWIML).toMatch(/desk: route\.desk,/)
    expect(TWIML).toMatch(/\.select\('id, active_desk'\)/)
  })
})

describe('new senders by text and email land on the desk the agent is on', () => {
  it('SMS', () => {
    const sms = read('supabase/functions/wk-sms-incoming/index.ts')
    expect(sms).toMatch(/if \(agent\?\.active_desk === 'auction' \|\| agent\?\.active_desk === 'sa'\) newDesk = agent\.active_desk;/)
    expect(sms).toMatch(/desk: newDesk,/)
  })
  it('email', () => {
    const mail = read('supabase/functions/wk-email-webhook/index.ts')
    expect(mail).toMatch(/if \(ownerDesk === 'auction' \|\| ownerDesk === 'sa'\) newDesk = ownerDesk;/)
    expect(mail).toMatch(/desk: newDesk,/)
  })
})
