import { describe, it, expect } from 'vitest';
import { renderSite, esc, ICONS, iconFor, type RenderOptions } from '../src/core/site-demo/render';
import { TRADE_COPY } from '../src/core/site-demo/trade-services';
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
  it('gives every service its own card and its own icon', () => {
    const h = html();
    expect(h.match(/class="card r"/g) || []).toHaveLength(6);
    // Keyword matched, not positional, so a renamed service keeps a sensible
    // picture. A plumber's first two lines must not share one glyph.
    expect(h).toContain(ICONS.drop);
    expect(h).toContain(ICONS.flame);
    expect(h).toContain(ICONS.shower);
  });

  // Icons are keyword matched, and a sloppy pattern is invisible in the HTML
  // but obvious on the page. Two real ones caught this way: a bare /lock/
  // matched "Blocked drains", and the locksmith's six lines all resolved to
  // the same key.
  it('gives every trade a spread of icons, not one repeated six times', () => {
    for (const [profileKey, copy] of Object.entries(TRADE_COPY)) {
      const used = copy.services.map((s) => iconFor(s));
      const distinct = new Set(used).size;
      expect({ profileKey, distinct, used }).toEqual({
        profileKey,
        distinct: expect.any(Number),
        used,
      });
      expect(distinct, `${profileKey} services share too few icons`).toBeGreaterThanOrEqual(4);
    }
  });

  it('does not read "Blocked drains" as a lock', () => {
    expect(iconFor('Blocked drains')).toBe('waves');
    expect(iconFor('Lock changes and upgrades')).toBe('key');
  });

  // One editable field, two places on the page. Printing it whole in both read
  // as padding, so the hero takes the opening sentence and the contact block
  // takes the rest. Neither may go missing.
  it('splits the about paragraph instead of printing it twice', () => {
    const c = fillSiteContent(lead());
    // Body only. The meta description and the og:description legitimately
    // carry the same opening sentence, and they are not visible copy.
    const body = html().slice(html().indexOf('<body>'));
    const first = c.about.split(/(?<=\.)\s+/)[0];
    expect(body.split(esc(first)).length - 1).toBe(1);
    expect(body).toContain(esc('No call centre, no waiting on hold.'));
  });

  it('promotes the three true facts onto cards rather than burying them', () => {
    const h = html();
    expect(h.match(/class="fact r"/g) || []).toHaveLength(3);
    expect(h).toContain('Covering Wigan and the surrounding area');
    expect(h).toContain('Where we work');
  });

  it('offers the phone in every place a thumb might land', () => {
    const h = html();
    expect(h).toContain('class="headcall"'); // sticky header, wide screens
    expect(h).toContain('class="callbar"'); // fixed bar, phones
    expect(h).toContain('class="btn btn-call"'); // hero and the colour band
    expect(h.match(/href="tel:\+447576558278"/g)!.length).toBeGreaterThanOrEqual(6);
  });

  // The whole point of the redesign. If the page has no depth left it has
  // drifted back to a text document on a white background.
  it('carries the depth that stands in for photography we do not have', () => {
    const style = html().slice(html().indexOf('<style>'), html().indexOf('</style>'));
    expect(style).toContain('radial-gradient');
    expect(style).toContain('box-shadow');
    expect(style).toContain('border-radius');
  });
});

// The generated page states a town and nothing more precise. The address block
// belongs to the owner and appears only once he has typed one in, because the
// only address we hold pre-sale is the Companies House registered office, very
// often an accountant's in another county. It shipped once as "Brentwood,
// Essex" under "Where we are" on a Middlesbrough plumber's page.
describe('never states a place we cannot stand behind', () => {
  it('shows no address block at all on a freshly generated page', () => {
    const h = html();
    expect(h).not.toContain('Where we are');
  });

  it('shows the address once the owner has set one in the editor', () => {
    const h = html(lead({ address: '12 Mill Lane, Wigan, WN1 1AA' }));
    expect(h).toContain('Where we are');
    expect(h).toContain('12 Mill Lane, Wigan, WN1 1AA');
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
    const hidden = style.match(/^\s*\.r\b[^{]*\{[^}]*opacity:0/gm) || [];
    expect(hidden).toHaveLength(0);
    expect(style).toContain('.js .r{opacity:0');
  });

  it('honours prefers-reduced-motion', () => {
    expect(html()).toContain('prefers-reduced-motion:reduce');
  });

  // Regression: the previous design clipped the very element the observer was
  // watching, and Chromium counts an element's own clip-path when deciding
  // whether it intersects. The band never intersected, never got .in, and
  // shipped as a blank white gap on a real lead's page. Reveals are opacity
  // and transform only now, which cannot reproduce it, and nothing may
  // reintroduce a clip on an observed node.
  it('never clips the element the observer is watching', () => {
    const h = html();
    const style = h.slice(h.indexOf('<style>'), h.indexOf('</style>'));
    expect(style).not.toMatch(/\.js \.r[.\s{][^}]*clip-path/);
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
