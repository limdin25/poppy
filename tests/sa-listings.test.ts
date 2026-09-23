// Which rentals reach Pedro on the Serviced Accommodation desk (Hugo,
// 2026-09-23): city-centre flats only, one per agency, then that agency rests
// 14 days; an agency that never does company lets is never rung again.

import { describe, expect, it } from 'vitest'
import {
  AGENCY_REST_DAYS, NEVER_AGAIN, SA_AREAS, areaList, resolveHit, searchUrl, parseSearchPage,
  toE164Uk, monthlyRent, refuseReason, toListing, bestPerAgency, decideAgency, roundRobin, spokenStreet,
// @ts-expect-error plain .mjs, no types
} from '../scripts/lib/sa-listings.mjs'

const NOW = Date.parse('2026-09-23T20:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

/** A search row the way Rightmove's __NEXT_DATA__ hands it over. */
function row(over: Record<string, unknown> = {}, customer: Record<string, unknown> = {}) {
  return {
    id: 93461346,
    transactionType: 'rent',
    students: false,
    commercial: false,
    development: false,
    bedrooms: 2,
    bathrooms: 1,
    propertySubType: 'Apartment',
    propertyTypeFullDescription: '2 bedroom apartment',
    summary: 'A bright two bedroom apartment in the heart of the city.',
    heading: '',
    displayStatus: '',
    displayAddress: 'Parliament Square, 8 Crump Street, Liverpool',
    price: { amount: 1000, frequency: 'monthly' },
    firstVisibleDate: '2026-09-23T01:15:13Z',
    propertyUrl: '/properties/93461346#/?channel=RES_LET',
    propertyImages: { images: [{ srcUrl: 'https://media.rightmove.co.uk/a.jpg' }] },
    customer: {
      branchId: 274493,
      contactTelephone: '0161 696 1562',
      branchDisplayName: 'Belvoir, Liverpool',
      brandTradingName: 'Belvoir',
      buildToRent: false,
      ...customer,
    },
    ...over,
  }
}

describe('the areas', () => {
  it('are city centres, London and Scotland included', () => {
    expect(SA_AREAS.Liverpool).toEqual(['L1', 'L2', 'L3'])
    expect(SA_AREAS.Manchester).toEqual(['M1', 'M2', 'M3', 'M4'])
    expect(SA_AREAS.London).toContain('W1')
    expect(SA_AREAS.Edinburgh).toContain('EH1')
    expect(SA_AREAS.Glasgow).toContain('G1')
    expect(areaList().length).toBeGreaterThan(60)
  })
  it('a postcode resolves to its own outcode, a London district to its region, never a neighbour', () => {
    const l1 = [{ type: 'OUTCODE', displayName: 'L18', id: 1350 }, { type: 'OUTCODE', displayName: 'L1', id: 1341 }]
    expect(resolveHit('L1', l1)).toBe('OUTCODE^1341')
    const w1 = [{ type: 'REGION', displayName: 'W1, West London', id: 91991 }, { type: 'OUTCODE', displayName: 'W11', id: 2745 }]
    expect(resolveHit('W1', w1)).toBe('REGION^91991')
    expect(resolveHit('W1', [{ type: 'OUTCODE', displayName: 'W11', id: 2745 }])).toBeNull()
  })
  it('searches newest first, 1 to 3 beds, no let agreed, no rooms or students', () => {
    const u = searchUrl('OUTCODE^1341', 24)
    expect(u).toContain('property-to-rent/find.html')
    expect(u).toContain('sortType=6')
    expect(u).toContain('index=24')
    expect(u).toContain('includeLetAgreed=false')
    expect(decodeURIComponent(u)).toContain('dontShow=houseShare,retirement,student')
  })
})

describe('reading a page', () => {
  it('pulls the properties out of __NEXT_DATA__', () => {
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { searchResults: { properties: [row()] } } } })}</script></html>`
    expect(parseSearchPage(html)).toHaveLength(1)
    expect(parseSearchPage('<html>nothing</html>')).toEqual([])
  })
  it('phones become E.164, anything not UK is refused', () => {
    expect(toE164Uk('0161 696 1562')).toBe('+441616961562')
    expect(toE164Uk('+44 (0)20 3834 8046')).toBe('+442038348046')
    expect(toE164Uk('03300 533848')).toBe('+443300533848')
    expect(toE164Uk('+1 555 123 4567')).toBe('')
    expect(toE164Uk('')).toBe('')
  })
  it('weekly rent becomes monthly', () => {
    expect(monthlyRent({ amount: 1000, frequency: 'monthly' })).toBe(1000)
    expect(monthlyRent({ amount: 300, frequency: 'weekly' })).toBe(1300)
    expect(monthlyRent({ amount: 0 })).toBeNull()
  })
})

describe('what reaches Pedro', () => {
  it('a normal city-centre flat from a letting agent does', () => {
    expect(refuseReason(row())).toBeNull()
  })
  it('refuses rooms, students, build to rent, houses, short lets and portals', () => {
    expect(refuseReason(row({ students: true }))).toBe('student let')
    expect(refuseReason(row({ development: true }))).toBe('build to rent block')
    expect(refuseReason(row({}, { buildToRent: true }))).toBe('build to rent block')
    expect(refuseReason(row({ bedrooms: 0 }))).toBe('not 1 to 3 bedrooms')
    expect(refuseReason(row({ bedrooms: 5 }))).toBe('not 1 to 3 bedrooms')
    expect(refuseReason(row({ propertySubType: 'Terraced' }))).toBe('a house, not a city-centre flat')
    expect(refuseReason(row({ summary: 'Serviced apartment, all bills, short let available' }))).toBe('already a short let, room or student let')
    expect(refuseReason(row({}, { branchDisplayName: 'OpenRent, Covering London', brandTradingName: 'OpenRent' }))).toBe('portal or operator, not an agent')
    expect(refuseReason(row({}, { branchDisplayName: 'Accommodation.co.uk, covering National' }))).toBe('portal or operator, not an agent')
    expect(refuseReason(row({}, { branchDisplayName: 'Your Housing Group, Your Eaves Brook' }))).toBe('portal or operator, not an agent')
    expect(refuseReason(row({ displayStatus: 'Let agreed' }))).toBe('let agreed')
    expect(refuseReason(row({}, { contactTelephone: '' }))).toBe('no UK phone')
  })
  it('stores the flat with its agency, phone, rent and link', () => {
    const l = toListing(row(), { city: 'Liverpool', code: 'L1' })
    expect(l).toMatchObject({
      rightmove_id: '93461346', branch_id: '274493', agency: 'Belvoir, Liverpool',
      agency_phone: '+441616961562', city: 'Liverpool', outcode: 'L1', rent_pcm: 1000, bedrooms: 2,
    })
    expect(l.listing_url).toBe('https://www.rightmove.co.uk/properties/93461346#/?channel=RES_LET')
    expect(l.photo_urls).toEqual(['https://media.rightmove.co.uk/a.jpg'])
  })
})

describe('one flat per agency', () => {
  it('keeps the newest flat per phone', () => {
    const a = { agency_phone: '+441', rightmove_id: 'old', first_listed_at: '2026-09-01T00:00:00Z' }
    const b = { agency_phone: '+441', rightmove_id: 'new', first_listed_at: '2026-09-20T00:00:00Z' }
    const c = { agency_phone: '+442', rightmove_id: 'other', first_listed_at: '2026-09-10T00:00:00Z' }
    const out = bestPerAgency([a, b, c])
    expect(out.size).toBe(2)
    expect(out.get('+441').rightmove_id).toBe('new')
  })
})

describe('the 14-day rest', () => {
  it('rests 14 days', () => expect(AGENCY_REST_DAYS).toBe(14))
  it('a new agency is dealt', () => {
    expect(decideAgency([], NOW)).toMatchObject({ deal: true, reason: 'new agency' })
  })
  it('an agency dealt 13 days ago rests', () => {
    expect(decideAgency([{ dealt_at: daysAgo(13) }], NOW).deal).toBe(false)
  })
  it('an agency dealt 15 days ago comes back with a new flat', () => {
    expect(decideAgency([{ dealt_at: daysAgo(15), outcome: 'said_no' }], NOW).deal).toBe(true)
  })
  it('the most recent deal counts, not the oldest', () => {
    expect(decideAgency([{ dealt_at: daysAgo(40) }, { dealt_at: daysAgo(2) }], NOW).deal).toBe(false)
  })
  it('an agency that never does company lets is never dealt again', () => {
    expect(decideAgency([{ dealt_at: daysAgo(200), outcome: NEVER_AGAIN }], NOW)).toMatchObject({ deal: false })
  })
})

describe('the day is spread across the country', () => {
  it('takes one per city in turn', () => {
    const byCity = new Map([
      ['London', ['L1', 'L2', 'L3']],
      ['Leeds', ['E1']],
      ['York', ['Y1', 'Y2']],
    ])
    expect(roundRobin(byCity, 5)).toEqual(['L1', 'E1', 'Y1', 'L2', 'Y2'])
    expect(roundRobin(byCity, 100)).toHaveLength(6)
  })
  it('the opener says the street, not the building', () => {
    expect(spokenStreet('Parliament Square, 8 Crump Street, Liverpool')).toBe('Crump Street')
    expect(spokenStreet('Frederick Street, Edinburgh, EH2')).toBe('Frederick Street')
    expect(spokenStreet('Dakota House, The Hub')).toBe('Dakota House')
  })
})
