// The auction call script (Hugo, 2026-09-18): short, one pass per lot, and no
// price ever agreed on the phone. The screen, the coach and the report must
// agree on the five stages.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCRIPT_TEXT_TOKENS } from '../src/features/crm/lib/interpolateScript'
import { scriptForContactFields, scriptForDesk, scriptForCall } from '../src/features/crm/lib/scriptForCall'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const HTML = read('src/core/content/auction-call-script.html')
const PAGE = HTML.slice(HTML.indexOf('id="page"'))
const COACH = read('supabase/functions/wk-voice-transcription/index.ts')

describe('the script file', () => {
  it('has no long dashes, curly quotes or ellipsis characters', () => {
    expect(HTML).not.toMatch(/[–—‘’“”…]/)
  })
  it('every [token] in the page is one interpolateScript knows, so none prints raw', () => {
    const tokens = [...PAGE.matchAll(/\[([a-z_]+)\]/g)].map((m) => m[1])
    expect(tokens.length).toBeGreaterThan(5)
    for (const t of tokens) expect(SCRIPT_TEXT_TOKENS as readonly string[]).toContain(t)
  })
  it('never has Pedro agree a price or say a number of ours', () => {
    const said = [...PAGE.matchAll(/<div class="(?:line|obj-say)">[\s\S]*?<\/div>/g)].map((m) => m[0]).join('\n')
    expect(said).not.toMatch(/we'll take it|we will take it|we can do £|our offer is|we'd pay|we can offer/i)
    expect(PAGE).toMatch(/NEVER agree a price/)
  })
  it('asks about every lot on the same call', () => {
    expect(PAGE).toMatch(/Ask about all of them on\s+this one call/)
  })
})

describe('screen and coach agree on the five stages', () => {
  it('same stage names, same order', () => {
    const screen = [...PAGE.matchAll(/<div class="stage-div">\d\. ([^<]+)<\/div>/g)].map((m) => m[1].trim())
    const block = COACH.slice(COACH.indexOf('const AUCTION_STAGE_ORDER = ['))
    const coach = [...block.slice(0, block.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(screen).toEqual(coach)
  })
  it('the coach replaces the Elsie knowledge base on an auction call', () => {
    expect(COACH).toMatch(/const isAuctionCall = \(call\.script_key as string \| null\) === 'auction_call';/)
    expect(COACH).toMatch(/: isAuctionCall \? AUCTION_OBJECTIONS/)
    expect(COACH).toMatch(/: isAuctionCall \? 'auction_call'/)
  })
})

describe('which script is on screen', () => {
  it('an auction office gets the auction script from any button', () => {
    expect(scriptForContactFields({ lead_type: 'auctioneer' })).toBe('auction_call')
    expect(scriptForContactFields({ lead_type: 'estate_agent' })).toBe('property_call')
  })
  it('the Auction desk defaults to the auction script, Houses keeps its own', () => {
    expect(scriptForDesk('auction')).toBe('auction_call')
    expect(scriptForDesk('houses')).toBeNull()
  })
  it('an auction room keeps the auction script for every office in the queue', () => {
    expect(scriptForCall({ openedWith: 'auction_call', openedForContactId: null, currentLeadContactId: 'x' })).toBe('auction_call')
  })
})
