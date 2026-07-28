import { describe, it, expect } from 'vitest';
import { renderSite, esc, type RenderOptions } from '../src/core/site-demo/render';
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

const opts = (over: Partial<RenderOptions> = {}): RenderOptions => ({
  slug: 'mjr-plumbing',
  pageId: '11111111-2222-3333-4444-555555555555',
  beaconToken: 'abc123',
  canonicalUrl: 'https://heyelsie.com/s/mjr-plumbing',
  chatEnabled: true,
  ...over,
});

const html = (l = lead(), o = opts()) => renderSite(fillSiteContent(l), o);

describe('the document', () => {
  it('is a complete standalone page', () => {
    const h = html();
    expect(h.startsWith('<!doctype html>')).toBe(true);
    expect(h).toContain('</html>');
    expect(h).toContain('<meta name="viewport"');
  });

  it('carries real OG tags, because the SMS preview is the first impression', () => {
    const h = html();
    expect(h).toContain('<meta property="og:title" content="MJR Plumbing | Plumber in Wigan"');
    expect(h).toContain('<meta property="og:url" content="https://heyelsie.com/s/mjr-plumbing"');
    expect(h).toContain('<title>MJR Plumbing | Plumber in Wigan</title>');
  });

  it('stays out of search results', () => {
    expect(html()).toContain('content="noindex,nofollow"');
  });

  // Self-contained is a hard rule: every external host is a round trip on
  // mobile data and a privacy leak on a lead's page.
  it('makes no external requests of any kind', () => {
    const h = html();
    expect(h).not.toMatch(/https?:\/\/(?!heyelsie\.com)/);
    expect(h).not.toContain('fonts.googleapis');
    expect(h).not.toContain('cdn.');
    expect(h).not.toContain('<link rel="stylesheet"');
  });

  it('inlines its styles and its script', () => {
    const h = html();
    expect(h).toContain('<style>');
    expect(h).not.toMatch(/<script[^>]+src=/);
  });
});

describe('the composition survives', () => {
  it('renders the three pillow bands, which is the one thing it cannot lose', () => {
    const h = html();
    expect(h.match(/class="pillow"/g) || []).toHaveLength(3);
  });

  it('renders services as a numbered index, not as cards', () => {
    const h = html();
    expect(h).toContain('class="index"');
    expect(h).toContain('<span class="n">01</span>');
    expect(h).not.toContain('class="card"');
  });

  it('offers the phone in every place a thumb might land', () => {
    const h = html();
    expect(h).toContain('class="callslab"');
    expect(h).toContain('class="callbar"');
    expect(h.match(/href="tel:\+447576558278"/g)!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('proof is structural, not cosmetic', () => {
  it('renders the rating when Google gave it to us', () => {
    const h = html(lead({ rating: 4.8, reviews: 37, reviewsSource: 'google' }));
    expect(h).toContain('class="proof"');
    expect(h).toContain('4.8');
    expect(h).toContain('37 Google reviews');
  });

  it('deletes the whole section rather than inventing anything', () => {
    const h = html(lead({ rating: 4.8, reviews: 37, reviewsSource: 'csv' }));
    expect(h).not.toContain('class="proof"');
    expect(h).not.toContain('Google reviews');
  });
});

describe('safety', () => {
  it('escapes a hostile business name instead of executing it', () => {
    const h = html(lead({ businessName: '<script>alert(1)</script>' }));
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).toContain('&lt;script&gt;');
  });

  it('escapes quotes so an attribute cannot be broken out of', () => {
    const h = html(lead({ businessName: 'Ace" onload="x' }));
    expect(h).not.toContain('" onload="x');
  });

  it('esc handles the ampersand exactly once', () => {
    expect(esc('Cooke & Sons')).toBe('Cooke &amp; Sons');
  });
});

describe('tracking', () => {
  it('carries the beacon token for a real visitor', () => {
    expect(html()).toContain('"abc123"');
  });

  // Our own previews must never burn a lead's first touch.
  it('sends nothing at all on a staff view', () => {
    const h = html(lead(), opts({ staff: true, beaconToken: '' }));
    expect(h).toContain('Internal preview');
    expect(h).toContain('STAFF=true');
  });
});

describe('motion never costs a lead the page', () => {
  // If the script fails, a start state left in the stylesheet would serve a
  // blank page to a real prospect. Start states must be behind the .js class.
  it('keeps every start state behind the js class', () => {
    const h = html();
    const style = h.slice(h.indexOf('<style>'), h.indexOf('</style>'));
    const hidden = style.match(/^\s*\.(r|rule|pillow|row)\b[^{]*\{[^}]*opacity:0/gm) || [];
    expect(hidden).toHaveLength(0);
    expect(style).toContain('.js .r{opacity:0');
  });

  it('honours prefers-reduced-motion', () => {
    expect(html()).toContain('prefers-reduced-motion:reduce');
  });

  // Regression, and a nasty one: Chromium's IntersectionObserver accounts for
  // an element's own clip-path. Clipping the OBSERVED element to zero area
  // means it never reports as intersecting, so it never gets .in and stays
  // invisible forever. The band rendered as a blank white gap on a real page.
  // The clip must therefore live on an inner element.
  it('never clips the element the observer is watching', () => {
    const h = html();
    const style = h.slice(h.indexOf('<style>'), h.indexOf('</style>'));
    expect(h).toContain('<section class="pillow"><div class="plane">');
    expect(style).toContain('.js .pillow .plane{clip-path:inset(100% 0 0 0)}');
    // the bare selector would re-introduce the bug
    expect(style).not.toMatch(/\.js \.pillow\{[^}]*clip-path/);
  });
});

describe('optional features', () => {
  it('omits the chat launcher when chat is off', () => {
    expect(html(lead(), opts({ chatEnabled: false }))).not.toContain('id="chatbtn"');
  });

  it('omits the close when checkout is not armed', () => {
    expect(html()).not.toContain('id="getstarted"');
    expect(html(lead(), opts({ checkoutEnabled: true }))).toContain('id="getstarted"');
  });
});

// Hugo's standing rule. This page's copy can be quoted back into an SMS, and
// one long dash drops a segment from 160 characters to 70.
describe('no long dashes', () => {
  it('keeps every piece of generated copy GSM-7 clean', () => {
    const c = fillSiteContent(lead({ rating: 4.8, reviews: 37, reviewsSource: 'google' }));
    const copy = [c.tagline, c.about, c.chatGreeting, c.contactHeading, ...c.bands, ...c.services];
    for (const line of copy) {
      expect({ line, bad: nonGsm7(line) }).toEqual({ line, bad: [] });
    }
  });
});
