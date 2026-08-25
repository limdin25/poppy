// The refurb estimator's maths, and the pin that stops the rate card drifting.
//
// THE POINT OF THE FIRST BLOCK. src/features/crm/lib/refurbCard.ts mirrors
// RATE_CARD in /root/scraper/refurb_model.py on the margarita engine. Two copies
// of one price list is exactly how a screen quietly starts disagreeing with the
// offer engine, and a refurb figure that disagrees with the ballpark is a bad
// offer wearing a confident number. So every mirrored figure is asserted here
// against the engine's value. If somebody edits refurb_model.py, this test is
// what tells them the CRM still has the old number.
//
// Verified against the engine 2026-08-25 by reading refurb_model.py directly.

import { describe, it, expect } from 'vitest';
import {
  CARD, LABOUR_FACTOR, BASELINE_SQM, areaScale, cardVocabulary,
  estimate, builderBrief, parseReadResult, SECTIONS, composeTranscript,
  missingSections, type WorkItem,
} from '@/features/crm/lib/refurbCard';

/** RATE_CARD in refurb_model.py, materials and trade labour, verbatim. */
const ENGINE_CARD: Record<string, [number, number]> = {
  full_strip_out: [300, 1200],
  flooring_carpets: [1100, 600],
  replaster: [700, 2800],
  boxing_stud: [900, 3100],
  rewire: [900, 2100],
  kitchen: [1600, 2400],
  bathroom: [1100, 1400],
  internal_doors: [250, 250],
  front_door: [500, 300],
  boiler: [1200, 800],
  garden_tidy: [100, 300],
  guttering_paint: [20, 80],
  decorate: [400, 1200],
  skim_patch: [350, 1400],
  waste_skips: [400, 200],
};

const item = (key: string, extra: Partial<WorkItem> = {}): WorkItem =>
  ({ key, where: '', detail: '', confidence: 'seen', ...extra });

describe('the rate card still matches the engine', () => {
  it('carries every engine line at the engine price', () => {
    for (const [key, [materials, labour]] of Object.entries(ENGINE_CARD)) {
      const line = CARD[key];
      expect(line, `${key} is missing from the CRM card`).toBeTruthy();
      expect(line.materials, `${key} materials`).toBe(materials);
      expect(line.labour, `${key} labour`).toBe(labour);
      expect(line.source, `${key} should be an engine line`).toBe('engine');
    }
  });

  it('keeps the crew labour dial and the terrace baseline', () => {
    expect(LABOUR_FACTOR).toBe(0.65);
    expect(BASELINE_SQM).toBe(88);
  });

  it('marks roof, windows, damp and heating as off card', () => {
    // The engine's UNPRICEABLE_WORKS. These must never claim to be engine
    // lines, or an estimate containing one looks like it passed the ballpark.
    for (const key of ['roof_full', 'windows_full', 'damp_works', 'heating_full']) {
      expect(CARD[key].source, `${key} must be flagged off card`).toBe('course');
    }
  });

  it('follows the course rule on what a surveyor can see', () => {
    // "Rewires are the worst, because they're hidden it doesn't influence the
    // surveyor's mind." Kitchens and bathrooms do move a valuation.
    expect(CARD.rewire.movesValuation).toBe(false);
    expect(CARD.boiler.movesValuation).toBe(false);
    expect(CARD.kitchen.movesValuation).toBe(true);
    expect(CARD.bathroom.movesValuation).toBe(true);
  });

  it('stays inside the published guide range on the lines that have one', () => {
    // Hugo asked for this cross-check against the price list from the
    // findpropertywithai lesson. Three lines sit outside it on purpose and are
    // named here so a future edit has to argue with them rather than drift.
    const KNOWN_OUTLIERS = new Set(['replaster', 'skim_patch', 'waste_skips', 'garden_tidy']);
    for (const line of Object.values(CARD)) {
      if (line.source !== 'engine' || line.guideLow == null || line.guideHigh == null) continue;
      if (KNOWN_OUTLIERS.has(line.key)) continue;
      const trade = line.materials + line.labour;
      expect(trade, `${line.key} trade total is outside the published guide range`)
        .toBeGreaterThanOrEqual(line.guideLow);
      expect(trade, `${line.key} trade total is outside the published guide range`)
        .toBeLessThanOrEqual(line.guideHigh);
    }
  });
});

describe('the vocabulary the reader is given', () => {
  it('is generated from the card, so no line can be priceable but invisible', () => {
    const vocab = cardVocabulary();
    for (const key of Object.keys(CARD)) {
      expect(vocab, `${key} is missing from the model's vocabulary`).toContain(key);
    }
  });
});

describe('the checklist of property parts', () => {
  // Hugo's whole reason for one box per part: "so he doesn't forget to look at
  // anything on the property." These assertions are that promise.

  it('covers the parts Hugo named out loud', () => {
    const ids = SECTIONS.map((s) => s.id);
    for (const want of ['bathroom', 'bedrooms', 'roof', 'garden', 'front']) {
      expect(ids, `${want} is missing from the checklist`).toContain(want);
    }
  });

  it('covers the parts nobody remembers to look at on their own', () => {
    // The reason a checklist beats one empty box: these are what get forgotten.
    const ids = SECTIONS.map((s) => s.id);
    for (const want of ['electrics', 'heating', 'damp', 'gutters', 'contents']) {
      expect(ids, `${want} is missing from the checklist`).toContain(want);
    }
  });

  it('tells him what to look for in every single part', () => {
    // "Describe the roof" is not a question a non-builder can answer.
    for (const s of SECTIONS) {
      expect(s.look.length, `${s.id} has no guidance`).toBeGreaterThan(30);
    }
  });

  it('has no duplicate parts', () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
  });

  it('names every part he has not looked at yet', () => {
    const answers = SECTIONS.map((s) => ({ id: s.id, text: s.id === 'kitchen' ? 'Old and tired.' : '' }));
    const missing = missingSections(answers);
    expect(missing).toHaveLength(SECTIONS.length - 1);
    expect(missing.map((s) => s.id)).not.toContain('kitchen');
  });

  it('does not count a box with a stray character in it as done', () => {
    expect(missingSections([{ id: 'roof', text: ' a ' }]).map((s) => s.id)).toContain('roof');
  });
});

describe('stitching the boxes together for the reader', () => {
  it('labels each part so the reader knows where each job is', () => {
    const t = composeTranscript([
      { id: 'bathroom', text: 'Black mould above the bath, no fan.' },
      { id: 'roof', text: 'Two slates missing.' },
    ]);
    expect(t).toContain('BATHROOM:');
    expect(t).toContain('THE ROOF:');
    expect(t).toContain('Black mould above the bath');
  });

  it('keeps the parts in walking order, not the order he filled them in', () => {
    const t = composeTranscript([
      { id: 'contents', text: 'Full of bin bags.' },
      { id: 'front', text: 'Brickwork fine.' },
    ]);
    expect(t.indexOf('FRONT OF THE HOUSE')).toBeLessThan(t.indexOf('WHAT IS LEFT INSIDE'));
  });

  it('leaves empty boxes out entirely rather than sending blank headings', () => {
    const t = composeTranscript([
      { id: 'roof', text: 'Looks fine.' },
      { id: 'garden', text: '   ' },
    ]);
    expect(t).not.toContain('GARDEN');
  });
});

describe('the gate between the model and the money', () => {
  // This is the piece that cannot be exercised without a live model call, so it
  // is the piece most worth testing here. Everything the reader says is either
  // recognised and kept, or dropped. Nothing is ever approximated.

  it('reads a normal answer', () => {
    const r = parseReadResult(JSON.stringify({
      band: 'modernisation',
      summary: 'Tired but sound.',
      items: [{ key: 'kitchen', where: 'The kitchen', detail: 'Rip it out.', confidence: 'seen', heard: 'orange pine' }],
      unknowns: ['Whether the boiler works.'],
    }));
    expect(r?.items).toHaveLength(1);
    expect(r?.band).toBe('modernisation');
    expect(r?.unknowns).toEqual(['Whether the boiler works.']);
  });

  it('digs the JSON out of a model that wrapped it in prose or fences', () => {
    const r = parseReadResult('Sure, here you go:\n```json\n{"items":[{"key":"bathroom"}],"unknowns":[]}\n```');
    expect(r?.items[0].key).toBe('bathroom');
  });

  it('DROPS a job that is not on the card instead of guessing a price', () => {
    const r = parseReadResult(JSON.stringify({
      items: [{ key: 'swimming_pool' }, { key: 'loft_conversion' }, { key: 'kitchen' }],
      unknowns: [],
    }));
    expect(r?.items.map((i) => i.key)).toEqual(['kitchen']);
  });

  it('refuses a band it does not recognise rather than passing it on', () => {
    expect(parseReadResult(JSON.stringify({ band: 'lovely', items: [], unknowns: [] }))?.band)
      .toBeUndefined();
  });

  it('never lets a made-up quantity through as a silent multiplier', () => {
    const r = parseReadResult(JSON.stringify({
      items: [
        { key: 'bathroom', qty: -4 },
        { key: 'kitchen', qty: 'lots' },
        { key: 'decorate', portion: 0 },
      ],
      unknowns: [],
    }));
    for (const i of r!.items) {
      expect(i.qty).toBe(1);
      expect(i.portion).toBe(1);
    }
    // And the clamp downstream holds even against an absurd number that IS
    // a valid one: six bathrooms is the ceiling, sixty is not a house.
    const wild = estimate([{ key: 'bathroom', where: '', detail: '', qty: 60 }]);
    expect(wild.lines[0].units).toBe(6);
  });

  it('treats an unsure confidence as likely rather than as seen', () => {
    const r = parseReadResult(JSON.stringify({
      items: [{ key: 'rewire', confidence: 'definitely mate' }], unknowns: [],
    }));
    expect(r?.items[0].confidence).toBe('likely');
  });

  it('returns null on junk instead of an empty estimate that looks real', () => {
    // The distinction matters: null makes the route retry and then tell Pedro
    // it failed. An empty result would show him a confident zero.
    expect(parseReadResult('the model was having a bad day')).toBeNull();
    expect(parseReadResult('')).toBeNull();
  });
});

describe('area scaling', () => {
  it('prices a missing area as a normal terrace and says so', () => {
    const { scale, note } = areaScale(null);
    expect(scale).toBe(1);
    expect(note).toContain('88');
  });

  it('scales a real area against the terrace baseline', () => {
    expect(areaScale(132).scale).toBeCloseTo(1.5, 5);
  });

  it('refuses an implausible area rather than believing it', () => {
    // refurb_model's own lesson: 400 sqm under GBP 150k is a parse failure,
    // not a mansion. It must fall back, never scale by 4.5.
    const { scale, note } = areaScale(400);
    expect(scale).toBe(1);
    expect(note).toContain('not believable');
  });
});

describe('the money', () => {
  it('prices an empty read at zero rather than guessing', () => {
    const r = estimate([]);
    expect(r.budget).toBe(0);
    expect(r.lines).toHaveLength(0);
    expect(r.warnings.join(' ')).toContain('Nothing was priced');
  });

  it('THROWS AWAY a line the model invented instead of approximating it', () => {
    // The gate the whole design rests on. A model that says "swimming_pool"
    // must produce nothing, never the nearest line by name.
    const r = estimate([item('swimming_pool'), item('kitchen')]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].key).toBe('kitchen');
  });

  it('always puts budget below medium, and medium below premium', () => {
    const r = estimate([item('kitchen'), item('bathroom'), item('decorate')]);
    expect(r.budget).toBeLessThan(r.medium);
    expect(r.medium).toBeLessThanOrEqual(r.premium);
  });

  it('prices the kitchen at exactly the engine number', () => {
    const r = estimate([item('kitchen')]);
    expect(r.lines[0].medium).toBe(4000);                       // engine trade total
    expect(r.lines[0].budget).toBe(1600 + Math.round(2400 * 0.65));
  });

  it('adds no contingency, because the deal maths adds its own', () => {
    // refurb_model.py: compounding two 5 percents is how a budget quietly
    // grows by a tenth. The line total must be the card, never x1.05.
    expect(estimate([item('boiler')]).lines[0].medium).toBe(2000);
  });

  it('charges two bathrooms twice and one whole-house decorate once', () => {
    const two = estimate([item('bathroom', { qty: 2 })]);
    expect(two.lines[0].medium).toBe(2500 * 2);
    // Whole-house lines merge on the larger portion rather than adding up, so a
    // model naming the decorating in three rooms cannot buy three decorators.
    const thrice = estimate([
      item('decorate', { portion: 1 }), item('decorate', { portion: 1 }), item('decorate', { portion: 1 }),
    ]);
    expect(thrice.lines).toHaveLength(1);
    expect(thrice.lines[0].medium).toBe(400 + 1200);
  });

  it('never charges less than a third of a whole-house line', () => {
    // One room's worth of plastering still brings a plasterer out, sets him up
    // and pays him for the day. A 5% replaster is a number no builder knows.
    const r = estimate([item('replaster', { portion: 0.05 })]);
    expect(r.lines[0].units).toBeCloseTo(0.35, 5);
  });

  it('scales the area-scaled lines and leaves the fixed ones alone', () => {
    const big = estimate([item('decorate'), item('kitchen')], { floorAreaSqm: 132 });
    expect(big.lines.find((l) => l.key === 'decorate')!.medium).toBe(Math.round(1600 * 1.5));
    expect(big.lines.find((l) => l.key === 'kitchen')!.medium).toBe(4000);   // a kitchen is a kitchen
  });

  it('warns when a job rips things out with no skips on it', () => {
    // Straight out of the lesson this was built from: a builder forgot rubbish
    // clearance on a quote and the investor paid for it twice.
    const r = estimate([item('kitchen'), item('bathroom')]);
    expect(r.warnings.join(' ')).toContain('skips');
  });

  it('catches paying twice for the same wall', () => {
    const r = estimate([item('replaster'), item('skim_patch')]);
    expect(r.warnings.join(' ')).toContain('twice for the same wall');
  });

  it('says out loud when the estimate holds work the offer engine refuses', () => {
    const r = estimate([item('roof_full'), item('kitchen')]);
    expect(r.offCard.some((l) => l.key === 'roof_full')).toBe(true);
    expect(r.offCardBudget).toBeGreaterThan(0);
    expect(r.warnings.join(' ')).toContain('refuses to price');
  });

  it('flags a job that is mostly invisible to a surveyor', () => {
    const r = estimate([item('rewire'), item('heating_full')]);
    expect(r.invisibleShare).toBeGreaterThan(0.35);
    expect(r.warnings.join(' ')).toContain('surveyor cannot see');
  });

  it('surfaces the lines the reader only guessed at', () => {
    const r = estimate([item('rewire', { confidence: 'guess' }), item('kitchen')]);
    expect(r.warnings.join(' ')).toContain('guess');
  });
});

describe('the builder message', () => {
  const lines = estimate([
    item('kitchen', { detail: 'Rip out and fit a new kitchen.' }),
    item('waste_skips', { detail: 'Two skips and the labour to fill them.' }),
    item('decorate', { detail: 'Paint throughout.' }),
    item('full_strip_out', { detail: 'Strip the house back.' }),
  ]).lines;

  it('lists the work in the order a builder actually does it', () => {
    const msg = builderBrief(lines, { address: '14 Test Road' });
    // Strip out before decorating, always. A quote in this order is a quote
    // somebody thought about.
    expect(msg.indexOf('Strip the house out')).toBeLessThan(msg.indexOf('Paint throughout'));
  });

  it('anchors him at our figure by default, and says materials are in', () => {
    const msg = builderBrief(lines, { address: '14 Test Road', includeBudget: true, budget: 9500 });
    expect(msg).toContain('£9,500');
    expect(msg).toContain('materials included');
  });

  it('keeps our figure off it when the switch is turned off', () => {
    const msg = builderBrief(lines, { address: '14 Test Road', includeBudget: false });
    expect(msg).not.toMatch(/£/);
  });

  it('asks for a price per item, which is the whole point of sending it', () => {
    expect(builderBrief(lines, { address: '14 Test Road' })).toContain('item by item');
  });

  it('tells the builder what the photos could not show', () => {
    const msg = builderBrief(lines, {
      address: '14 Test Road',
      unknowns: ['Whether the boiler actually works.'],
    });
    expect(msg).toContain('Whether the boiler actually works.');
  });

  it('never writes a long dash anywhere it can be sent', () => {
    // House rule, and on SMS one long dash drops the segment from 160 to 70.
    const all = builderBrief(lines, { address: '14 Test Road', includeBudget: true, budget: 9500 })
      + cardVocabulary()
      + Object.values(CARD).map((l) => l.label + l.when).join('');
    expect(all).not.toMatch(/[—–…‘’“”]/);
  });
});
