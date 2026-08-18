// SOMETHING LISTENS TO THE CALLS NOW.
//
// Hugo, 2026-08-18, on a card reading "STILL MISSING (0 of 12 ANSWERED)" beside
// an eight minute recorded call with a ninety two line transcript: "are you
// sure, its 0 of 12 answered. I think you are not listening to the calls. This
// is so crucial that after every call you give confidence answer on our next
// steps."
//
// Measured before the fix:
//
//     calls with a stored transcript ............ 553
//     properties on file ........................ 215
//     properties with ANY checklist answer ...... 3
//
// The twelve answers could only ever be typed by hand into the Houses pane, and
// nobody typed them. One of the twelve, `condition_band`, had no input at all,
// so the checklist was not even completable by a human who wanted to.
//
// The rules this file exists to hold:
//
//   1. A machine answer NEVER overwrites one a human typed.
//   2. No answer without the agent's own words behind it.
//   3. A misheard number never reaches the engine.
//   4. There is ONE transcript reader, because the same wrong column list
//      (`speaker, text, created_at` against a table whose columns are `body`
//      and `ts`) has now silently blanked three different features.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parseChecklist, mergeChecklist, answeredCount, CHECKLIST_SYSTEM, HEARD_KEY,
} from '../api/lib/call-extract'
import { CHECKLIST_KEYS } from '../api/lib/deal-state'
import { BANDS, WORKS } from '../api/lib/condition-vocab'
import { engineIdFromUrl, houseFromContact, askingFromText } from '../api/lib/file-the-house'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const ok = (answers: Record<string, string>, quotes: Record<string, string>) =>
  JSON.stringify({ answers, quotes })

describe('rule 2: no answer without the agent\'s own words', () => {
  it('keeps an answer that carries its quote', () => {
    const out = parseChecklist(ok(
      { why_selling: 'Probate, the owner died last year' },
      { why_selling: 'it is a probate sale, the old chap passed last year' },
    ))
    expect(out?.answers.why_selling).toBe('Probate, the owner died last year')
    expect(out?.quotes.why_selling).toMatch(/probate/)
  })

  it('DROPS an answer with no quote, rather than trusting the prompt', () => {
    // The prompt forbids an unevidenced answer. This is the fence, because a
    // rule a model is told is a hope and a rule the parser enforces is a fence.
    const out = parseChecklist(ok({ why_selling: 'Divorce' }, {}))
    expect(out?.answers.why_selling).toBeUndefined()
  })

  it('drops the ways a model says "it never came up"', () => {
    for (const dodge of ['unknown', 'not stated', 'Not established', 'n/a', 'none', '']) {
      const out = parseChecklist(ok({ motivation: dodge }, { motivation: 'some quote' }))
      expect(out?.answers.motivation, dodge).toBeUndefined()
    }
  })

  it('ignores keys that are not on the twelve', () => {
    const out = parseChecklist(ok(
      { offer_price: '95000', why_selling: 'probate' },
      { offer_price: 'q', why_selling: 'q' },
    ))
    expect(out?.answers.offer_price).toBeUndefined()
    expect(out?.answers.why_selling).toBe('probate')
  })

  it('survives rubbish instead of throwing', () => {
    expect(parseChecklist('I could not read that call, sorry')).toBeNull()
  })
})

describe('rule 3: a misheard number never reaches the engine', () => {
  it('refuses a price that is not a price', () => {
    // The reader hearing "one one eight" and returning 118 is the exact failure
    // the ballpark reader already bands against.
    const out = parseChecklist(ok({ rejected_offer: '118' }, { rejected_offer: 'they turned down one one eight' }))
    expect(out?.answers.rejected_offer).toBeUndefined()
  })

  it('takes a real one, digits only, commas stripped', () => {
    const out = parseChecklist(ok({ rejected_offer: '£118,000' }, { rejected_offer: 'turned down 118 grand' }))
    expect(out?.answers.rejected_offer).toBe('118000')
  })

  it('bands rent separately, because rent is not a sale price', () => {
    expect(parseChecklist(ok({ rent_estimate: '650' }, { rent_estimate: 'about 650 a month' }))?.answers.rent_estimate).toBe('650')
    expect(parseChecklist(ok({ rent_estimate: '95000' }, { rent_estimate: 'q' }))?.answers.rent_estimate).toBeUndefined()
  })

  it('keeps the WORDS on the agent comparable, not just the figure', () => {
    // A done-up sale on the same street is the cross-check on the end value.
    // The figure alone is uncheckable, so which house it was travels with it.
    const out = parseChecklist(ok(
      { agent_comparable: '175000, number 12 same street, done up, spring' },
      { agent_comparable: 'number 12 went for about 175 done up in the spring' },
    ))
    expect(out?.answers.agent_comparable).toMatch(/^175000, number 12/)
  })

  it('refuses a floor area that is a room, or a country', () => {
    expect(parseChecklist(ok({ floor_area: '8' }, { floor_area: 'q' }))?.answers.floor_area).toBeUndefined()
    expect(parseChecklist(ok({ floor_area: '82' }, { floor_area: 'about 82 square metres' }))?.answers.floor_area).toBe('82')
  })

  it('only takes a condition band the engine can actually price', () => {
    expect(parseChecklist(ok({ condition_band: 'Full Refurb' }, { condition_band: 'q' }))?.answers.condition_band).toBe('full_refurb')
    expect(parseChecklist(ok({ condition_band: 'a bit tired' }, { condition_band: 'q' }))?.answers.condition_band).toBeUndefined()
    // 'unknown' is a legal band but it is not an ANSWER: recording it would
    // count as one of the twelve while saying nothing.
    expect(parseChecklist(ok({ condition_band: 'unknown' }, { condition_band: 'q' }))?.answers.condition_band).toBeUndefined()
  })
})

describe('rule 1: the human always wins', () => {
  const machine = {
    answers: { why_selling: 'Probate', water: 'No damp mentioned', tenure: 'Freehold' },
    evidence: {
      why_selling: { quote: 'probate sale', call_id: 'k1', at: '2026-08-18T09:00:00Z' },
      water: { quote: 'no damp at all', call_id: 'k1', at: '2026-08-18T09:00:00Z' },
      tenure: { quote: 'it is freehold', call_id: 'k1', at: '2026-08-18T09:00:00Z' },
    },
  }

  it('fills only the empty keys', () => {
    const { merged, filled } = mergeChecklist({ why_selling: 'Landlord selling up' }, machine)
    expect(merged.why_selling).toBe('Landlord selling up')
    expect(merged.water).toBe('No damp mentioned')
    expect(filled.sort()).toEqual(['tenure', 'water'])
  })

  it('never stores evidence for an answer it did not write', () => {
    const { merged } = mergeChecklist({ why_selling: 'Landlord selling up' }, machine)
    const heard = merged[HEARD_KEY] as Record<string, unknown>
    expect(heard.why_selling).toBeUndefined()
    expect(heard.water).toBeTruthy()
  })

  it('carries the quote and the call, so anybody can check it', () => {
    const { merged } = mergeChecklist(null, machine)
    const heard = merged[HEARD_KEY] as Record<string, { quote: string; call_id: string }>
    expect(heard.water.quote).toBe('no damp at all')
    expect(heard.water.call_id).toBe('k1')
  })

  it('drops evidence for an answer a human has since cleared', () => {
    const first = mergeChecklist(null, machine).merged
    const corrected = { ...first, water: '' }
    const { merged } = mergeChecklist(corrected, { answers: {}, evidence: {} })
    expect((merged[HEARD_KEY] as Record<string, unknown>).water).toBeUndefined()
    expect((merged[HEARD_KEY] as Record<string, unknown>).tenure).toBeTruthy()
  })

  it('leaves no evidence key behind when nothing was heard', () => {
    const { merged, filled } = mergeChecklist(null, { answers: {}, evidence: {} })
    expect(filled).toEqual([])
    expect(merged[HEARD_KEY]).toBeUndefined()
  })

  it('the evidence key can never be counted as one of the twelve', () => {
    const { merged } = mergeChecklist(null, machine)
    expect(HEARD_KEY.startsWith('_')).toBe(true)
    expect(CHECKLIST_KEYS as readonly string[]).not.toContain(HEARD_KEY)
    expect(answeredCount(merged)).toBe(3)
  })
})

describe('the count on the screen is the count the brain uses', () => {
  it('counts the same twelve, the same way', () => {
    expect(answeredCount({})).toBe(0)
    expect(answeredCount(null)).toBe(0)
    const all: Record<string, string> = {}
    for (const k of CHECKLIST_KEYS) all[k] = 'x'
    expect(answeredCount(all)).toBe(CHECKLIST_KEYS.length)
    expect(CHECKLIST_KEYS.length).toBe(12)
  })

  it('a blank string is not an answer', () => {
    expect(answeredCount({ why_selling: '   ', water: 'no' })).toBe(1)
  })
})

describe('the prompt asks for all twelve, and forbids the guess', () => {
  it('names every checklist key', () => {
    for (const k of CHECKLIST_KEYS) expect(CHECKLIST_SYSTEM, k).toContain(k)
  })

  it('tells it a NO is an answer, since silence and denial are different facts', () => {
    expect(CHECKLIST_SYSTEM).toMatch(/A NO IS AN ANSWER/)
  })

  it('forbids guessing and demands the quote', () => {
    expect(CHECKLIST_SYSTEM).toMatch(/NEVER GUESS/)
    expect(CHECKLIST_SYSTEM).toMatch(/No quote, no answer/)
    expect(CHECKLIST_SYSTEM).toMatch(/never decide anything, you never price anything/)
  })

  it('carries no long dash or curly punctuation', () => {
    expect(CHECKLIST_SYSTEM).not.toMatch(/[–—‘’“”…]/)
  })
})

describe('rule 4: one transcript reader', () => {
  const BALLPARK = read('api/lib/ballpark.ts')
  const EXTRACT = read('api/lib/call-extract.ts')
  const REVIEW = read('api/crm/call-review.ts')

  it('ballpark exports it and call-extract imports it, rather than copying', () => {
    expect(BALLPARK).toMatch(/export async function readNewestTranscript/)
    // Lazily, so the parser and the merge stay testable without credentials.
    expect(EXTRACT).toMatch(/await import\('\.\/ballpark\.js'\)/)
    expect(EXTRACT).toMatch(/readNewestTranscript\(sb, args\.contactId\)/)
    expect(EXTRACT).not.toMatch(/from\('wk_live_transcripts'\)/)
  })

  it('every reader asks for the columns that exist', () => {
    for (const [name, src] of [['ballpark', BALLPARK], ['call-review', REVIEW]] as const) {
      expect(src, name).toMatch(/\.select\('speaker, body, ts'\)/)
      // The wrong list may appear in a WARNING comment, which is the point of
      // writing it down. It may never appear in a select.
      expect(src, name).not.toMatch(/\.select\('speaker, text, created_at'\)/)
    }
  })

  it('and says so when the read fails instead of reading it as silence', () => {
    expect(REVIEW).toMatch(/transcript read failed/)
    expect(BALLPARK).toMatch(/read failed/)
  })
})

describe('it runs on its own, on every call', () => {
  const CRON = read('api/cron/call-listener.ts')
  const VERCEL = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }

  it('is registered as its own cron', () => {
    const entry = VERCEL.crons.find((c) => c.path === '/api/cron/call-listener')
    expect(entry).toBeTruthy()
    expect(entry!.schedule).toMatch(/^\*\/5 /)
  })

  it('is NOT gated on the deal manager, because note taking is not judgement', () => {
    // ballpark-runner stops when the brain is switched off. Writing down what an
    // estate agent said must not: turning the AI off should cost us its opinion,
    // never our record of the conversation.
    expect(CRON).not.toMatch(/deal_manager/)
    expect(CRON).not.toMatch(/manager_off/)
  })

  it('reads a call once: a stored result never makes it eligible again', () => {
    expect(CRON).toMatch(/lastRead\.call_id === callId/)
    // And the marker is written even when nothing was heard, or the same silent
    // call is paid for again every five minutes for ever.
    expect(CRON).toMatch(/merged\[READ_KEY\] = \{/)
  })

  it('never asks the reader for a truncated transcript to find the call id', () => {
    // Caught on the first live run: `{ cap: 1 }` truncates the text, and the
    // reader decides a call is worth returning by that same text being longer
    // than 200 characters, so it found nothing on all 60 candidates and read
    // zero calls. The rows fetched are identical without the cap.
    expect(CRON).not.toMatch(/readNewestTranscript\([^)]*cap:/)
  })

  it('is capped per pass and loud on a broken query', () => {
    expect(CRON).toMatch(/const PER_RUN = \d/)
    expect(CRON).toMatch(/throw new Error\(`brrr_properties read failed/)
  })
})

describe('a human can finally complete the checklist by hand', () => {
  const PANE = read('src/features/crm/components/live-call/PropertiesPane.tsx')

  it('condition_band has an input at last, and it is a fixed list', () => {
    expect(PANE).toMatch(/key: 'condition_band'/)
    expect(PANE).toMatch(/options: BANDS/)
    expect(PANE).toMatch(/data-testid=\{`property-q-\$\{q\.key\}`\}/)
  })

  it('the vocabulary comes from the shared pure module, never a second copy', () => {
    expect(PANE).toMatch(/from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/api\/lib\/condition-vocab'/)
    expect(PANE).not.toMatch(/'modernisation'/)
    // Pure means pure: nothing server-side can ride into the browser bundle.
    expect(read('api/lib/condition-vocab.ts')).not.toMatch(/^import /m)
  })

  it('the engine and the card spell the bands identically', () => {
    expect(BANDS).toContain('full_refurb')
    expect(BANDS).toContain('unknown')
    expect(WORKS).toContain('structural')
    expect(read('api/lib/ballpark.ts')).toMatch(/export \{ BANDS, WORKS \} from '\.\/condition-vocab\.js'/)
  })
})

// ---------------------------------------------------------------------------
// A DISCOVERY CALL LEAVES A HOUSE BEHIND
// ---------------------------------------------------------------------------
//
// Hugo, 2026-08-18: "I also see many discovery calls done but it didnt go to
// cockpit for the decision."
//
// Measured: of 26 branches in "Discovery done, evaluating", 23 had NO house
// row, and the cockpit and the ballpark are both keyed on one. Pedro could have
// a perfect conversation and the system had nowhere to put it. The house was
// never missing, it was on the CONTACT: address, asking price, and a listing URL
// carrying the scraper's own property id, which is exactly the id the engine
// prices against.

describe('the house the call leaves behind', () => {
  const branch = {
    id: 'c1',
    name: 'Your Move, Swinton',
    phone: '+441615245067',
    custom_fields: {
      lead_type: 'estate_agent',
      property_address: 'Mere Drive, Clifton, Swinton, Manchester, M27, M27 8SD',
      property_url: 'https://www.rightmove.co.uk/properties/163880201',
      asking_price: '£75,000',
      bedrooms: '1',
      property_type: 'flat',
      days_on_market: '76',
      agency: 'Your Move',
    },
  }

  it('takes the engine id straight out of the listing URL', () => {
    // Proven against the live table: source_property_id IS that number.
    expect(engineIdFromUrl(branch.custom_fields.property_url)).toBe('163880201')
    expect(engineIdFromUrl('https://www.zoopla.co.uk/for-sale/details/123')).toBeNull()
    expect(engineIdFromUrl(null)).toBeNull()
  })

  it('copies the house off the card, inventing nothing', () => {
    const h = houseFromContact(branch)!
    expect(h.source_property_id).toBe('163880201')
    expect(h.address).toBe(branch.custom_fields.property_address)
    expect(h.asking_price).toBe(75000)
    expect(h.bedrooms).toBe(1)
    expect(h.property_type).toBe('flat')
    expect(h.agent_name).toBe('Your Move')
    expect(h.wk_contact_id).toBe('c1')
    // No robot ever calls an estate agent, so every house we file is a human's.
    expect(h.call_channel).toBe('human')
  })

  it('REFUSES to file a house the engine could never price', () => {
    // A card with no engine id would sit in the cockpit for ever as a deal the
    // engine refuses with no_engine_id, which is worse than no card at all.
    const noUrl = { ...branch, custom_fields: { ...branch.custom_fields, property_url: '' } }
    expect(houseFromContact(noUrl)).toBeNull()
    const noAddress = { ...branch, custom_fields: { ...branch.custom_fields, property_address: '  ' } }
    expect(houseFromContact(noAddress)).toBeNull()
  })

  it('reads a price a human wrote, and refuses one that is not a price', () => {
    expect(askingFromText('£75,000')).toBe(75000)
    expect(askingFromText('Offers over £120,000')).toBe(120000)
    expect(askingFromText('POA')).toBeNull()
    expect(askingFromText('£50')).toBeNull()
  })

  it('only files after somebody actually SPOKE to the branch', () => {
    const CRON = read('api/cron/call-listener.ts')
    // Filing on a dial would put 250 houses a day on the board, which is the
    // exact noise the cockpit filter exists to remove.
    expect(CRON).toMatch(/NO_CONVERSATION_COLUMNS\.includes/)
    expect(CRON).toMatch(/\.eq\('script_key', 'property_call'\)/)
    expect(CRON).toMatch(/\.not\('disposition_column_id', 'is', null\)/)
  })

  it('never files the same branch twice, and never blocks the listening step', () => {
    const CRON = read('api/cron/call-listener.ts')
    expect(CRON).toMatch(/const missing = spoke\.filter\(\(id\) => !has\.has\(id\)\)/)
    // Its own try/catch: a filing failure must not stop the calls being heard.
    const fn = CRON.slice(CRON.indexOf('async function fileHousesForSpokenBranches'), CRON.indexOf('export default'))
    expect(fn).toMatch(/catch \(e\)/)
    expect(fn).not.toMatch(/throw/)
  })

  it('the scan is wide enough that reading one call cannot starve the rest', () => {
    // Reading a property touches its row, so the already-read ones sit at the
    // top of an updated_at sort. A narrow window fills with them and the older
    // unread calls are never reached.
    const CRON = read('api/cron/call-listener.ts')
    const scan = Number(CRON.match(/const SCAN = (\d+)/)?.[1] ?? 0)
    expect(scan).toBeGreaterThanOrEqual(400)
  })
})
