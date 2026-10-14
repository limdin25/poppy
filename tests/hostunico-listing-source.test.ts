import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import HostunicoScriptPane from '../src/features/crm/components/live-call/HostunicoScriptPane';
import { saScriptTokens, saSourceName, type SaListing } from '../src/features/crm/hooks/useSaListings';

// Part 3 (Hugo, 2026-10-14): the opener names the site the advert is really on.
const westgate = { id: 'ebfbe25e', rightmoveId: '92751003', source: 'rightmove', city: 'Cardiff', address: '11 Westgate Street, Cardiff', bedrooms: 2, bathrooms: 1, propertyType: 'flat', rentPcm: 1100, photoUrls: [], listingUrl: 'https://www.rightmove.co.uk/properties/92751003#/?channel=RES_LET' } as unknown as SaListing;
const spare = { ...westgate, id: 'spare', rightmoveId: 'spareroom:123', source: 'spareroom', listingUrl: 'https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=123' } as unknown as SaListing;

describe('source-aware opener', () => {
  it('a Rightmove lead says on Rightmove in the dropdown and the opener', () => {
    const html = renderToStaticMarkup(createElement(HostunicoScriptPane, { listing: westgate, agentName: 'Pedro', onOpener: () => {} }));
    expect(html).toContain('<option value="listing" selected="">1. Rightmove</option>');
    expect(html).toContain('on Rightmove. Is it still available?');
    expect(html).not.toContain('SpareRoom');
  });
  it('a SpareRoom lead says on SpareRoom', () => {
    const html = renderToStaticMarkup(createElement(HostunicoScriptPane, { listing: spare, agentName: 'Pedro', onOpener: () => {} }));
    expect(html).toContain('1. SpareRoom</option>');
    expect(html).toContain('on SpareRoom. Is it still available?');
  });
  it('reads sa_listings.source first and the advert URL only as a fallback', () => {
    expect(saSourceName({ source: 'rightmove', listingUrl: 'https://www.spareroom.co.uk/x' })).toBe('Rightmove');
    expect(saSourceName({ source: 'spareroom', listingUrl: 'https://www.rightmove.co.uk/properties/1' })).toBe('SpareRoom');
    expect(saSourceName({ source: null, listingUrl: 'https://www.rightmove.co.uk/properties/1' })).toBe('Rightmove');
    expect(saScriptTokens(westgate).sa_source).toBe('Rightmove');
    expect(saScriptTokens(spare).sa_source).toBe('SpareRoom');
  });
  it('the bundled script and the database migration use the [sa_source] placeholder, never a hardcoded site', () => {
    const html = readFileSync('src/core/content/sa-call-script.html', 'utf8');
    expect(html).toContain('on [sa_source]. Is it still available?');
    expect(html).not.toContain('on SpareRoom.');
    const migration = readFileSync('supabase/migrations/20261014000001_hostunico_listing_source_opener.sql', 'utf8');
    expect(migration).toContain("'on [sa_source]. Is it still available?'");
    expect(migration).toContain("'listing','spareroom','facebook','followup'");
  });
});
