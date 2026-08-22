// The fences around the builder conversation.
//
// Every case below is a real failure or a near miss. Lunar Builders asked for
// the full address of a house whose advert has no house number, was not
// answered for 41 hours, and cancelled on the morning of the viewing; that is
// the address block. The invented "12 Welwyn Park Road" in an email to the
// branch selling that exact house is the house-number fence. The rest are the
// things a model will do the first time nobody is watching: agree to a
// different day, name a price, sign off as an assistant.

import { describe, it, expect } from 'vitest';
import {
  addressIsExact, buildFacts, parseBrainVerdict, guardBuilderReply,
  decideForBuilder, addressFromAnswer, addressReply, passthroughReply,
  brainSystemPrompt, CANNED, MAX_BRAIN_REPLIES,
  type BuilderFacts, type BrainVerdict,
} from '../api/lib/builder-brain.js';

const streetOnly: BuilderFacts = {
  builderName: 'PZ Builders',
  address: 'Oxford Gardens, Stafford, ST16',
  addressIsExact: false,
  viewingLabel: 'Wednesday 26 August at 2:30pm',
  propertyLine: '3 bed terraced',
  worksLine: '',
  alreadyConfirmed: false,
};

const exact: BuilderFacts = {
  ...streetOnly,
  builderName: 'Builders in Chorley',
  address: '10, Stevenson Avenue, Farington, Leyland, PR25 4GQ',
  addressIsExact: true,
  viewingLabel: 'Friday 28 August at 2:00pm',
};

const verdict = (over: Partial<BrainVerdict> = {}): BrainVerdict => ({
  intent: 'question', needs: [], confirm: false, reply: 'Yes, no problem.', missing: null, ...over,
});

describe('addressIsExact', () => {
  it('a Rightmove street with a postcode is NOT enough to send a builder to', () => {
    expect(addressIsExact('Oundle Road, Kingstanding, Birmingham B44 8EP')).toBe(false);
    expect(addressIsExact('Oxford Gardens, Stafford, ST16')).toBe(false);
  });

  it('a house number or a named flat is', () => {
    expect(addressIsExact('10, Stevenson Avenue, Farington, Leyland, PR25 4GQ')).toBe(true);
    expect(addressIsExact('12a Welwyn Park Road, Hull')).toBe(true);
    expect(addressIsExact('Flat 2, Rose Court, Leeds')).toBe(true);
  });

  it('nothing at all is not exact', () => {
    expect(addressIsExact('')).toBe(false);
  });
});

describe('the prompt states what we do and do not hold', () => {
  it('forbids inventing a number when we have only the street', () => {
    const p = brainSystemPrompt(streetOnly);
    expect(p).toContain('WE DO NOT HAVE THE HOUSE NUMBER');
    expect(p).toContain('NEVER invent a number');
  });

  it('allows the full address when we have it', () => {
    expect(brainSystemPrompt(exact)).toContain('you may give it in full');
  });

  it('names the booked slot as the only one that may be agreed', () => {
    expect(brainSystemPrompt(exact)).toContain('the only day and time you may agree to');
  });
});

describe('parseBrainVerdict', () => {
  it('reads a plain object', () => {
    const v = parseBrainVerdict('{"intent":"yes","needs":["full_address"],"confirm":true,"missing":null,"reply":"Great"}');
    expect(v.intent).toBe('yes');
    expect(v.needs).toEqual(['full_address']);
    expect(v.confirm).toBe(true);
  });

  it('reads it through a fence and a preamble', () => {
    const v = parseBrainVerdict('Sure!\n```json\n{"intent":"no","needs":[],"confirm":false,"reply":"ok"}\n```');
    expect(v.intent).toBe('no');
    expect(v.reply).toBe('ok');
  });

  it('an unreadable answer is unclear with nothing to send, never a half-parsed message', () => {
    for (const junk of ['', 'I think he means yes', '{broken']) {
      const v = parseBrainVerdict(junk);
      expect(v.intent).toBe('unclear');
      expect(v.reply).toBe('');
      expect(v.confirm).toBe(false);
    }
  });

  it('drops an intent and a need it invented', () => {
    const v = parseBrainVerdict('{"intent":"maybe","needs":["a_pony","full_address"],"reply":"x"}');
    expect(v.intent).toBe('unclear');
    expect(v.needs).toEqual(['full_address']);
  });
});

describe('guardBuilderReply', () => {
  it('takes back a house number nobody gave us', () => {
    const g = guardBuilderReply('See you at 14 Oxford Gardens, Stafford at 2:30.', streetOnly);
    expect(g.text).not.toContain('14 Oxford Gardens');
    expect(g.guards).toContain('invented_house_number');
  });

  it('leaves the real number alone when we hold one', () => {
    const g = guardBuilderReply('See you at 10, Stevenson Avenue on Friday.', exact);
    expect(g.ok).toBe(true);
    expect(g.text).toContain('10, Stevenson Avenue');
  });

  it('refuses any money, in either direction', () => {
    for (const money of [
      'We are looking at about £40,000 of work.',
      'Budget is 40k for the refurb.',
      'We can pay 1,500 for the quote.',
    ]) {
      const g = guardBuilderReply(money, exact);
      expect(g.ok).toBe(false);
      expect(g.guards).toContain('money');
    }
  });

  it('refuses a day that is not the booked day', () => {
    const g = guardBuilderReply('Monday works for us, see you then.', exact);
    expect(g.ok).toBe(false);
    expect(g.guards).toContain('wrong_day');
  });

  it('allows the booked day repeated back', () => {
    const g = guardBuilderReply('See you Friday at 2pm.', exact);
    expect(g.ok).toBe(true);
  });

  it('rewrites the punctuation Hugo banned', () => {
    const g = guardBuilderReply('Thanks — see you Friday, it’s all set.', exact);
    expect(g.text).not.toMatch(/[–—‘’“”…]/);
    expect(g.guards).toContain('punctuation');
  });

  it('refuses a model that admits to being one', () => {
    const g = guardBuilderReply('As an AI I cannot confirm that.', exact);
    expect(g.ok).toBe(false);
  });

  it('an empty reply is not sendable', () => {
    expect(guardBuilderReply('', exact).ok).toBe(false);
  });
});

describe('decideForBuilder', () => {
  it('THE LUNAR BUILDERS CASE: asked for the address we do not have, so we say we are getting it and ask a human', () => {
    const d = decideForBuilder(
      verdict({ intent: 'yes', needs: ['full_address'], confirm: true, reply: CANNED.gettingAddress }),
      streetOnly,
    );
    expect(d.action).toBe('reply_and_ask_ops');
    expect(d.opsKind).toBe('builder_needs_address');
    expect(d.pendingReply).toBe('address');
    expect(d.reply).toMatch(/getting/i);
    expect(d.guards).toContain('address_unknown');
  });

  it('the address ask is answered outright when the number is on the house', () => {
    const d = decideForBuilder(
      verdict({ intent: 'yes', needs: ['full_address'], confirm: true, reply: 'It is 10, Stevenson Avenue, see you Friday.' }),
      exact,
    );
    expect(d.action).toBe('reply_and_confirm');
    expect(d.opsKind).toBeNull();
  });

  it('never agrees to a different day, it asks', () => {
    const d = decideForBuilder(
      verdict({ intent: 'reschedule', reply: 'Tuesday is fine.' }),
      exact,
    );
    expect(d.action).toBe('reply_and_ask_ops');
    expect(d.opsKind).toBe('builder_time_change');
    // The model's "Tuesday is fine" was refused by the guard, so the canned
    // holding line goes instead. This is the whole point of the fence.
    expect(d.reply).toBe(CANNED.checkingTime);
  });

  it('a clear yes books, but only when there is a slot to book', () => {
    expect(decideForBuilder(verdict({ intent: 'yes', confirm: true, reply: 'Yes I can make it.' }), exact).action)
      .toBe('reply_and_confirm');
    expect(decideForBuilder(
      verdict({ intent: 'yes', confirm: true, reply: 'Yes I can make it.' }),
      { ...exact, viewingLabel: '' },
    ).action).not.toBe('reply_and_confirm');
  });

  it('a no is recorded and thanked', () => {
    const d = decideForBuilder(verdict({ intent: 'no', reply: 'Sorry, too busy.' }), exact);
    expect(d.action).toBe('reply_and_close');
  });

  it('the model saying it does not know is passed to a human, with a holding line out', () => {
    const d = decideForBuilder(
      verdict({ intent: 'question', missing: 'whether the roof has been done', reply: CANNED.gettingDetail }),
      exact,
    );
    expect(d.action).toBe('reply_and_ask_ops');
    expect(d.opsKind).toBe('builder_needs_scope');
    expect(d.opsQuestion).toContain('whether the roof has been done');
  });

  it('a reply that cannot be sent at all texts nobody and raises a hand', () => {
    const d = decideForBuilder(verdict({ intent: 'question', reply: 'We can pay £50,000.' }), exact);
    expect(d.action).toBe('ask_ops_only');
    expect(d.reply).toBe('');
    expect(d.guards).toContain('unsafe_reply');
  });

  it('the money fence beats the confirmation', () => {
    const d = decideForBuilder(
      verdict({ intent: 'yes', confirm: true, reply: 'Yes, and we have £30,000 for the works.' }),
      exact,
    );
    expect(d.reply).not.toContain('30,000');
  });
});

describe('an answer coming back from a human', () => {
  it('a bare number is glued onto the street we already hold', () => {
    expect(addressFromAnswer('10', 'Stevenson Avenue, Farington, Leyland, PR25 4GQ'))
      .toBe('10, Stevenson Avenue, Farington, Leyland, PR25 4GQ');
  });

  it('a full address they typed is taken as written', () => {
    expect(addressFromAnswer('10, Stevenson Avenue, Farington, Leyland PR25 4GQ', 'Stevenson Avenue, Farington, Leyland, PR25 4GQ'))
      .toContain('Stevenson Avenue');
  });

  it('words with no number in them are NOT an address', () => {
    expect(addressFromAnswer('I will find out tomorrow', 'Oxford Gardens, Stafford, ST16')).toBeNull();
    expect(addressFromAnswer('', 'Oxford Gardens, Stafford, ST16')).toBeNull();
  });

  it('the message to the builder carries the number and the slot', () => {
    const m = addressReply('10, Stevenson Avenue, Leyland PR25 4GQ', 'Friday 28 August at 2:00pm');
    expect(m).toContain('10, Stevenson Avenue');
    expect(m).toContain('Friday 28 August');
    expect(m).not.toMatch(/[–—‘’“”…]/);
  });

  it('a free-text answer is passed through, not paraphrased', () => {
    expect(passthroughReply('The roof was done in 2019, everything else is original.'))
      .toBe('The roof was done in 2019, everything else is original.');
  });
});

describe('buildFacts', () => {
  it('prefers the address with the house number on it', () => {
    const f = buildFacts(
      {
        id: 'p1',
        address: 'Stevenson Avenue, Farington, Leyland, PR25 4GQ',
        viewing_address: '10, Stevenson Avenue, Farington, Leyland, PR25 4GQ',
        viewing_at: '2026-08-28T13:00:00+00:00',
        bedrooms: 3,
        property_type: 'Terraced',
      },
      'Builders in Chorley',
    );
    expect(f.address).toMatch(/^10, /);
    expect(f.addressIsExact).toBe(true);
    expect(f.viewingLabel).toBe('Friday 28 August at 2:00pm');
    // The column names are brrr_properties' own. Reading `beds` instead of
    // `bedrooms` is what made the first live sweep answer nobody.
    expect(f.propertyLine).toBe('3 bed terraced');
  });

  it('knows when the builder on the house is this one', () => {
    const f = buildFacts(
      { id: 'p1', address: 'X Road, Leeds LS1', assigned_builder_id: 'b1' } as never,
      'Someone', 'b1',
    );
    expect(f.alreadyConfirmed).toBe(true);
  });
});

describe('the back and forth has an end', () => {
  it('stops after a handful of turns rather than looping a builder for ever', () => {
    expect(MAX_BRAIN_REPLIES).toBeGreaterThan(2);
    expect(MAX_BRAIN_REPLIES).toBeLessThanOrEqual(8);
  });
});
