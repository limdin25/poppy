import { describe, it, expect } from 'vitest';
import {
  interpolateScript,
  highlightTokens,
  stripHighlights,
} from '../src/features/crm/lib/interpolateScript';

const contact = {
  name: 'In Goes Plumbing Services',
  customFields: {
    owner_name: 'Lewis Adrian Ingoe',
    reviews: '0',
    rating: '4.8',
    rank: '23',
    town: 'Basingstoke',
    competitor_1: 'Christopher Plumbing Services Ltd',
    competitor_2: 'Catlin Plumbing & Heating',
    plumbers_ahead: '22',
    total_plumbers: '89',
    google_search_url: 'https://www.google.com/maps/search/plumbers+Basingstoke/',
  },
};

describe('interpolateScript', () => {
  it('fills every named token from the contact', () => {
    const tpl = 'Hi, is that [owner_first], from [business_name]? Only [reviews] reviews, ' +
      '[rating] stars, rank [rank] in [town] — past [plumbers_ahead] of [total_plumbers] plumbers.';
    const out = interpolateScript(tpl, contact);
    expect(out).toBe(
      'Hi, is that Lewis, from In Goes Plumbing Services? Only 0 reviews, ' +
      '4.8 stars, rank 23 in Basingstoke — past 22 of 89 plumbers.'
    );
  });

  it('takes only the first word of the owner name', () => {
    expect(interpolateScript('[owner_first]', contact)).toBe('Lewis');
  });

  it('fills reviews = 0 verbatim (0 is a strong pitch, not "missing")', () => {
    expect(interpolateScript('only [reviews] reviews', contact)).toBe('only 0 reviews');
  });

  it('fills the google search href, both text and attribute contexts', () => {
    const tpl = '<a href="[google_search_url]">open</a>';
    expect(interpolateScript(tpl, contact)).toBe(
      '<a href="https://www.google.com/maps/search/plumbers+Basingstoke/">open</a>'
    );
  });

  it('replaces every occurrence of a token, not just the first', () => {
    expect(interpolateScript('[town]/[town]', contact)).toBe('Basingstoke/Basingstoke');
  });

  it('HTML-escapes substituted values so CSV data cannot break markup', () => {
    expect(interpolateScript('rival: [competitor_2]', contact)).toBe(
      'rival: Catlin Plumbing &amp; Heating'
    );
    const evil = { name: 'A<script>x</script>', customFields: {} };
    expect(interpolateScript('[business_name]', evil)).toBe('A&lt;script&gt;x&lt;/script&gt;');
  });

  it('wraps a missing token in a brown .ph slot (obvious it is unfilled)', () => {
    const sparse = { name: '', customFields: { reviews: '5' } };
    expect(interpolateScript('rank [rank], reviews [reviews]', sparse)).toBe(
      'rank <span class="ph">[rank]</span>, reviews 5'
    );
  });

  it('treats empty-string custom fields as missing (brown slot)', () => {
    const sparse = { name: 'Acme', customFields: { town: '   ' } };
    expect(interpolateScript('[town]', sparse)).toBe('<span class="ph">[town]</span>');
  });

  it('falls back the google search url to # when missing', () => {
    const sparse = { name: 'Acme', customFields: {} };
    expect(interpolateScript('<a href="[google_search_url]">x</a>', sparse)).toBe(
      '<a href="#">x</a>'
    );
  });

  it('handles a null contact without throwing (all tokens become brown slots, url → #)', () => {
    const tpl = 'Hi [owner_first] <a href="[google_search_url]">x</a>';
    expect(interpolateScript(tpl, null)).toBe(
      'Hi <span class="ph">[owner_first]</span> <a href="#">x</a>'
    );
  });

  it('does NOT wrap a filled token in a slot (only unfilled slots are brown)', () => {
    expect(interpolateScript('[town]', contact)).toBe('Basingstoke');
  });

  it('no owner name: collapses the opener/sign-off to a business-only phrasing (no raw bracket)', () => {
    const noOwner = { name: 'Ace Locksmiths', customFields: { town: 'Crawley' } };
    expect(interpolateScript('is that [owner_first], from [business_name]?', noOwner)).toBe(
      'is that Ace Locksmiths?'
    );
    expect(interpolateScript("I'll let you get back to it, cheers [owner_first].", noOwner)).toBe(
      "I'll let you get back to it, cheers."
    );
  });

  it('no owner name: an unrelated lone [owner_first] still falls back to a brown slot', () => {
    const noOwner = { name: 'Ace Locksmiths', customFields: {} };
    expect(interpolateScript('ask for [owner_first] directly', noOwner)).toBe(
      'ask for <span class="ph">[owner_first]</span> directly'
    );
  });

  it('owner name present: the collapse rule never fires (byte-identical to before)', () => {
    expect(interpolateScript('is that [owner_first], from [business_name]?', contact)).toBe(
      'is that Lewis, from In Goes Plumbing Services?'
    );
  });

  it('leaves calculator illustration numbers untouched (not brown, not filled)', () => {
    expect(interpolateScript('say [10] a month, [120] a year', contact)).toBe(
      'say [10] a month, [120] a year'
    );
  });
});

describe('highlightTokens / stripHighlights', () => {
  it('wraps known text tokens in a .ph span', () => {
    expect(highlightTokens('Hi [owner_first] in [town]')).toBe(
      'Hi <span class="ph">[owner_first]</span> in <span class="ph">[town]</span>'
    );
  });

  it('is idempotent — running twice does not double-wrap', () => {
    const once = highlightTokens('[reviews]');
    expect(highlightTokens(once)).toBe(once);
    expect(once).toBe('<span class="ph">[reviews]</span>');
  });

  it('never wraps the href token', () => {
    expect(highlightTokens('<a href="[google_search_url]">x</a>')).toBe(
      '<a href="[google_search_url]">x</a>'
    );
  });

  it('does not touch calculator numbers', () => {
    expect(highlightTokens('[10] jobs')).toBe('[10] jobs');
  });

  it('round-trips: strip(highlight(x)) === x', () => {
    const tpl = 'Hi [owner_first], only [reviews] reviews in [town].';
    expect(stripHighlights(highlightTokens(tpl))).toBe(tpl);
  });
});

// Hugo 2026-07-26 (multi-trade): the one-call script says "plumber in [town]…
// a customer scrolls past [plumbers_ahead] other plumbers". For an electrician
// lead the NUMBERS are right (their rank comes from an electricians search) but
// the WORD is wrong. These aliases let script copy match the numbers.
describe('trade-neutral script tokens', () => {
  it('fills [trade] and [trade_plural] from the lead', () => {
    const out = interpolateScript(
      'Right, so "[trade_plural] in [town]" — you sit behind [competitors_ahead] other [trade_plural].',
      { name: 'ALB Electrical Ltd', customFields: { town: 'Winchester', plumbers_ahead: '19', niche: 'electrician' } },
    )
    expect(out).toContain('"electricians in Winchester"')
    expect(out).toContain('behind 19 other electricians')
  })

  it('still reads right for a plumber', () => {
    const out = interpolateScript('[trade_plural] in [town]', {
      name: '24/7 Fast Flow Plumbing Ltd', customFields: { town: 'Birmingham' },
    })
    expect(out).toContain('plumbers in Birmingham')
  })

  it('keeps the legacy tokens working — 9 files still reference them', () => {
    const out = interpolateScript('[plumbers_ahead] of [total_plumbers]', {
      customFields: { plumbers_ahead: '13', total_plumbers: '89' },
    })
    expect(out).toContain('13 of 89')
  })
})

describe('callback tokens: call two opens on the name and the day', () => {
  const branch = { name: 'Jones & Chapman', customFields: {} };

  it('fills [branch_contact_name] and [spoke_when] from extra', () => {
    const out = interpolateScript(
      'Hi [branch_contact_name], we spoke [spoke_when] about the house.',
      branch,
      { branch_contact_name: 'Guy', spoke_when: 'yesterday' },
    );
    expect(out).toBe('Hi Guy, we spoke yesterday about the house.');
  });

  it('no name on file: every greeting collapses instead of a brown bracket', () => {
    const tpl = 'Hi [branch_contact_name], hello. ' +
      'That is great, thanks for your time [branch_contact_name]. ' +
      'Ringing [branch_contact_name] back about the house.';
    const out = interpolateScript(tpl, branch, { spoke_when: 'yesterday' });
    expect(out).toBe('Hi, hello. That is great, thanks for your time. Ringing them back about the house.');
    // An empty string counts as missing, exactly like every other token.
    const out2 = interpolateScript('Hi [branch_contact_name], hello.', branch, { branch_contact_name: '' });
    expect(out2).toBe('Hi, hello.');
  });

  it('no prior call on record: "We spoke about" still reads true', () => {
    const out = interpolateScript(
      'We spoke [spoke_when] about [property_street].',
      branch,
      { property_street: 'Friars Close' },
    );
    expect(out).toBe('We spoke about Friars Close.');
  });

  it('a filled value defeats the collapse, byte for byte', () => {
    const out = interpolateScript(
      'Hi [branch_contact_name], we spoke [spoke_when] about it.',
      branch,
      { branch_contact_name: 'Guy', spoke_when: 'on Friday' },
    );
    expect(out).toBe('Hi Guy, we spoke on Friday about it.');
  });

  it('outside the collapse phrasings, a missing token is still a visible brown slot', () => {
    const out = interpolateScript('Ask for [branch_contact_name] at the desk.', branch);
    expect(out).toBe('Ask for <span class="ph">[branch_contact_name]</span> at the desk.');
  });
});
