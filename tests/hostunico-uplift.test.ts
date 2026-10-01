import { describe, expect, it, vi } from 'vitest';
import { hostunicoUplift, hostunicoOutreachAllowed } from '../supabase/functions/_shared/hostunico-uplift';
import { hostunicoRentExplanation, hostunicoRentQuestion } from '../supabase/functions/_shared/hostunico-rent';
import { hostunicoReportHook } from '../supabase/functions/_shared/hostunico-report-pitch';

const pitch = (monthlyGbpPence: number, askingRentGbpPence = 300000) => ({ monthlyGbpPence, askingRentGbpPence });
describe('minimum 30 percent researched earnings uplift', () => {
  it('blocks every missing or failed database decision and passes the exact property and message', async () => {
    for (const result of [{ data: false, error: null }, { data: null, error: null }, { data: true, error: { message: 'Database unavailable' } }]) {
      const rpc = vi.fn(async () => result);
      expect(await hostunicoOutreachAllowed({ rpc }, 'lead', 'report-link', 'listing')).toBe(false);
      expect(rpc).toHaveBeenCalledWith('wk_hostunico_outreach_allowed', { p_contact: 'lead', p_body: 'report-link', p_listing: 'listing' });
    }
  });
  it('withholds the earnings pitch when a ready report fails qualification', () => {
    expect(hostunicoReportHook({ monthly: '£2,497', eligibility: 'excluded' } as any)).not.toContain('£2,497');
    expect(hostunicoReportHook({ monthly: '£3,900', eligibility: 'pending' } as any)).toContain('Do not pitch');
  });
  it('explains weekly rent from this property without a model inventing figures', () => {
    expect(hostunicoRentQuestion('Why is it 150 a week but 650 per month?')).toBe(true);
    expect(hostunicoRentQuestion('What is your management fee?')).toBe(false);
    expect(hostunicoRentExplanation('150pw', 650)).toBe('The advert says £150 a week. That works out to around £650 a month, using 52 weeks divided by 12.');
    expect(hostunicoRentExplanation('275pw', 1191.67)).toContain('£275 a week');
    expect(hostunicoRentExplanation('150pw', 600)).toBeNull();
  });
  it.each([249700, 300000, 389999])('excludes %s pence against a 3000 pound asking rent', (amount) => {
    expect(hostunicoUplift('ready', pitch(amount), 3000).status).toBe('excluded');
  });
  it.each([390000, 390001, 500000])('accepts %s pence at or above the exact threshold', (amount) => {
    expect(hostunicoUplift('ready', pitch(amount), 3000).status).toBe('eligible');
  });
  it('does not let planning targets, missing research, missing rent or malformed figures pass', () => {
    for (const [state, value, rent] of [
      ['ready', { ...pitch(500000), planning: true }, 3000], ['researching', pitch(500000), 3000],
      ['ready', pitch(500000), null], ['ready', pitch(NaN), 3000], ['ready', pitch(Infinity), 3000],
      ['ready', { monthly: '£9,000', rent: '£3,000' }, 3000], ['ready', pitch(500000, 250000), 3000],
      ['ready', { monthlyGbpPence: '500000', askingRentGbpPence: 300000 }, 3000],
    ] as const) expect(hostunicoUplift(state, value, rent).status).toBe('pending');
  });
  it('compares unrounded source pence, independent of displayed currency and higher flag', () => {
    expect(hostunicoUplift('ready', { ...pitch(389999), monthly: '$9,000', higher: true }, 3000).status).toBe('excluded');
    expect(hostunicoUplift('ready', pitch(154918, 119167), 1191.67).status).toBe('eligible');
    expect(hostunicoUplift('ready', pitch(154917, 119167), 1191.67).status).toBe('excluded');
  });
});
