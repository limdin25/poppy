import { describe, it, expect } from 'vitest';
import { hostunicoPriceCopy } from '../supabase/functions/_shared/hostunico-pricing';
import { hostunicoInstantAnswer, HOSTUNICO_RULES } from '../supabase/functions/_shared/hostunico-sales';
import { prepareSpareRoomImport } from '../scripts/lib/hostunico-spareroom.mjs';
import { reportProperty, reportSms, REPORT_AHEAD } from '../api/lib/hostunico-report';

describe('Hostunico sales desk', () => {
  it('keeps VAT on its own line for both country prices without changing the billing promise', () => {
    for (const [country, price] of [['GB', '£29'], ['US', '$29']]) {
      const copy = hostunicoPriceCopy(country);
      expect(copy).toContain('Management fee: 9%');
      expect(copy).toContain('\nVAT: 20% of the management fee, added separately.\n');
      expect(copy).toContain(price + ' a month');
      expect(copy).toContain('current billing remains 9%');
      expect(copy).not.toMatch(/10\.8(?:0)?\s*%/);
      expect(copy).not.toMatch(/[\u2013\u2014]/);
    }
  });
  it('groups repeated numbers and repeated advertisements without dropping different properties', () => {
    const first = { Number: '07700900123', Link: 'https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=1234', Price: '150pw', Name: 'Property', 'Advertiser Name': 'Test' };
    const result = prepareSpareRoomImport([first, first, { ...first, Link: first.Link.replace('1234', '5678') }]);
    expect(result.sourceRows).toBe(3);
    expect(result.contacts).toHaveLength(1);
    expect(result.properties).toHaveLength(2);
    expect(result.duplicateRows).toBe(1);
    expect(result.properties[0].monthlyRent).toBe(650);
    expect(result.properties[0].sourcePrice).toBe('150pw');
  });
  it('refuses conflicting owners of one advert and rejects invalid numbers', () => {
    const row = { Number: '07700900123', Link: 'https://www.spareroom.co.uk/?flatshare_id=1234' };
    expect(() => prepareSpareRoomImport([row, { ...row, Number: '07700900124' }])).toThrow(/conflicting/);
    expect(prepareSpareRoomImport([{ ...row, Number: 'abc' }]).rejected).toHaveLength(1);
  });
  it('requires whole-property facts and never invents missing bathrooms or postcodes', () => {
    const p = { postcode: 'M1 5QA', bedrooms: 2, bathrooms: 1, wholeProperty: true };
    expect(reportProperty(p)).toEqual(p);
    for (const bad of [{ ...p, postcode: 'M1' }, { ...p, bathrooms: null }, { ...p, wholeProperty: false }, { ...p, bedrooms: 0 }, { ...p, bedrooms: '2' }]) expect(reportProperty(bad)).toBeNull();
    expect(REPORT_AHEAD).toBe(10);
  });
  it('only builds texts for the report service, including the income caveat', () => {
    const url = 'https://hostunico.com/r/A1b2C';
    expect(reportSms(url)).toContain('not guaranteed income');
    expect(() => reportSms('https://evil.example/report')).toThrow();
    expect(() => reportSms('https://hostunico.com/login')).toThrow();
  });
  it('gives immediate approved answers and no answer to an unrelated statement', () => {
    expect(hostunicoInstantAnswer('How much is your fee?')?.say).toContain('9%');
    expect(hostunicoInstantAnswer('Is the income guaranteed?')?.say).toContain('not guaranteed');
    expect(hostunicoInstantAnswer('Who manages the cleaner?')?.say).toContain('operations team');
    expect(hostunicoInstantAnswer('It has two bedrooms')).toBeNull();
    expect(hostunicoInstantAnswer('Who are you with?')?.say).toContain('Hostunico');
    expect(hostunicoInstantAnswer('Send the report', 'GB', { phone: '+447700900123' })?.nextQuestion).toBe('Can I text it to this number?');
    expect(hostunicoInstantAnswer('Send the report', 'GB', { phone: '+442079460123' })?.nextQuestion).toContain('What mobile number');
    expect(hostunicoInstantAnswer('Send the report', 'GB', { phone: '+442079460123', mobile: '+447700900456' })?.nextQuestion).toContain('0456');
    expect(hostunicoInstantAnswer('Send the report by email', 'GB', { phone: '+447700900123' })?.nextQuestion).toContain('What email address');
    expect(HOSTUNICO_RULES).toContain('No WhatsApp');
    expect(HOSTUNICO_RULES).toContain('Only say it has been sent after');
  });
});
