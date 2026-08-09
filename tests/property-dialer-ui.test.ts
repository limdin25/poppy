// The Houses screen, and the promise that a plumber dial is untouched.
//
// Pedro and Marr open this same room roughly 200 times a day for plumbers. The
// Houses feature edits six files they depend on (DialerScriptPane,
// DialerRightTabs, ContactMetaCompact, interpolateScript, scriptForCall,
// DialerProPage), and every one of those edits has to be a no-op unless the
// room was explicitly opened for a property call.
//
// tests/e2e/dialer-pro-houses.spec.ts proves the same thing in a real browser,
// but it is skipped without a live admin login, so these run everywhere.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scriptTokensFor } from '../src/features/crm/hooks/usePropertyListings'
import type { PropertyListing } from '../src/features/crm/hooks/usePropertyListings'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const TABS = read('src/features/crm/components/live-call/DialerRightTabs.tsx')
const PAGE = read('src/features/crm/dialer-pro/DialerProPage.tsx')
const STRIP = read('src/features/crm/components/live-call/OfferStrip.tsx')
const META = read('src/features/crm/components/live-call/ContactMetaCompact.tsx')
const HOOK = read('src/features/crm/hooks/usePropertyListings.ts')

describe('the tab set swaps, it does not just grow', () => {
  it('Houses and Coach show on a property call', () => {
    expect(TABS).toMatch(/showHouses && \(\s*\n?\s*<TabButton active=\{tab === 'houses'\}/)
    expect(TABS).toMatch(/label="Coach"/)
  })

  it('Calculator and Objections are HIDDEN on a property call', () => {
    // Not cosmetic: the Calculator works out a plumber's return on a website
    // and the Objections answer plumber objections. Both are actively
    // misleading with an estate agent on the line.
    expect(TABS).toMatch(/\{!showHouses && \(/)
    const hidden = TABS.slice(TABS.indexOf('{!showHouses && ('), TABS.indexOf('</>', TABS.indexOf('{!showHouses && (')))
    expect(hidden).toMatch(/label="Calculator"/)
    expect(hidden).toMatch(/label="Objections"/)
  })

  it('defaults to Houses when in houses mode, Calculator otherwise', () => {
    expect(TABS).toMatch(/useState<Tab>\(showHouses \? 'houses' : 'calculator'\)/)
  })

  it('showHouses is optional, so every existing caller is unchanged', () => {
    expect(TABS).toMatch(/showHouses\?: boolean/)
  })
})

describe('the offer band is pinned above the script', () => {
  it('renders in COL 2, outside the script pane, gated on houses mode', () => {
    // In a tab it can be scrolled away or never opened. Above the script it
    // cannot. That is the entire design decision.
    expect(PAGE).toMatch(/\{isHousesCall && \(\s*\n?\s*<OfferStrip/)
    expect(PAGE.indexOf('<OfferStrip')).toBeLessThan(PAGE.indexOf('<DialerScriptPane'))
  })

  it('the script is only given property tokens on a property call', () => {
    expect(PAGE).toMatch(/extraTokens=\{isHousesCall \? scriptTokensFor\(selectedListing\) : undefined\}/)
  })

  it('names the ceiling as the thing never to say', () => {
    expect(STRIP).toMatch(/NEVER SAY THIS OUT LOUD/)
    expect(STRIP).toMatch(/Walk away at/)
    expect(STRIP).toMatch(/Open at/)
  })

  it('refuses to invent a figure when the scraper sent no valuation', () => {
    // Silence is safe. A made-up number on a live negotiation is not.
    expect(STRIP).toMatch(/noValuation/)
    expect(STRIP).toMatch(/do not name a figure/i)
  })

  it('selecting a different house clears when the LEAD changes', () => {
    // A new lead is a different agency. Carrying the old selection over would
    // put another branch's asking price in front of the agent.
    expect(PAGE).toMatch(/useEffect\(\(\) => \{ setSelectedPropertyId\(null\); \}, \[activeContactId\]\)/)
  })
})

describe('the send buttons are hidden from estate agents', () => {
  it('gates the three live actions on lead_type', () => {
    // VideoLinkButton queues a "you are buried on Google" video, SubscribeButton
    // texts a pay link, SendSiteButton builds them a website. All three are
    // real, immediate, and wrong for a company we are buying a house from.
    expect(META).toMatch(/const isEstateAgent = cf\.lead_type === 'estate_agent'/)
    expect(META).toMatch(/\{!isEstateAgent && \(/)
    const guarded = META.slice(META.indexOf('{!isEstateAgent && ('), META.indexOf('</>', META.indexOf('{!isEstateAgent && (')))
    for (const b of ['VideoLinkButton', 'SubscribeButton', 'SendSiteButton']) {
      expect(guarded).toContain(b)
    }
  })
})

describe('the browser reads properties through the gated RPC, never the table', () => {
  it('calls wk_property_agent_listings and never selects brrr_properties', () => {
    // brrr_properties has no RLS and is service-role only. A direct select from
    // an anon-key session returns nothing at best, and is the wrong shape of
    // fix at worst.
    expect(HOOK).toMatch(/rpc\('wk_property_agent_listings'/)
    expect(HOOK).not.toMatch(/from\('brrr_properties'\)/)
  })

  it('will not query on a phone too short to identify a branch', () => {
    // right(digits, 9) on a 3-digit number would tail-match half the table.
    expect(HOOK).toMatch(/digits\.length >= 9/)
  })

  it('uses the shared offer maths rather than its own', () => {
    expect(HOOK).toMatch(/import \{ offerRange.*\} from '.*api\/lib\/brrr-offer'/)
    expect(HOOK).not.toMatch(/0\.7[05]/)
  })
})

describe('scriptTokensFor — what actually lands in the script', () => {
  const listing = {
    id: 'p1',
    address: 'Bedford Street, Coventry, West Midlands, CV1',
    price_text: '£120,000',
    asking_price: 120000,
    bedrooms: 3,
    property_type: 'Terraced',
    days_on_market: '54',
    agent_name: 'Pattinson',
    deal: { cmv: 116000, cmv_confidence: 'high' },
    offerMin: 81200,
    offerMax: 87500,
    ladder: '£81,200, then £84,000, then £87,500',
    confidence: 'high',
    evidence: ['12 Bedford St sold £114,000 (2026-01)'],
    flags: [],
    isAuction: false,
  } as unknown as PropertyListing

  it('shortens the address to a street for the opener', () => {
    // "Hi, I'm calling about the property on Bedford Street" reads like a
    // buyer. Reading the full postal address reads like a call centre.
    expect(scriptTokensFor(listing).property_street).toBe('Bedford Street')
  })

  it('gives the open figure and the ceiling as separate tokens', () => {
    const t = scriptTokensFor(listing)
    expect(t.offer_open).toBe('£81,200')
    expect(t.offer_ceiling).toBe('£87,500')
    expect(t.offer_open).not.toBe(t.offer_ceiling)
  })

  it('carries the confidence with the valuation, not on its own', () => {
    expect(scriptTokensFor(listing).property_worth).toBe('£116,000 (high confidence)')
  })

  it('says so plainly when there is no evidence, rather than going blank', () => {
    const bare = { ...listing, evidence: [], flags: [], deal: {} } as unknown as PropertyListing
    const t = scriptTokensFor(bare)
    expect(t.comp_evidence).toMatch(/no sold comparables/i)
    expect(t.valuation_notes).toMatch(/nothing unusual/i)
    expect(t.property_worth).toMatch(/not established/i)
  })

  it('returns nothing at all for no listing, so tokens stay visible slots', () => {
    expect(scriptTokensFor(null)).toEqual({})
  })
})
