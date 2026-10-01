import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { hostunicoProperty } from '../src/features/crm/lib/hostunicoProperty';
import { reportPhone, reportPhoneKind } from '../supabase/functions/_shared/hostunico-phone';
import { mergeLiveRows, splitHostunicoCoach } from '../supabase/functions/_shared/hostunico-coach';
import { hostunicoInstantAnswer } from '../supabase/functions/_shared/hostunico-sales';
import HostunicoScriptPane from '../src/features/crm/components/live-call/HostunicoScriptPane';
import HostunicoCoachView from '../src/features/crm/components/live-call/HostunicoCoachView';
import type { SaListing } from '../src/features/crm/hooks/useSaListings';
import { spareRoomPhotos } from '../scripts/lib/spareroom-photos.mjs';
import { wholeHomeEligibility } from '../scripts/lib/hostunico-spareroom.mjs';

const listing = { id: 'one', city: 'Manchester', address: 'Studio on Princess Road', bedrooms: null, bathrooms: null, propertyType: null, rentPcm: 1000, photoUrls: [] } as unknown as SaListing;
describe('the property changes with the call', () => {
  it('uses studio as advertised and never converts an unknown layout to the report assumption', () => {
    expect(hostunicoProperty(listing).description).toBe('studio');
    expect(hostunicoProperty({ ...listing, address: 'Princess Road' }).description).toBe('property');
    expect(hostunicoProperty(listing).bathroom).toBe('Bathrooms to confirm');
  });
  it('renders each selected property into the actual script', () => {
    const first = renderToStaticMarkup(createElement(HostunicoScriptPane, { listing, agentName: 'Pedro', onOpener: () => {} }));
    const next = renderToStaticMarkup(createElement(HostunicoScriptPane, { listing: { ...listing, id: 'two', propertyType: 'flat', address: 'Flat in Liverpool', city: 'Liverpool', bedrooms: 2, rentPcm: 1200 }, agentName: 'Pedro', onOpener: () => {} }));
    expect(first).toContain('your studio in Manchester at £1,000');
    expect(next).toContain('your 2-bedroom flat in Liverpool at £1,200');
    expect(next).not.toContain('Princess Road');
    expect(next).toContain('What mobile number can I text the report to? Or would you prefer email?');
  });
});
describe('fast answers stay current', () => {
  it('keeps a newer streamed update when an older backfill completes', () => {
    expect(mergeLiveRows([{ id: '1', ts: '2026-09-30', body: 'old' }], [{ id: '1', ts: '2026-09-30', body: 'new' }, { id: '2', ts: '2026-10-01', body: 'latest' }]).map((r) => r.body)).toEqual(['new', 'latest']);
  });
  it('renders answer and next question separately, newest first', () => {
    const html = renderToStaticMarkup(createElement(HostunicoCoachView, { lines: [], cards: [{ id: 'old', ts: '1', body: 'Old advice' }, { id: 'new', ts: '2', body: 'SAY: You keep your account.\nASK: Is the property furnished?', status: 'final' }], active: true, offline: false, connected: true, opener: 'Hello', country: 'GB' }));
    expect(html.indexOf('You keep your account.')).toBeLessThan(html.indexOf('Old advice'));
    expect(html).toContain('Then ask'); expect(html).toContain('Is the property furnished?');
    expect(html).not.toContain('62%');
  });
  it('prioritises a refusal and does not confuse earning potential with our fee', () => {
    expect(hostunicoInstantAnswer('Not interested, your fee is too much')?.key).toBe('hostunico-stop');
    expect(hostunicoInstantAnswer('Not interested')?.nextQuestion).toBe('');
    expect(hostunicoInstantAnswer('How much can my property make?')).toBeNull();
    expect(hostunicoInstantAnswer('How much is it?', 'US')?.say).toContain('$29');
    expect(splitHostunicoCoach('SAY: One answer.\nASK: One question?')).toEqual({ say: 'One answer.', ask: 'One question?' });
  });
  it('replaces advice as the prospect corrects their question without reviving the old answer', () => {
    const props = { active: true, offline: false, connected: true, opener: 'Hello', country: 'GB' };
    const old = { id: 'old', ts: '1', body: 'SAY: The fee is 9%.\nASK:', status: 'final' };
    const lines = [{ id: 'correction', ts: '2', speaker: 'caller', body: 'Actually I mean your company address, not the fee.' }];
    const nextWords = (cards: typeof old[]) => renderToStaticMarkup(createElement(HostunicoCoachView, { ...props, lines, cards })).match(/data-testid="hostunico-next-line"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    expect(nextWords([old])).toContain('Picking the next answer');
    const corrected = { id: 'new', ts: '3', body: 'SAY: Our registered address is 483 Green Lanes, London, N13 4BS.\nASK:', status: 'final' };
    expect(nextWords([old, corrected])).toContain('483 Green Lanes');
    expect(nextWords([old, corrected])).not.toContain('9%');
  });
});
describe('report recipients and real advert photos', () => {
  it('accepts whole studios and one-bedroom homes, excluding shared kitchens even under a misleading whole-property tag', () => {
    const whole = '\n(whole property)\nThis ad is for a 1 bed flat\nAvailability\n';
    expect(wholeHomeEligibility('One bed flat', whole).eligible).toBe(true);
    expect(wholeHomeEligibility('Self-contained studio', 'Private kitchen. Not a house share. More private than a conventional house share.\n(whole property)\nThis ad is for a Studio flat\nAvailability\n').eligible).toBe(true);
    expect(wholeHomeEligibility('Private studio', 'Shared kitchen and lounge\n' + whole).eligible).toBe(false);
    expect(wholeHomeEligibility('Ensuite room', whole).eligible).toBe(false);
    expect(wholeHomeEligibility('2 bed flat', whole.replace('1 bed', '2 bed')).eligible).toBe(false);
    expect(wholeHomeEligibility('Studio', 'Room to rent, double bedroom').eligible).toBe(false);
  });
  it('normalises one phone identity and excludes UK landlines, personal numbers and pagers', () => {
    expect(reportPhone('07700 900123')).toBe('+447700900123');
    expect(reportPhone('0044 7700 900123')).toBe('+447700900123');
    for (const number of ['02079460000', '07012345678', '07612345678']) expect(reportPhoneKind(number)).toBe('landline');
    expect(reportPhoneKind('+12025550123')).toBe('unknown');
    expect(reportPhone('banana')).toBeNull();
  });
  it('imports gallery photos, never the advertiser profile picture', () => {
    const photo = 'https://photos2.spareroom.co.uk/images/flatshare/listings/large/10/13/101346780.jpg';
    expect(spareRoomPhotos(`<a href="${photo}" data-src="${photo}"></a><img src="https://photos2.spareroom.co.uk/images/flatshare/listings/square/21/65/21653221.jpg">`)).toEqual([photo]);
  });
});
