// Every way the cockpit is allowed to say no.
//
// Written 2026-08-15 with api/lib/deal-stress-test.ts. Hugo asked that "every
// move is backed by a stress test to ensure zero errors", and a gate is only
// worth having if somebody has proved which things it stops.
//
// THE SHAPE OF THIS FILE. One `it` per BLOCK, because a block is a promise that
// something cannot happen, and every promise gets its own test. The warnings
// get one test between them proving the opposite property: that they never stop
// a human doing their job.
//
// The states are built through the real buildDealState() rather than hand
// written, so a change to the assembler that breaks these assumptions fails
// here rather than silently in production.

import { describe, it, expect } from 'vitest';
import { buildDealState, type DealStateInput } from '../api/lib/deal-state';
import {
  stressTest, stressAll, stressToText, COCKPIT_ACTIONS, ACTION_EXECUTION, ACTION_LABEL,
  type CockpitAction,
} from '../api/lib/deal-stress-test';

const NOW = new Date('2026-08-15T14:00:00Z');

/** A deal that is fine, so each test can break exactly one thing. */
function state(over: Partial<DealStateInput['property']> = {}, rest: Partial<DealStateInput> = {}) {
  const input: DealStateInput = {
    property: {
      id: 'p1',
      address: '12 Welwyn Park Road, Hull, HU6 7QR',
      status: 'new',
      asking_price: 110_000,
      bedrooms: 3,
      deal: {
        offer: { open: 88_000, max: 96_000, ladder: [88_000, 92_000, 96_000] },
        gdv: { estimate: 150_000 },
        tmv: 120_000,
        refurb: { low: 25_000 },
        comps_tier: 'gold',
        cmv: { comps: 4 },
        rent: 750,
      },
      qualification: { rent_estimate: '750' },
      floorplan_urls: ['https://example.com/plan.png'],
      viewing_quote: 24_000,
      updated_at: '2026-08-15T13:00:00Z',
      ...over,
    },
    contact: {
      id: 'c1', name: 'Zest Hull', phone: '+441482251703', email: 'lucy@example.co.uk',
      pipeline_column_id: 'col1', stage_moved_at: '2026-08-14T09:00:00Z',
      last_contact_at: '2026-08-15T12:00:00Z',
    },
    columnName: 'Ready for call 2',
    calls: [{ id: 'k1', created_at: '2026-08-15T09:00:00Z', direction: 'outbound', disposition: 'Discovery done, evaluating', duration_sec: 240 }],
    messages: [],
    followups: [],
    now: NOW,
    ...rest,
  };
  return buildDealState(input);
}

const base = {
  contactEmail: 'lucy@example.co.uk',
  contactPhone: '+441482251703',
  builderMatches: 1,
  now: NOW,
};

const run = (action: CockpitAction, over: Record<string, unknown> = {}) =>
  stressTest({ state: state(), action, ...base, ...over } as Parameters<typeof stressTest>[0]);

// ---------------------------------------------------------------------------
// the blocks
// ---------------------------------------------------------------------------

describe('a figure that is not on the file never reaches a branch', () => {
  it('blocks a draft naming a number the engine has never produced', () => {
    const r = run('draft_offer_email', {
      draft: { subject: 'Our offer', body: 'We can do GBP 105,000 on this one.' },
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toContain('figures_on_file');
    // The reason is printed verbatim next to a disabled button, so it has to
    // read as English rather than as a tag.
    const check = r.checks.find((c) => c.id === 'figures_on_file');
    expect(check?.detail).toContain('105,000');
    expect(check?.detail).not.toMatch(/_/);
  });

  it('passes a draft that only repeats figures off the engine', () => {
    const r = run('draft_offer_email', {
      draft: { subject: 'Our offer', body: 'We can do GBP 88,000 on this one.' },
    });
    expect(r.blocked).not.toContain('figures_on_file');
  });

  it('catches a comma grouped figure with no currency in front of it', () => {
    // The hole that let "They want 105,000, so offer that" through the first
    // time the fence was written: the branch's own number is exactly the kind
    // that must not be repeated back as an instruction.
    const r = run('draft_follow_up_email', {
      draft: { subject: 'Following up', body: 'You mentioned 105,000 last week.' },
    });
    expect(r.blocked).toContain('figures_on_file');
  });
});

describe('our maximum is never put in writing', () => {
  it('blocks a draft that names the ceiling, even though the ceiling IS on file', () => {
    // This is the whole reason this check exists separately. The walk-away is
    // a real figure on the deal, so the figure fence waves it straight through.
    // THE_STRATEGY: "The ceiling is never said out loud."
    const r = run('draft_offer_email', {
      subject: 'Offer', draft: { subject: 'Offer', body: 'We could stretch to GBP 96,000.' },
    });
    expect(r.blocked).toContain('ceiling_not_in_writing');
    expect(r.blocked).not.toContain('figures_on_file');
  });

  it('is happy with a figure below the ceiling', () => {
    // On a card that has actually reached the offer stage: an offer email from
    // Ready for call 2 is blocked by stage_matches_action, and rightly so.
    const s = state({}, { columnName: 'Ballpark agreed' });
    const r = stressTest({
      state: s, action: 'draft_offer_email', ...base,
      draft: { subject: 'Offer', body: 'We can offer GBP 88,000, subject to our builder viewing.' },
    });
    expect(r.ok).toBe(true);
  });
});

describe('call one\'s email can never carry a figure', () => {
  it('blocks any number at all, ours or theirs or the asking price', () => {
    for (const body of [
      'Thanks for your time. We would look at around GBP 88,000.',
      'You mentioned the asking is 110,000.',
    ]) {
      const r = run('draft_video_email', { draft: { subject: 'Following our call', body } });
      expect(r.blocked).toContain('call_one_carries_no_figure');
    }
  });

  it('applies to the address only email too, which sits inside the same guard', () => {
    const r = run('draft_address_only_email', {
      draft: { subject: 'My details', body: 'Anything around GBP 88,000 works for us.' },
    });
    expect(r.blocked).toContain('call_one_carries_no_figure');
  });

  it('passes the real template, which names nothing', () => {
    const r = run('draft_video_email', {
      draft: {
        subject: 'My details, as promised',
        body: 'Thanks for your time this morning. Anything that needs plenty of work, send it straight to me.',
      },
    });
    expect(r.ok).toBe(true);
  });
});

describe('a send needs somewhere to send it and something to say', () => {
  it('blocks an email with no address on the branch', () => {
    const r = run('send_email', {
      contactEmail: '', draft: { subject: 'Hello', body: 'Hello' },
    });
    expect(r.blocked).toContain('has_email');
  });

  it('blocks an email with no subject', () => {
    const r = run('send_email', { draft: { subject: '   ', body: 'Hello' } });
    expect(r.blocked).toContain('subject_present');
  });

  it('blocks a call with no number on the branch', () => {
    const r = run('call_branch', { contactPhone: '' });
    expect(r.blocked).toContain('has_phone');
  });
});

describe('a bad engine row must not reach a branch', () => {
  it('blocks an offer email when there is no opener', () => {
    const s = state({ deal: { offer: { max: 96_000 }, comps_tier: 'gold' } });
    const r = stressTest({ state: s, action: 'draft_offer_email', ...base });
    expect(r.blocked).toContain('offer_on_file');
  });

  it('blocks an offer email when there is no maximum', () => {
    const s = state({ deal: { offer: { open: 88_000 }, comps_tier: 'gold' } });
    const r = stressTest({ state: s, action: 'draft_offer_email', ...base });
    expect(r.blocked).toContain('ceiling_on_file');
  });

  it('blocks an opener that is above our own maximum', () => {
    const s = state({ deal: { offer: { open: 99_000, max: 96_000 }, comps_tier: 'gold' } });
    const r = stressTest({ state: s, action: 'draft_offer_email', ...base });
    expect(r.blocked).toContain('open_within_ceiling');
  });

  it('blocks a call two on a house the engine has not finished pricing', () => {
    const s = state({ deal: { comps_tier: 'gold' } });
    const r = stressTest({ state: s, action: 'call_branch', ...base });
    expect(r.blocked).toContain('offer_band_ready');
  });
});

describe('the reply on price is decided in code', () => {
  it('hands back the position before the button is pressed', () => {
    const s = state({}, { columnName: 'Offer sent' });
    const r = stressTest({
      state: s, action: 'draft_counter_reply', ...base,
      counter: { theirFigure: 92_000, currentOffer: 88_000 },
    });
    // 92,000 is inside the 96,000 ceiling, so this is a deal.
    expect(r.counter?.position).toBe('raise');
    expect(r.counter?.newOffer).toBe(92_000);
  });

  it('warns rather than raises when they want more than we may pay and we are at the top', () => {
    const s = state({}, { columnName: 'Offer sent' });
    const r = stressTest({
      state: s, action: 'draft_counter_reply', ...base,
      counter: { theirFigure: 110_000, currentOffer: 96_000 },
    });
    expect(r.counter?.position).toBe('pass');
    expect(r.warned).toContain('counter_position');
    // A pass is a judgement, not an error: it must not stop the human replying.
    expect(r.ok).toBe(true);
  });

  it('holds when the evidence is below the standard we would ship on', () => {
    const s = state(
      { deal: { offer: { open: 88_000, max: 96_000 }, comps_tier: 'good' } },
      { columnName: 'Offer sent' },
    );
    const r = stressTest({
      state: s, action: 'draft_counter_reply', ...base,
      counter: { theirFigure: 92_000, currentOffer: 88_000 },
    });
    expect(r.counter?.position).toBe('hold');
  });
});

describe('a long dash never leaves the building', () => {
  it('blocks an em dash and an en dash', () => {
    for (const dash of ['—', '–']) {
      const r = run('send_email', {
        draft: { subject: 'Hello', body: `Thanks for your time ${dash} we will be in touch.` },
      });
      expect(r.blocked).toContain('long_dash');
    }
  });
});

describe('the diary and the builder', () => {
  it('blocks a follow up booked in the past', () => {
    const r = run('book_followup', { dueAt: '2026-08-15T09:00:00Z' });
    expect(r.blocked).toContain('due_in_future');
  });

  it('blocks booking a builder when nobody covers the postcode', () => {
    const r = run('book_builder', { builderMatches: 0 });
    expect(r.blocked).toContain('builder_on_roster');
    expect(r.checks.find((c) => c.id === 'builder_on_roster')?.detail)
      .toContain('nobody for this outcode');
  });
});

describe('the card has to be at the right stage for a money move', () => {
  it('blocks an offer email on a card still in discovery', () => {
    const s = state({}, { columnName: 'Discovery done, evaluating' });
    const r = stressTest({ state: s, action: 'draft_offer_email', ...base });
    expect(r.blocked).toContain('stage_matches_action');
  });

  it('allows the same email once the ballpark is agreed', () => {
    const s = state({}, { columnName: 'Ballpark agreed' });
    const r = stressTest({ state: s, action: 'draft_offer_email', ...base });
    expect(r.blocked).not.toContain('stage_matches_action');
  });

  it('leaves a call alone whatever column the card is in', () => {
    // A card in the wrong column is an ordinary live event. Freezing the phone
    // over it would freeze the board.
    const s = state({}, { columnName: 'Nurturing' });
    const r = stressTest({ state: s, action: 'call_branch', ...base });
    expect(r.blocked).not.toContain('stage_matches_action');
  });
});

describe('a withdrawn house', () => {
  it('blocks anything that would reach the branch', () => {
    const s = state({ status: 'auditor_killed' });
    const r = stressTest({ state: s, action: 'call_branch', ...base });
    expect(r.blocked).toContain('property_alive');
  });

  it('still lets somebody look at it and write a note', () => {
    const s = state({ status: 'auditor_killed' });
    expect(stressTest({ state: s, action: 'compare_comps', ...base }).ok).toBe(true);
    expect(stressTest({ state: s, action: 'add_note', ...base }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// the investor pack: every hole blocks
// ---------------------------------------------------------------------------

describe('the investor pack gate refuses one missing line at a time', () => {
  const accepted = {
    id: 'm1', created_at: '2026-08-15T13:30:00Z', direction: 'inbound', channel: 'email',
    subject: 'Re: offer',
    body: 'We accept GBP 88,000 for Welwyn Park Road. Please send the paperwork.',
  };
  const whole = () => state({}, {
    columnName: 'Offer accepted', messages: [accepted],
  });

  it('passes when every line is on file', () => {
    const r = stressTest({ state: whole(), action: 'assemble_investor_pack', ...base });
    expect(r.ok).toBe(true);
    expect(r.checks.some((c) => c.id === 'pack_complete')).toBe(true);
  });

  it('blocks with no acceptance in writing', () => {
    const s = state({}, { columnName: 'Offer accepted', messages: [] });
    const r = stressTest({ state: s, action: 'assemble_investor_pack', ...base });
    expect(r.blocked).toContain('pack_written_acceptance');
  });

  it('accepts the street without the house number, which is how branches write', () => {
    // The address on file is "12 Welwyn Park Road, Hull, HU6 7QR" and the reply
    // says "for Welwyn Park Road". Demanding the house number would block a
    // genuinely complete pack, which is the one way a blocking check does real
    // damage rather than preventing it.
    const r = stressTest({ state: whole(), action: 'assemble_investor_pack', ...base });
    expect(r.blocked).not.toContain('pack_written_acceptance');
  });

  it('blocks when the branch wrote back but never named the street', () => {
    // A yes on the phone is not enough, and neither is a yes about nothing.
    const s = state({}, {
      columnName: 'Offer accepted',
      messages: [{ ...accepted, body: 'Yes, GBP 88,000 is agreed.' }],
    });
    const r = stressTest({ state: s, action: 'assemble_investor_pack', ...base });
    expect(r.blocked).toContain('pack_written_acceptance');
  });

  it('blocks with a number missing', () => {
    const s = state({ deal: {
      offer: { open: 88_000, max: 96_000 }, comps_tier: 'gold', cmv: { comps: 4 }, rent: 750,
    } }, { columnName: 'Offer accepted', messages: [accepted] });
    const r = stressTest({ state: s, action: 'assemble_investor_pack', ...base });
    expect(r.blocked).toContain('pack_numbers');
    expect(r.checks.find((c) => c.id === 'pack_numbers')?.detail).toContain('finished value');
  });

  it('blocks with fewer than three sold comparables', () => {
    const s = state({ deal: {
      offer: { open: 88_000, max: 96_000 }, gdv: { estimate: 150_000 }, tmv: 120_000,
      refurb: { low: 25_000 }, comps_tier: 'gold', cmv: { comps: 2 }, rent: 750,
    } }, { columnName: 'Offer accepted', messages: [accepted] });
    const r = stressTest({ state: s, action: 'assemble_investor_pack', ...base });
    expect(r.blocked).toContain('pack_three_sold_comps');
  });

  it('blocks with no rent comparable', () => {
    const s = state({
      qualification: {},
      deal: {
        offer: { open: 88_000, max: 96_000 }, gdv: { estimate: 150_000 }, tmv: 120_000,
        refurb: { low: 25_000 }, comps_tier: 'gold', cmv: { comps: 4 },
      },
    }, { columnName: 'Offer accepted', messages: [accepted] });
    const r = stressTest({ state: s, action: 'assemble_investor_pack', ...base });
    expect(r.blocked).toContain('pack_one_rent_comp');
  });

  it('blocks with no floor plan', () => {
    const s = state({ floorplan_urls: [] }, { columnName: 'Offer accepted', messages: [accepted] });
    const r = stressTest({ state: s, action: 'assemble_investor_pack', ...base });
    expect(r.blocked).toContain('pack_photos_floorplan');
  });

  it('blocks with no builder quote', () => {
    const s = state({ viewing_quote: null }, { columnName: 'Offer accepted', messages: [accepted] });
    const r = stressTest({ state: s, action: 'assemble_investor_pack', ...base });
    expect(r.blocked).toContain('pack_builder_quote');
  });
});

// ---------------------------------------------------------------------------
// the opposite property: warnings never stop anybody
// ---------------------------------------------------------------------------

describe('a warning is a judgement, and judgement stays with the human', () => {
  it('never clears ok, whatever is warning', () => {
    const s = state({
      pinned_note: 'Do not put the offer forward without proof of funds.',
      updated_at: '2026-08-01T09:00:00Z',
      qualification: {},
    }, { columnName: 'Ballpark agreed', calls: [], messages: [], followups: [] });
    const r = stressTest({ state: s, action: 'call_branch', ...base });
    expect(r.warned.length).toBeGreaterThanOrEqual(2);
    expect(r.ok).toBe(true);
  });

  it('surfaces Hugo\'s pinned note as a warning, because his words outrank the machine', () => {
    const s = state({ pinned_note: 'Ring the vendor direct, the branch is useless.' });
    const r = stressTest({ state: s, action: 'call_branch', ...base });
    expect(r.warned).toContain('pinned_note_read');
    expect(r.checks.find((c) => c.id === 'pinned_note_read')?.detail)
      .toContain('the branch is useless');
  });

  it('never blocks the three that exist to be pressed on a bad day', () => {
    const s = state({ status: 'auditor_killed', pinned_note: 'x', updated_at: '2026-01-01T00:00:00Z' });
    for (const a of ['escalate_hugo', 'add_note', 'hold'] as CockpitAction[]) {
      expect(stressTest({ state: s, action: a, ...base }).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// the shape of the thing
// ---------------------------------------------------------------------------

describe('the report itself', () => {
  it('puts the blocks first, so the eye lands on what is wrong', () => {
    const r = run('draft_offer_email', {
      draft: { subject: 'Offer', body: 'GBP 105,000 and we can stretch to GBP 96,000.' },
    });
    const levels = r.checks.map((c) => c.level);
    expect(levels.indexOf('block')).toBe(0);
    expect(levels.lastIndexOf('block')).toBeLessThan(
      levels.indexOf('pass') === -1 ? Infinity : levels.indexOf('pass'),
    );
  });

  it('covers every action in one pass, so a row of buttons costs one call', () => {
    const all = stressAll({ state: state(), ...base });
    expect(Object.keys(all).sort()).toEqual([...COCKPIT_ACTIONS].sort());
    for (const a of COCKPIT_ACTIONS) expect(all[a].action).toBe(a);
  });

  it('gives every action a label and a place it actually runs', () => {
    for (const a of COCKPIT_ACTIONS) {
      expect(ACTION_LABEL[a]).toBeTruthy();
      expect(['server', 'client', 'none']).toContain(ACTION_EXECUTION[a].by);
      expect(ACTION_EXECUTION[a].via).toBeTruthy();
    }
  });

  it('reads back as a sentence months later', () => {
    const r = run('draft_offer_email', {
      draft: { subject: 'Offer', body: 'GBP 105,000.' },
    });
    const text = stressToText(r);
    expect(text).toContain('Blocked');
    expect(text).toContain('105,000');
    expect(text).not.toMatch(/[–—]/);
  });

  it('writes no long dashes or curly punctuation in any check it produces', () => {
    // Hugo's rule applies to what the machine says as much as to what it sends.
    const all = stressAll({ state: state({ status: 'auditor_killed', pinned_note: 'x' }), ...base });
    for (const report of Object.values(all)) {
      for (const c of report.checks) {
        expect(c.title).not.toMatch(/[–—‘’“”…]/);
        expect(c.detail).not.toMatch(/[–—‘’“”…]/);
      }
    }
  });
});
