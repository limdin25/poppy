import { describe, it, expect } from 'vitest';
import { buildChatPrompt, chatCloseOffer } from '../src/core/site-demo/chat-prompt';
import { fillSiteContent } from '../src/core/site-demo/fill';
import { nonGsm7 } from '../api/lib/sms-charset';
import type { SiteDemoData } from '../src/core/site-demo/types';

const lead = (over: Partial<SiteDemoData> = {}): SiteDemoData => ({
  businessName: 'MJR Plumbing',
  tradeKey: 'plumber',
  tradeLabel: 'Plumber',
  tradePlural: 'plumbers',
  profileKey: 'plumbing',
  town: 'Wigan',
  phoneDisplay: '07576 558278',
  phoneE164: '+447576558278',
  ...over,
});

const prompt = (over: Partial<SiteDemoData> = {}, checkoutUrl?: string) =>
  buildChatPrompt(fillSiteContent(lead(over)), { checkoutUrl });

describe('the prompt tells it what it knows', () => {
  it('carries every fact from the page', () => {
    const p = prompt();
    expect(p).toContain('MJR Plumbing');
    expect(p).toContain('Plumber');
    expect(p).toContain('Wigan');
    expect(p).toContain('07576 558278');
    expect(p).toContain('Boiler repairs');
  });

  it('includes the Google rating only when we actually have it', () => {
    expect(prompt({ rating: 4.8, reviews: 37, reviewsSource: 'google' })).toContain('Google rating: 4.8');
    expect(prompt({ rating: 4.8, reviews: 37, reviewsSource: 'csv' })).not.toContain('Google rating');
  });

  it('omits a missing town rather than leaving a hole', () => {
    const p = prompt({ town: undefined });
    expect(p).not.toContain('Town:');
    expect(p).not.toContain('undefined');
  });
});

// These are the rules that would be a legal problem, not a copy problem.
describe('the prompt forbids the things it must never invent', () => {
  const p = prompt();
  it.each([
    'Gas Safe', 'NICEIC', 'insurance', 'certifications', 'accreditations',
    'price', 'quote', 'callout fee', 'guarantee', 'response time',
    'years in business', 'team size',
  ])('names %s explicitly', (banned) => {
    expect(p.toLowerCase()).toContain(banned.toLowerCase());
  });

  it('tells it what to do instead of inventing, and points at the phone', () => {
    expect(p).toContain('say so');
    expect(p).toContain('07576 558278');
  });
});

describe('the punctuation rule is stated in as many words', () => {
  // A model copies the punctuation it is shown, and this text can end up in an
  // SMS, where one long dash halves the segment size.
  it('spells the rule out rather than assuming', () => {
    const p = prompt();
    expect(p).toContain('long dash');
    expect(p).toContain('curly quote');
    expect(p).toContain('text message');
  });

  // Escapes, not literals: writing the characters out would put the very
  // things Hugo banned into our own source.
  it('contains no long dash, curly quote or ellipsis itself', () => {
    const BANNED = /[\u2010-\u2015\u2018\u2019\u201C\u201D\u2026]/;
    expect(prompt()).not.toMatch(BANNED);
    expect(prompt({ rating: 4.9, reviews: 12, reviewsSource: 'google' }, 'https://x.test')).not.toMatch(
      BANNED,
    );
  });
});

describe('the close', () => {
  it('is absent until the checkout is armed', () => {
    expect(prompt()).not.toContain('get this set up');
    expect(prompt({}, 'https://heyelsie.com/s/mjr-plumbing')).toContain('https://heyelsie.com/s/mjr-plumbing');
  });

  it('offers the link in copy a lead could be texted', () => {
    const offer = chatCloseOffer('MJR Plumbing', 'https://heyelsie.com/s/mjr-plumbing');
    expect(offer).toContain('MJR Plumbing');
    expect(nonGsm7(offer)).toEqual([]);
  });
});
