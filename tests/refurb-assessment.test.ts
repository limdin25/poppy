// The rule that stops the estimator inventing work.
//
// Hugo, 2026-08-25: "NEVER invent work. If there is no clearly necessary work,
// the result must simply say Nothing to do. Where practical, use multiple AI
// vision analyses to reduce mistakes and unnecessary recommendations. The final
// recommendation should favour the conservative answer: do not include work
// unless there is sufficient evidence that it is required. Every item must
// require agent confirmation, even if the information came directly from the
// listing or AI."
//
// Every one of those sentences is a test in this file, because every one of
// them is a promise about somebody else's money. The merge is deliberately
// arithmetic rather than judgement so that it CAN be pinned like this: a prompt
// can be talked out of a rule, a `filter` cannot.

import { describe, it, expect } from 'vitest';
import {
  parseVisionRead, mergeReads, blankAreas, pricedWorks, worksToConfirm,
  toInspect, verdictOf, confirmedCount, nothingToDo,
  type VisionRead, type AreaAssessment, type ReadArea,
} from '@/features/crm/lib/refurbAssessment';
import { SECTIONS, estimate } from '@/features/crm/lib/refurbCard';
import { readPropertyData, rightmovePropertyId, MAX_PHOTOS } from '../api/lib/rightmove-listing.js';

const area = (id: string, over: Partial<ReadArea> = {}): ReadArea => ({
  id,
  verdict: 'nothing',
  summary: 'Nothing to do.',
  evidence: '',
  basis: 'photo',
  photos: [],
  works: [],
  ...over,
});

/** A read that answers for every part of the property, all clear. */
const allClear = (over: ReadArea[] = []): VisionRead => {
  const byId = new Map(over.map((a) => [a.id, a]));
  return {
    areas: SECTIONS.map((s) => byId.get(s.id) ?? area(s.id)),
    unknowns: [],
  };
};

const confirmAll = (areas: AreaAssessment[]): AreaAssessment[] =>
  areas.map((a) => ({ ...a, confirmed: true }));

describe('reading one AI answer', () => {
  it('keeps a normal answer', () => {
    const r = parseVisionRead(JSON.stringify({
      band: 'cosmetic',
      summary: 'Tired but sound.',
      areas: [area('kitchen', {
        verdict: 'work', summary: 'Units water damaged under the sink.',
        evidence: 'swollen chipboard, door off', basis: 'photo', photos: [3, 4],
        works: [{ key: 'kitchen', detail: 'Rip out and refit.' }],
      })],
      unknowns: ['Whether the boiler fires.'],
    }))!;
    expect(r.areas[0].verdict).toBe('work');
    expect(r.areas[0].works[0].key).toBe('kitchen');
    expect(r.areas[0].photos).toEqual([3, 4]);
    expect(r.band).toBe('cosmetic');
    expect(r.unknowns).toEqual(['Whether the boiler fires.']);
  });

  it('digs the JSON out of a model that wrapped it in prose', () => {
    const r = parseVisionRead('Here you go:\n```json\n{"areas":[{"id":"roof","verdict":"nothing","summary":"Nothing to do."}]}\n```');
    expect(r?.areas[0].id).toBe('roof');
  });

  it('DROPS a job that is not on the rate card instead of guessing a price', () => {
    const r = parseVisionRead(JSON.stringify({
      areas: [area('garden', { verdict: 'work', works: [
        { key: 'swimming_pool', detail: 'Fill it in.' },
        { key: 'garden_tidy', detail: 'Clear the brambles.' },
      ] })],
    }))!;
    expect(r.areas[0].works.map((w) => w.key)).toEqual(['garden_tidy']);
  });

  it('refuses a part of the property that does not exist', () => {
    const r = parseVisionRead(JSON.stringify({
      areas: [area('kitchen'), { ...area('swimming_pool') }],
    }))!;
    expect(r.areas.map((a) => a.id)).toEqual(['kitchen']);
  });

  it('turns "work" with nothing behind it into an inspection, never a price', () => {
    // A reader that has found something it cannot express with a card key has
    // found a reason to look, not a reason to spend.
    const r = parseVisionRead(JSON.stringify({
      areas: [area('front', { verdict: 'work', summary: 'Something odd about the bay.', works: [] })],
    }))!;
    expect(r.areas[0].verdict).toBe('inspect');
  });

  it('returns null on junk rather than an empty answer that looks real', () => {
    expect(parseVisionRead('sorry, I cannot see the images')).toBeNull();
    expect(parseVisionRead('{"areas":[]}')).toBeNull();
  });
});

describe('two readers, and only what both saw becomes money', () => {
  it('prices a job BOTH readers named', () => {
    const a = allClear([area('kitchen', { verdict: 'work', works: [{ key: 'kitchen', detail: 'New kitchen.' }] })]);
    const b = allClear([area('kitchen', { verdict: 'work', works: [{ key: 'kitchen', detail: 'Kitchen out.' }] })]);
    const merged = mergeReads([{ reader: 'one', read: a }, { reader: 'two', read: b }]);
    const kitchen = merged.find((x) => x.id === 'kitchen')!;
    expect(kitchen.aiVerdict).toBe('work');
    expect(kitchen.works[0].status).toBe('agreed');
    expect(kitchen.works[0].include).toBe(true);
  });

  it('REFUSES TO PRICE a job only one reader named', () => {
    // The single most important assertion in this file. One model seeing damp
    // in a photograph is not evidence of damp, it is one model.
    const a = allClear([area('damp', { verdict: 'work', works: [{ key: 'damp_works', detail: 'Tide marks.' }] })]);
    const b = allClear();
    const merged = mergeReads([{ reader: 'one', read: a }, { reader: 'two', read: b }]);
    const damp = merged.find((x) => x.id === 'damp')!;
    expect(damp.aiVerdict).toBe('inspect');
    expect(damp.works[0].status).toBe('suspected');
    expect(damp.works[0].include).toBe(false);
    expect(pricedWorks(confirmAll(merged))).toEqual([]);
  });

  it('says Nothing to do when neither reader found anything', () => {
    const merged = mergeReads([
      { reader: 'one', read: allClear() },
      { reader: 'two', read: allClear() },
    ]);
    expect(merged.every((a) => a.aiVerdict === 'nothing')).toBe(true);
    expect(merged.every((a) => a.summary === 'Nothing to do.')).toBe(true);
    expect(pricedWorks(confirmAll(merged))).toEqual([]);
  });

  it('marks NOTHING as agreed when only one reader answered at all', () => {
    // A fallback to a single reader must not quietly become the confident path.
    const merged = mergeReads([{
      reader: 'one',
      read: allClear([area('kitchen', { verdict: 'work', works: [{ key: 'kitchen', detail: 'New kitchen.' }] })]),
    }]);
    const kitchen = merged.find((x) => x.id === 'kitchen')!;
    expect(kitchen.works[0].status).toBe('suspected');
    expect(kitchen.aiVerdict).toBe('inspect');
  });

  it('flags a part of the property neither reader could judge', () => {
    const a = allClear([area('electrics', { verdict: 'inspect', summary: 'No photo of the fuse board.', basis: 'none' })]);
    const b = allClear([area('electrics', { verdict: 'inspect', summary: 'Not shown.', basis: 'none' })]);
    const merged = mergeReads([{ reader: 'one', read: a }, { reader: 'two', read: b }]);
    const e = merged.find((x) => x.id === 'electrics')!;
    expect(e.aiVerdict).toBe('inspect');
    expect(e.inspect).toBe(true);
    expect(toInspect(confirmAll(merged)).some((x) => x.where === e.label)).toBe(true);
  });

  it('keeps both readers on the record, including where they disagreed', () => {
    const a = allClear([area('roof', { verdict: 'work', summary: 'Slates missing.', works: [{ key: 'roof_full', detail: 'Strip and re-cover.' }] })]);
    const b = allClear([area('roof', { verdict: 'nothing', summary: 'Nothing to do.' })]);
    const roof = mergeReads([{ reader: 'one', read: a }, { reader: 'two', read: b }]).find((x) => x.id === 'roof')!;
    expect(roof.readers.map((r) => r.verdict)).toEqual(['work', 'nothing']);
  });

  it('carries the agent notes, photos and his own added work through a re-read', () => {
    const before: AreaAssessment[] = blankAreas().map((a) => (a.id === 'garden' ? {
      ...a,
      agentNote: 'Full of rubble, I saw it on street view.',
      agentPhotos: ['https://example.test/one.jpg'],
      agentVerdict: 'work',
      works: [{ key: 'garden_tidy', label: 'Garden tidy up', detail: 'Clear it.', status: 'added', include: true, qty: 1, portion: 1 }],
      confirmed: true,
    } : a));
    const after = mergeReads([
      { reader: 'one', read: allClear() },
      { reader: 'two', read: allClear() },
    ], before).find((x) => x.id === 'garden')!;
    expect(after.agentNote).toContain('rubble');
    expect(after.agentPhotos).toEqual(['https://example.test/one.jpg']);
    expect(after.works.find((w) => w.key === 'garden_tidy')?.status).toBe('added');
    // But the confirmation does NOT survive: the readers have just said
    // something new and he has to agree with it again.
    expect(after.confirmed).toBe(false);
  });
});

describe('nothing is priced until a human confirms it', () => {
  const merged = mergeReads([
    { reader: 'one', read: allClear([area('kitchen', { verdict: 'work', works: [{ key: 'kitchen', detail: 'New kitchen.' }] })]) },
    { reader: 'two', read: allClear([area('kitchen', { verdict: 'work', works: [{ key: 'kitchen', detail: 'New kitchen.' }] })]) },
  ]);

  it('prices nothing at all while every part is unconfirmed', () => {
    expect(confirmedCount(merged)).toBe(0);
    expect(pricedWorks(merged)).toEqual([]);
    expect(estimate(pricedWorks(merged)).budget).toBe(0);
  });

  it('prices it once he confirms that one part, and nothing else', () => {
    const confirmed = merged.map((a) => (a.id === 'kitchen' ? { ...a, confirmed: true } : a));
    const works = pricedWorks(confirmed);
    expect(works.map((w) => w.key)).toEqual(['kitchen']);
    expect(estimate(works).budget).toBe(1600 + Math.round(2400 * 0.65));
  });

  it('prices nothing out of a part he marked Nothing to do, whatever the AI said', () => {
    const overruled = merged.map((a) => (a.id === 'kitchen'
      ? { ...a, confirmed: true, agentVerdict: 'nothing' as const } : a));
    expect(verdictOf(overruled.find((a) => a.id === 'kitchen')!)).toBe('nothing');
    expect(pricedWorks(overruled)).toEqual([]);
    expect(nothingToDo(overruled).map((a) => a.id)).toEqual(['kitchen']);
  });

  it('drops an unticked line out of the price and onto the builder to confirm', () => {
    const unticked = merged.map((a) => (a.id === 'kitchen' ? {
      ...a, confirmed: true, works: a.works.map((w) => ({ ...w, include: false })),
    } : a));
    expect(pricedWorks(unticked)).toEqual([]);
    expect(worksToConfirm(unticked).map((w) => w.label)).toEqual(['New kitchen']);
  });

  it('never sends an unconfirmed part to the builder either', () => {
    const suspect = mergeReads([
      { reader: 'one', read: allClear([area('damp', { verdict: 'work', works: [{ key: 'damp_works', detail: 'Tide marks.' }] })]) },
      { reader: 'two', read: allClear() },
    ]);
    expect(worksToConfirm(suspect)).toEqual([]);
    expect(toInspect(suspect)).toEqual([]);
  });
});

describe('reading a Rightmove listing', () => {
  it('picks the property id out of a listing URL and refuses anything else', () => {
    expect(rightmovePropertyId('https://www.rightmove.co.uk/properties/175055753')).toBe('175055753');
    expect(rightmovePropertyId('https://www.rightmove.co.uk/properties/175055753#/?channel=RES_BUY')).toBe('175055753');
    expect(rightmovePropertyId('https://www.zoopla.co.uk/for-sale/details/123')).toBeNull();
    expect(rightmovePropertyId(null)).toBeNull();
  });

  it('takes the middle-sized photo, not the full size one', () => {
    // A 4000px photograph is roughly 1,500 tokens and shows a damp patch no
    // better than a 656px one does. Twenty four of them is the difference
    // between pennies and pounds on a house nobody may even buy.
    const l = readPropertyData({
      id: 1,
      images: [{
        url: 'https://media.rightmove.co.uk/big.jpeg',
        caption: null,
        resizedImageUrls: { size656x437: 'https://media.rightmove.co.uk/mid.jpeg' },
      }],
    }, 'https://www.rightmove.co.uk/properties/1');
    expect(l.photos[0].thumb).toBe('https://media.rightmove.co.uk/mid.jpeg');
    expect(l.photos[0].url).toBe('https://media.rightmove.co.uk/big.jpeg');
  });

  it('caps how many photographs it will ever hand a model', () => {
    const l = readPropertyData({
      images: Array.from({ length: 60 }, (_, i) => ({ url: `https://media.rightmove.co.uk/${i}.jpeg` })),
    }, 'u');
    expect(l.photos.length).toBe(MAX_PHOTOS);
  });

  it('reads the size in square metres and leaves the other units alone', () => {
    const l = readPropertyData({
      sizings: [
        { unit: 'sqft', minimumSize: 818, maximumSize: 818 },
        { unit: 'sqm', minimumSize: 76, maximumSize: 76 },
        { unit: 'ac', minimumSize: 0.02, maximumSize: 0.02 },
      ],
    }, 'u');
    expect(l.floorAreaSqm).toBe(76);
  });

  it('strips the tags and the entities out of the agent blurb', () => {
    const l = readPropertyData({
      text: { description: '<p>Two bed <strong>terrace</strong> &amp; forecourt.</p><p>No chain.</p>' },
    }, 'u');
    expect(l.description).toBe('Two bed terrace & forecourt.\n\nNo chain.');
    expect(l.description).not.toContain('<');
  });

  it('never writes a long dash into anything the builder will read', () => {
    // House rule, and this text ends up quoted into the builder message.
    const l = readPropertyData({
      keyFeatures: ['No Forward Chain!', 'Two Double Bedrooms'],
      text: { description: '<p>Sound but tired.</p>' },
    }, 'u');
    expect(`${l.keyFeatures.join(' ')} ${l.description}`).not.toMatch(/[—–…]/);
  });
});
