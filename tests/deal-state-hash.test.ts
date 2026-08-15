// The hash decides what gets paid for.
//
// Written 2026-08-15 with api/lib/deal-manager-run.ts.
//
// THE FAILURE THIS PREVENTS is not a wrong answer, it is a bill. DealState
// carries several `hoursSince...` floats rounded to one decimal place, so they
// move on their own every six minutes. Hash the state raw and nothing ever
// dedupes: every sweep re-assesses all two hundred deals, the day's budget is
// gone before nine in the morning, and not one of those assessments learned
// anything the last one did not already know.
//
// The opposite failure matters just as much and is quieter: canonicalise too
// hard and a deal that really has changed keeps its old instruction. So both
// directions are tested, and the interesting cases are the boundary ones.

import { describe, it, expect } from 'vitest';
import { buildDealState, type DealStateInput } from '../api/lib/deal-state';
import { stateHash, hashableState } from '../api/lib/deal-manager-run';

const NOW = new Date('2026-08-15T14:00:00Z');

function state(over: Partial<DealStateInput> = {}, prop: Record<string, unknown> = {}) {
  const input: DealStateInput = {
    property: {
      id: 'p1',
      address: '12 Welwyn Park Road, Hull',
      status: 'new',
      asking_price: 110_000,
      deal: { offer: { open: 88_000, max: 96_000 }, comps_tier: 'gold' },
      updated_at: '2026-08-15T09:00:00Z',
      ...prop,
    },
    contact: { id: 'c1', last_contact_at: '2026-08-15T09:00:00Z' },
    columnName: 'Ready for call 2',
    calls: [{ id: 'k1', created_at: '2026-08-15T09:00:00Z', direction: 'outbound', disposition: 'Discovery done, evaluating' }],
    messages: [],
    followups: [],
    now: NOW,
    ...over,
  };
  return buildDealState(input);
}

describe('time passing on its own is not a change', () => {
  it('hashes the same an hour later', () => {
    const a = stateHash(state());
    const b = stateHash(state({ now: new Date('2026-08-15T15:00:00Z') }));
    expect(b).toBe(a);
  });

  it('hashes the same a day later, right up to the stale line', () => {
    // 71 hours: still inside STALE_HOURS, so nothing about the deal has
    // actually changed and nobody should pay to be told so again.
    const a = stateHash(state());
    const b = stateHash(state({ now: new Date('2026-08-18T08:00:00Z') }));
    expect(b).toBe(a);
  });

  it('keeps no hours-since reading at all', () => {
    // The structural version of the two tests above, so a new float added to
    // DealState cannot quietly reintroduce the problem.
    const json = JSON.stringify(hashableState(state()));
    expect(json).not.toMatch(/hours/i);
    expect(json).not.toMatch(/hoursSince/);
  });

  it('ignores the free text of the last inbound message', () => {
    // The preview is 400 characters of somebody else's typing. Hashing it means
    // a corrected typo in a threaded reply reads as a new fact.
    const json = JSON.stringify(hashableState(state()));
    expect(json).not.toMatch(/lastInboundPreview/);
  });
});

describe('a real change is a change', () => {
  const baseline = () => stateHash(state());

  it('changes when a branch writes back', () => {
    const withReply = state({
      messages: [{
        id: 'm1', created_at: '2026-08-15T13:00:00Z', direction: 'inbound',
        channel: 'email', body: 'We accept.',
      }],
    });
    expect(stateHash(withReply)).not.toBe(baseline());
  });

  it('changes when the deal crosses the stale line', () => {
    // The line itself IS a fact worth re-thinking about, even though the
    // minutes walking towards it are not. This is the boundary the whole
    // canonicalisation is built around.
    const before = stateHash(state({ now: new Date('2026-08-18T08:00:00Z') }));
    const after = stateHash(state({ now: new Date('2026-08-18T10:00:00Z') }));
    expect(after).not.toBe(before);
  });

  it('changes when the overnight re-price moves the money', () => {
    const repriced = state({}, { deal: { offer: { open: 84_000, max: 96_000 }, comps_tier: 'gold' } });
    expect(stateHash(repriced)).not.toBe(baseline());
  });

  it('changes when the card moves column', () => {
    expect(stateHash(state({ columnName: 'Ballpark agreed' }))).not.toBe(baseline());
  });

  it('changes when a follow-up falls due', () => {
    const due = state({
      followups: [{ id: 'f1', due_at: '2026-08-15T13:00:00Z', status: 'pending', note: 'ring back' }],
    });
    const notYet = state({
      followups: [{ id: 'f1', due_at: '2026-08-16T13:00:00Z', status: 'pending', note: 'ring back' }],
    });
    expect(stateHash(due)).not.toBe(stateHash(notYet));
  });

  it('changes when Hugo pins an instruction', () => {
    expect(stateHash(state({}, { pinned_note: 'Do not offer without proof of funds.' })))
      .not.toBe(baseline());
  });

  it('changes when a new brief is written', () => {
    expect(stateHash(state({}, { brief: { written_at: '2026-08-15T12:00:00Z', do_now: ['Ring them'] } })))
      .not.toBe(baseline());
  });

  it('changes when the branch is finally rung', () => {
    const rung = state({
      calls: [
        { id: 'k2', created_at: '2026-08-15T13:00:00Z', direction: 'outbound', disposition: 'Ballpark agreed' },
        { id: 'k1', created_at: '2026-08-15T09:00:00Z', direction: 'outbound', disposition: 'Discovery done, evaluating' },
      ],
    });
    expect(stateHash(rung)).not.toBe(baseline());
  });
});

/** Deep clone with every object's keys inserted in reverse order, so the value
 *  is identical and the insertion order is not. */
function rebuildReversed(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(rebuildReversed);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).reverse()) {
      out[k] = rebuildReversed((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

describe('the hash itself', () => {
  it('is sixteen hex characters', () => {
    expect(stateHash(state())).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not care what order the keys arrived in', () => {
    // An object rebuilt with its keys inserted in a different order is the same
    // deal. Without a stable stringify this alone would re-assess everything,
    // forever, because JSON.stringify preserves insertion order.
    const a = state();
    const reversed = rebuildReversed(a) as typeof a;
    // Prove the rebuild really did change the insertion order, or the test
    // would pass while testing nothing.
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(a));
    expect(stateHash(reversed)).toBe(stateHash(a));
  });

  it('does not collide on two genuinely different deals', () => {
    const seen = new Set<string>();
    for (const open of [80_000, 84_000, 88_000, 92_000, 96_000]) {
      for (const col of ['Ready for call 2', 'Ballpark agreed', 'Offer sent']) {
        seen.add(stateHash(state(
          { columnName: col },
          { deal: { offer: { open, max: 96_000 }, comps_tier: 'gold' } },
        )));
      }
    }
    expect(seen.size).toBe(15);
  });
});
