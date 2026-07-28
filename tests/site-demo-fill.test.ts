import { describe, it, expect } from 'vitest';
import {
  fillSiteContent,
  firstWord,
  formatUkPhone,
  buildTagline,
  buildAreaBand,
} from '../src/core/site-demo/fill';
import { reviewsAreGoogleSourced, type SiteDemoData } from '../src/core/site-demo/types';
import { tradeCopy } from '../src/core/site-demo/trade-services';

const lead = (over: Partial<SiteDemoData> = {}): SiteDemoData => ({
  businessName: 'MJR Plumbing',
  ownerFirst: 'Matthew',
  tradeKey: 'plumber',
  tradeLabel: 'Plumber',
  tradePlural: 'plumbers',
  profileKey: 'plumbing',
  town: 'Wigan',
  phoneDisplay: '07576 558278',
  phoneE164: '+447576558278',
  ...over,
});

describe('firstWord', () => {
  it('takes the person out of a full name', () => {
    expect(firstWord('Matthew Riley')).toBe('Matthew');
  });
  it('survives absence without throwing or leaking undefined', () => {
    expect(firstWord(undefined)).toBe('');
    expect(firstWord(null)).toBe('');
    expect(firstWord('   ')).toBe('');
  });
});

describe('formatUkPhone', () => {
  it('writes a mobile the way a person writes it', () => {
    expect(formatUkPhone('+447700900123')).toBe('07700 900123');
  });
  it('handles an 020 landline', () => {
    expect(formatUkPhone('+442079460123')).toBe('020 7946 0123');
  });
  it('returns anything unrecognised untouched rather than mangling it', () => {
    expect(formatUkPhone('+1 555 0100')).toBe('+1 555 0100');
    expect(formatUkPhone('')).toBe('');
  });
});

describe('copy assembly never leaves a hole', () => {
  it('drops the town from the tagline instead of leaving a token', () => {
    expect(buildTagline('Plumber', 'Wigan')).toBe('Plumber in Wigan');
    expect(buildTagline('Plumber', '')).toBe('Plumber');
  });

  it('rewrites the area band entirely when there is no town', () => {
    expect(buildAreaBand('Wigan', 'plumbers')).toContain('Wigan');
    const noTown = buildAreaBand('', 'plumbers');
    expect(noTown).not.toContain('undefined');
    expect(noTown).toContain('plumbers');
  });
});

describe('fillSiteContent', () => {
  it('fills every field from the lead', () => {
    const c = fillSiteContent(lead());
    expect(c.businessName).toBe('MJR Plumbing');
    expect(c.tagline).toBe('Plumber in Wigan');
    expect(c.services).toEqual(tradeCopy('plumbing').services);
    expect(c.bands).toHaveLength(3);
    expect(c.colours.accent).toBe(tradeCopy('plumbing').accent);
  });

  it('puts the phone number in the third pillow band, as the fact itself', () => {
    const c = fillSiteContent(lead());
    expect(c.bands[2]).toBe('07576 558278');
  });

  // The one rule that matters: a literal token must never reach a real prospect.
  it('never emits an unfilled token, however little we know', () => {
    const bare = fillSiteContent({
      businessName: 'Acme',
      tradeKey: 'x',
      tradeLabel: '',
      tradePlural: '',
      phoneDisplay: '',
      phoneE164: '+447700900123',
    });
    const all = JSON.stringify(bare);
    expect(all).not.toMatch(/\[[a-z_]+\]/);
    expect(all).not.toMatch(/\{\{|\}\}/);
    expect(all).not.toContain('undefined');
    expect(all).not.toContain('null');
  });

  it('falls back to a formatted phone when no display form was given', () => {
    const c = fillSiteContent(lead({ phoneDisplay: '', phoneE164: '+447700900123' }));
    expect(c.phoneDisplay).toBe('07700 900123');
  });

  it('tidies a lowercase town', () => {
    expect(fillSiteContent(lead({ town: 'wigan' })).town).toBe('Wigan');
  });

  // Trade.label is a person noun. Lowercasing it into the about paragraph
  // produced "handles plumber work", which is not English.
  it('describes the work, not the person, in the about paragraph', () => {
    const c = fillSiteContent(lead());
    expect(c.about).toContain('takes on plumbing and heating work around Wigan');
    expect(c.about).not.toContain('plumber work');
  });

  it('adapts to a completely different trade with no layout knowledge', () => {
    const c = fillSiteContent(
      lead({ tradeKey: 'locksmith', tradeLabel: 'Locksmith', tradePlural: 'locksmiths', profileKey: 'locksmith' }),
    );
    expect(c.tagline).toBe('Locksmith in Wigan');
    expect(c.services).toContain('Emergency lockouts');
    expect(c.services).not.toContain('Boiler repairs');
  });

  it('still produces a usable page for a trade with no profile', () => {
    const c = fillSiteContent(lead({ profileKey: null, tradeLabel: 'Tradesman' }));
    expect(c.services.length).toBeGreaterThan(0);
    expect(c.glyph).toBe('mark');
  });
});

// The truth rules, as tests. These are the ones that would be a legal problem,
// not a copy problem, if they ever regressed.
describe('truth rules', () => {
  it('renders Google proof only when Google actually gave it to us', () => {
    const withGoogle = fillSiteContent(lead({ rating: 4.8, reviews: 37, reviewsSource: 'google' }));
    expect(withGoogle.proof).toEqual({ rating: 4.8, reviews: 37 });
  });

  it('drops proof entirely when the numbers came from the unreliable CSV', () => {
    const csv = fillSiteContent(lead({ rating: 4.8, reviews: 37, reviewsSource: 'csv' }));
    expect(csv.proof).toBeUndefined();
  });

  it('drops proof when there is no source at all', () => {
    expect(fillSiteContent(lead({ rating: 4.8, reviews: 37 })).proof).toBeUndefined();
    expect(reviewsAreGoogleSourced(lead({ rating: 4.8, reviews: 37 }))).toBe(false);
  });

  it('never invents a certification, a guarantee, a price or a founding year', () => {
    const all = JSON.stringify(fillSiteContent(lead())).toLowerCase();
    for (const banned of [
      'gas safe', 'niceic', 'napit', 'checkatrade', 'insured', 'insurance',
      'certified', 'accredited', 'guarantee', 'warranty', 'award',
      'years of experience', 'established 1', 'established 2', 'family run',
      '£', 'free quote guaranteed', '24/7', 'within the hour',
    ]) {
      expect(all).not.toContain(banned);
    }
  });
});
