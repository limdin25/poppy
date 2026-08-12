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
import { compText, scriptTokensFor } from '../src/features/crm/hooks/usePropertyListings'
import type { PropertyListing } from '../src/features/crm/hooks/usePropertyListings'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const TABS = read('src/features/crm/components/live-call/DialerRightTabs.tsx')
const PAGE = read('src/features/crm/dialer-pro/DialerProPage.tsx')
const STRIP = read('src/features/crm/components/live-call/OfferStrip.tsx')
const META = read('src/features/crm/components/live-call/ContactMetaCompact.tsx')
const HOOK = read('src/features/crm/hooks/usePropertyListings.ts')

describe('the tab set swaps, it does not just grow', () => {
  it('the Coach is what a property call opens on', () => {
    // Hugo 2026-08-12: the houses panel moved to COL 1, under the SMS history,
    // "in that way he can have the coach always open as well". So this column
    // no longer carries a Houses tab at all, and a property call lands on the
    // Coach instead of leaving it behind a click.
    expect(TABS).toMatch(/label="Coach"/)
    expect(TABS).not.toMatch(/label="Houses"/)
    expect(TABS).not.toMatch(/<PropertiesPane/)
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

  it('defaults to Coach in houses mode, Calculator otherwise', () => {
    expect(TABS).toMatch(/useState<Tab>\(showHouses \? 'coach' : 'calculator'\)/)
  })

  it('Messages is still reachable on a property call', () => {
    // The tab set shrank to two. Losing the send box with it would take the
    // mid-call SMS off the one agent who uses it most.
    expect(TABS).toMatch(/label="Messages"/)
    expect(TABS).toMatch(/tab === 'messages' && \(/)
  })

  it('showHouses is optional, so every existing caller is unchanged', () => {
    expect(TABS).toMatch(/showHouses\?: boolean/)
  })
})

describe('the house sits in the left column, under a collapsible SMS history', () => {
  it('COL 1 mounts the house panel, and only on a property call', () => {
    // Hugo's words: "move that to the left-hand side where it's written SMS
    // history appears here once a call connects... below that you put the
    // house details."
    expect(PAGE).toMatch(/<PropertiesPane/)
    expect(PAGE).toMatch(/\{isHousesCall \? \(/)
    // And the plumber room keeps the plain timeline it has always had.
    expect(PAGE).toMatch(/<CallTimeline callId=\{state\.currentCallId\} \/>/)
  })

  it('the SMS history folds away, and remembers only for the session', () => {
    // Shut by default: it is empty until a call connects, and the house is the
    // thing being worked from. sessionStorage, so a new day starts tidy.
    expect(PAGE).toMatch(/sessionStorage\.getItem\('dialer_pro_sms_open'\) === '1'/)
    expect(PAGE).toMatch(/data-testid="dialer-sms-toggle"/)
  })

  it('keeps the word Houses on screen, because the coach says it out loud', () => {
    // instantCoach, the training questions and the daily report all tell Pedro
    // to write the figure "in the Houses tab". Those words have to point at
    // something he can still see.
    expect(PAGE).toMatch(/data-testid="dialer-houses-panel"/)
    expect(PAGE).toMatch(/<span>Houses<\/span>/)
  })

  it('the property room has its own saved column widths', () => {
    // COL 1 now carries the whole house panel, so it opens wider. The plumber
    // room keeps v4 and every width already dragged into place.
    expect(PAGE).toMatch(/autoSaveId=\{isHousesCall \? 'dialer-pro-houses-layout-v1' : 'dialer-pro-call-layout-v4'\}/)
  })

  it('the rail is folded away on arrival in the call room', () => {
    // Hugo: "the menu on the left always starts minimized."
    const layout = read('src/features/crm/layout/Smsv2Layout.tsx')
    expect(layout).toMatch(/pathname\.startsWith\('\/admin\/crm\/dialer'\)/)
    expect(layout).toMatch(/if \(onDialer && !wasOnDialer\.current\) setSidebarCollapsed\(true\)/)
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

  it('shows the strategy, the BMV band and the reason line', () => {
    // Stage 7. Pedro was guessing at all three: what kind of deal this is,
    // how hard he may push, and why we want the house at all.
    expect(STRIP).toMatch(/\{strategy\}/)
    expect(STRIP).toMatch(/\{band\.label\}/)
    expect(STRIP).toMatch(/\{band\.note\}/)
    expect(STRIP).toMatch(/BAND_CLS\[band\.code\]/)
  })

  it('draws NOTHING at all when the engine did not judge the property', () => {
    // The normal state today, not an edge case: the deal engine that fills
    // these is still being wired up, so most properties arrive with all three
    // empty. Each is behind its own guard, so an unjudged property renders
    // exactly the strip Pedro has now: no empty box, no placeholder dash.
    expect(STRIP).toMatch(/\{\(strategy \|\| band\) && \(/)
    expect(STRIP).toMatch(/\{reason && \(/)
    // And all three are READ off the listing, never worked out from the
    // figures on screen. BMV is measured against GDV minus refurb, the refurb
    // never reaches this repo, so anything computed here would be plausible
    // and wrong. api/lib/brrr-deal-facts.ts is the only reader.
    expect(STRIP).toMatch(/listing\.withdrawn \? null : listing\.strategy/)
    expect(STRIP).toMatch(/listing\.withdrawn \? null : listing\.bmvBand/)
    // No arithmetic on the money anywhere in this component.
    expect(STRIP).not.toMatch(/offerM(in|ax)\s*[/*]/)
    expect(STRIP).not.toMatch(/asking_price\s*[/*]/)
  })

  it('a withdrawn deal wears no strategy, no band and no reason', () => {
    // Same rule as the confidence badge above it. The auditor rejected this
    // valuation, so "STRONG DEAL, needs a full refurb" underneath "valuation
    // rejected" is the same false confidence in bolder type.
    expect(STRIP).toMatch(/const reason = listing\.withdrawn \? '' : listing\.reasonLine/)
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

describe('the sold comps are sentences, never [object Object]', () => {
  // The engine files deal.evidence as OBJECTS. They were run through String(),
  // so "sold nearby, your evidence" printed "[object Object]" three times on
  // the one panel whose whole job is to justify the figure Pedro is saying.
  const comp = {
    comp_type: 'sale_same',
    address: '14 ORCHARD TERRACE',
    price: '£92,000',
    bedrooms: '3',
    property_type: 'Terraced',
    url: '',
    date_info: '2026-05-01',
    distance_m: '0',
    distance_label: 'Same road',
    source: 'Land Registry',
    floor_area_sqm: '79',
  }

  it('reads as something an agent can say down the phone', () => {
    const t = compText(comp)
    expect(t).not.toContain('[object Object]')
    expect(t).toBe('3 bed terraced, 14 ORCHARD TERRACE, £92,000, Same road, sold 2026-05-01')
  })

  it('formats a bare number, because "92000" is not a price', () => {
    expect(compText({ ...comp, price: '92000' })).toContain('£92,000')
  })

  it('leaves out what the engine did not send, rather than printing a hole', () => {
    expect(compText({ address: 'Smith Street', price: '£118,000' }))
      .toBe('Smith Street, £118,000')
    expect(compText({})).toBe('')
  })

  it('the panel splits today from after the conversion', () => {
    // A sale at the target bed count proves what the house is worth CONVERTED.
    // Read out as evidence for today's offer it is simply a wrong number.
    const pane = read('src/features/crm/components/live-call/PropertiesPane.tsx')
    expect(pane).toMatch(/c\.when === 'today'/)
    expect(pane).toMatch(/c\.when === 'after'/)
    expect(HOOK).toMatch(/str\(c\.comp_type\)\.includes\('target'\) \? 'after'/)
    // And today's sales lead the three that reach the script token.
    expect(HOOK).toMatch(/comps\.filter\(\(c\) => c\.when === 'today'\)/)
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

  it('carries the strategy, the band and the reason to the coach', () => {
    // The live coach is driven by Twilio and rebuilds from the database on
    // every caller utterance, so it cannot see the strip. Anything Pedro can
    // read off the screen has to be written onto the contact.
    const judged = {
      ...listing,
      strategy: 'BRRR',
      bmvBand: { code: 'thin', label: 'THIN DEAL', note: 'Hold near the opener.' },
      reasonLine: 'needs a full refurb, 12 Bedford St sold for £114,000',
    } as unknown as PropertyListing
    const t = scriptTokensFor(judged)
    expect(t.deal_strategy).toBe('BRRR')
    expect(t.bmv_band).toContain('THIN DEAL')
    expect(t.deal_reason).toMatch(/full refurb/)
  })

  it('CLEARS them when the next house has not been judged', () => {
    // The bug this prevents, and it is the dangerous one on this screen.
    // DialerProPage MERGES these tokens over the contact's existing
    // custom_fields, so a key that is simply left out keeps whatever the LAST
    // property wrote. One branch has many listings and Pedro switches between
    // them mid-call, so an omitted key means the coach keeps telling him
    // "STRONG DEAL" about a house nobody has graded. Empty string, always
    // present, is what overwrites it.
    const unjudged = {
      ...listing, strategy: null, bmvBand: null, reasonLine: '',
    } as unknown as PropertyListing
    const t = scriptTokensFor(unjudged)
    expect(Object.keys(t)).toContain('deal_strategy')
    expect(Object.keys(t)).toContain('bmv_band')
    expect(Object.keys(t)).toContain('deal_reason')
    expect(t.deal_strategy).toBe('')
    expect(t.bmv_band).toBe('')
    expect(t.deal_reason).toBe('')
  })

  it('the coach reads all three, and stays quiet when they are blank', () => {
    const fn = read('supabase/functions/wk-voice-transcription/index.ts')
    for (const key of ['deal_strategy', 'bmv_band', 'deal_reason']) {
      expect(fn).toMatch(new RegExp(`if \\(f\\('${key}'\\)\\)`))
    }
    // The band is Pedro's judgement, not a thing to say to an estate agent.
    expect(fn).toMatch(/Never say the band out loud/)
  })
})
