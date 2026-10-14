import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { londonClock, listingUnfurnished, morningLevel, morningSettings, morningWindowOpen, pickReportListing, MORNING_DEFAULTS } from '../api/lib/hostunico-morning';

describe('morning leads rules', () => {
  it('reads the settings with Hugo\'s defaults: 150 ready, 150 listings, 200 reports', () => {
    expect(morningSettings(null)).toEqual(MORNING_DEFAULTS);
    expect(MORNING_DEFAULTS).toMatchObject({ target_ready: 150, max_new_listings: 150, max_reports: 200 });
    expect(morningSettings('{"target_ready":120,"max_reports":-1,"enabled":false}')).toMatchObject({ target_ready: 120, max_reports: 200, enabled: false });
    expect(morningSettings('not json').enabled).toBe(true);
  });
  it('runs Monday to Saturday from 05:45 to 10:00 London, either side of the clock change', () => {
    expect(morningWindowOpen(new Date('2026-10-14T04:45:00Z'))).toBe(true); // 05:45 BST, Wednesday
    expect(morningWindowOpen(new Date('2026-10-14T04:40:00Z'))).toBe(false);
    expect(morningWindowOpen(new Date('2026-10-14T09:05:00Z'))).toBe(false); // 10:05 BST
    expect(morningWindowOpen(new Date('2026-11-02T05:45:00Z'))).toBe(true); // 05:45 GMT, Monday
    expect(morningWindowOpen(new Date('2026-11-02T04:50:00Z'))).toBe(false); // 04:50 GMT
    expect(morningWindowOpen(new Date('2026-10-18T06:00:00Z'))).toBe(false); // Sunday
    expect(londonClock(new Date('2026-10-14T23:30:00Z')).date).toBe('2026-10-15');
  });
  it('warns when ready plus stock is under two days of calling', () => {
    expect(morningLevel(150, 60, MORNING_DEFAULTS)).toBe('info');
    expect(morningLevel(120, 60, MORNING_DEFAULTS)).toBe('warn');
    expect(morningLevel(400, 400, MORNING_DEFAULTS, true)).toBe('blocked');
  });
  it('prepares the report for a qualifying property first, never an excluded or photo-less one', () => {
    const l = (id: string, s: string, photo = true) => ({ id, hostunico_uplift_status: s, report_property: { postcode: 'LS1' }, photo_urls: photo ? ['p'] : [] });
    expect(pickReportListing([l('a', 'pending'), l('b', 'eligible')])?.id).toBe('b');
    expect(pickReportListing([l('a', 'excluded'), l('b', 'pending', false)])).toBeNull();
    expect(pickReportListing([l('a', 'excluded'), l('c', 'pending')])?.id).toBe('c');
  });
  it('notes unfurnished adverts', () => {
    expect(listingUnfurnished({ summary: 'Two bed flat, unfurnished, available now' })).toBe(true);
    expect(listingUnfurnished({ summary: 'Furnished', property_type: 'Flat' })).toBe(false);
  });
  it('the job never sends anything and is scheduled inside the morning window', () => {
    const route = readFileSync('api/cron/hostunico-morning-leads.ts', 'utf8');
    expect(route).not.toMatch(/wk-sms-send|wk-email-send|twilio|resend|sendEmail/i);
    const crons = JSON.parse(readFileSync('vercel.json', 'utf8')).crons as { path: string; schedule: string }[];
    expect(crons.find((c) => c.path === '/api/cron/hostunico-morning-leads')?.schedule).toBe('*/15 4-9 * * 1-6');
  });
});
