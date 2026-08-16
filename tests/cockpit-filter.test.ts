// What belongs in the cockpit, and what belongs back in the calling list.
//
// Written 2026-08-16 after Hugo looked at the first live version and said the
// list was essentially wrong:
//
//   "you are focusing on voicemail and things like this ... if it's in
//    voicemail it doesn't come to the cockpit. The cockpit is for the ones that
//    were called that day or the day before, the ones under nurturing, the ones
//    on the ballpark. Not the ones that didn't pick up."
//
// He was right, and the board proved it. Of 179 properties the first version
// put in front of him, 144 were a dial nobody had ever answered and 35 were a
// real deal. Four cards in five were noise, which means the one that mattered
// was somewhere below the fold.
//
// THE RULE: the cockpit is where a CONVERSATION is waiting on a decision.
//
// AMENDED 2026-08-16 evening, Hugo again: "there are only 15 deals pedro
// called on the pipeline but on cockpit looks like there are 35". The 14 Aug
// board wipe deliberately nulled 59 columns, and the old rule-7 fallback
// (spoken to but no column = show it) resurrected exactly those branches. So
// the board is the curated truth now: no column means NOT in the cockpit,
// with the same two exceptions as everything else (they wrote to us, or a
// follow-up is overdue).

import { describe, it, expect } from 'vitest';
import { buildDealState, type DealStateInput } from '../api/lib/deal-state';
import { readFileSync } from 'node:fs';
import {
  isCockpitDeal, cockpitDeals, CALLING_LIST_COLUMNS, CLOSED_DOOR_COLUMNS, LIVE_COLUMNS,
  WAITING_COLUMN,
} from '../api/lib/cockpit-filter';

const NOW = new Date('2026-08-16T14:00:00Z');

/** A deal is defined by its calls and its column, so those are the knobs. */
function state(opts: {
  column?: string | null;
  calls?: Array<{ disposition?: string | null; duration_sec?: number | null; hoursAgo?: number }>;
  inboundHoursAgo?: number;
  outboundHoursAgo?: number;
  briefWrittenHoursAgo?: number;
  followupDueHoursAgo?: number;
} = {}) {
  const iso = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  const input: DealStateInput = {
    property: {
      id: 'p1',
      address: '12 Welwyn Park Road, Hull',
      status: 'new',
      asking_price: 110_000,
      ...(opts.briefWrittenHoursAgo !== undefined
        ? { brief: { written_at: iso(opts.briefWrittenHoursAgo), do_now: ['Ring them'] } }
        : {}),
    },
    contact: { id: 'c1' },
    columnName: opts.column ?? null,
    calls: (opts.calls ?? []).map((k, i) => ({
      id: `k${i}`,
      created_at: iso(k.hoursAgo ?? 5),
      direction: 'outbound',
      disposition: k.disposition ?? null,
      duration_sec: k.duration_sec ?? 0,
    })),
    messages: [
      ...(opts.inboundHoursAgo === undefined ? [] : [{
        id: 'm1', created_at: iso(opts.inboundHoursAgo), direction: 'inbound',
        channel: 'email', body: 'We accept.',
      }]),
      ...(opts.outboundHoursAgo === undefined ? [] : [{
        id: 'm2', created_at: iso(opts.outboundHoursAgo), direction: 'outbound',
        channel: 'email', body: 'Our reply.',
      }]),
    ],
    followups: opts.followupDueHoursAgo === undefined ? [] : [{
      id: 'f1', due_at: iso(opts.followupDueHoursAgo), status: 'pending', note: 'ring back',
    }],
    now: NOW,
  };
  return buildDealState(input);
}

const SPOKE = { disposition: 'Discovery done, evaluating', duration_sec: 240 };
const VOICEMAIL = { disposition: 'Voicemail', duration_sec: 12 };

describe('a dial is not a deal', () => {
  it('keeps a branch parked in Voicemail out', () => {
    const d = isCockpitDeal(state({ column: 'Voicemail', calls: [VOICEMAIL] }));
    expect(d.inCockpit).toBe(false);
    expect(d.why).toBe('calling_list');
    expect(d.reason).toContain('calling list');
  });

  it('keeps No pickup out', () => {
    expect(isCockpitDeal(state({ column: 'No pickup', calls: [VOICEMAIL] })).inCockpit).toBe(false);
  });

  it('keeps out a branch with NO COLUMN that has only ever gone to voicemail', () => {
    // This is the big one: 77 of the 179 had no column at all and would have
    // walked straight through a filter that only looked at the board.
    const d = isCockpitDeal(state({ column: null, calls: [VOICEMAIL, VOICEMAIL, VOICEMAIL] }));
    expect(d.inCockpit).toBe(false);
    expect(d.why).toBe('never_spoke');
    expect(d.reason).toContain('3 times');
  });

  it('keeps out a branch nobody has rung at all', () => {
    const d = isCockpitDeal(state({ column: null, calls: [] }));
    expect(d.inCockpit).toBe(false);
    expect(d.why).toBe('never_spoke');
    expect(d.reason).toContain('Nobody has rung');
  });

  it('keeps out a branch that said no', () => {
    const d = isCockpitDeal(state({ column: 'Not interested', calls: [SPOKE] }));
    expect(d.inCockpit).toBe(false);
    expect(d.why).toBe('closed_door');
  });

  it('keeps out a deal that has finished', () => {
    expect(isCockpitDeal(state({ column: 'Deal closed', calls: [SPOKE] })).why).toBe('finished');
  });
});

describe('a conversation waiting on a decision is a deal', () => {
  it('lets in every live column', () => {
    for (const column of LIVE_COLUMNS.filter((c) => c !== 'Deal closed')) {
      const d = isCockpitDeal(state({ column, calls: [SPOKE] }));
      expect(d.inCockpit, column).toBe(true);
    }
  });

  it('lets in the ones Hugo named: nurturing and ballpark', () => {
    expect(isCockpitDeal(state({ column: 'Nurturing', calls: [SPOKE] })).inCockpit).toBe(true);
    expect(isCockpitDeal(state({ column: 'Ballpark agreed', calls: [SPOKE] })).inCockpit).toBe(true);
  });

  it('keeps OUT a branch spoken to that a human took off the board', () => {
    // The reversal of the original rule 7. The 14 Aug wipe nulled 59 columns
    // on purpose, and the old fallback put ~25 of those houses straight back
    // on the screen (one Glasgow office contributed six on its own). Off the
    // board means off the cockpit.
    const d = isCockpitDeal(state({ column: null, calls: [{ ...SPOKE, hoursAgo: 20 }] }));
    expect(d.inCockpit).toBe(false);
    expect(d.why).toBe('off_board');
    expect(d.reason).toContain('board');
  });

  it('keeps a column this file has never heard of, because a human made it', () => {
    const d = isCockpitDeal(state({ column: 'Waiting on probate', calls: [SPOKE] }));
    expect(d.inCockpit).toBe(true);
    expect(d.why).toBe('live_column');
  });

  it('a long undispositioned call still cannot outrank being off the board', () => {
    // Nobody listens to a voicemail greeting for four minutes, so this IS a
    // conversation, but with no column it stays out all the same.
    const d = isCockpitDeal(state({ column: null, calls: [{ duration_sec: 240 }] }));
    expect(d.inCockpit).toBe(false);
    expect(d.why).toBe('off_board');
  });

  it('does not count a ten second undispositioned call', () => {
    expect(isCockpitDeal(state({ column: null, calls: [{ duration_sec: 10 }] })).inCockpit).toBe(false);
  });
});

describe('two things outrank being parked, and they are the two that cost money', () => {
  it('a branch that WROTE to us comes back even from Voicemail', () => {
    // This is the failure the cockpit exists to prevent, and a filter that hid
    // it would recreate it: Lexi's rejection sat unread for seven hours.
    const d = isCockpitDeal(state({
      column: 'Voicemail', calls: [VOICEMAIL],
      briefWrittenHoursAgo: 30, inboundHoursAgo: 2,
    }));
    expect(d.inCockpit).toBe(true);
    expect(d.why).toBe('branch_replied');
  });

  it('an overdue follow-up comes back even from No pickup', () => {
    const d = isCockpitDeal(state({
      column: 'No pickup', calls: [VOICEMAIL], followupDueHoursAgo: 3,
    }));
    expect(d.inCockpit).toBe(true);
    expect(d.why).toBe('overdue_followup');
  });

  it('but a reply BEFORE the brief does not, because it is already answered', () => {
    const d = isCockpitDeal(state({
      column: 'Voicemail', calls: [VOICEMAIL],
      briefWrittenHoursAgo: 1, inboundHoursAgo: 20,
    }));
    expect(d.inCockpit).toBe(false);
  });
});

describe('the shape of the thing', () => {
  it('filters a list in one call', () => {
    const all = [
      { state: state({ column: 'Voicemail', calls: [VOICEMAIL] }) },
      { state: state({ column: 'Ballpark agreed', calls: [SPOKE] }) },
      { state: state({ column: null, calls: [] }) },
      { state: state({ column: 'Nurturing', calls: [SPOKE] }) },
    ];
    expect(cockpitDeals(all)).toHaveLength(2);
  });

  it('always gives a reason a person could read', () => {
    for (const s of [
      state({ column: 'Voicemail', calls: [VOICEMAIL] }),
      state({ column: null, calls: [] }),
      state({ column: 'Not interested', calls: [SPOKE] }),
      state({ column: 'Ballpark agreed', calls: [SPOKE] }),
    ]) {
      const d = isCockpitDeal(s);
      expect(d.reason.length).toBeGreaterThan(10);
      expect(d.reason).not.toMatch(/[a-z]_[a-z]/);
      expect(d.reason).not.toMatch(/[–—‘’“”…]/);
    }
  });

  it('never puts a column in two lists at once', () => {
    for (const c of CALLING_LIST_COLUMNS) expect(LIVE_COLUMNS).not.toContain(c);
    for (const c of CLOSED_DOOR_COLUMNS) expect(LIVE_COLUMNS).not.toContain(c);
    expect(LIVE_COLUMNS).not.toContain(WAITING_COLUMN);
  });
});

describe('waiting on their answer: we replied, the ball is in their court', () => {
  // Hugo, 16 Aug, on DDM: "So I replied it. So why still on the list if you
  // replied?" After the counter goes out there is nothing to decide until
  // they answer, so the card waits off the desk in its own column.

  it('a freshly answered card is off the desk', () => {
    const d = isCockpitDeal(
      state({ column: WAITING_COLUMN, calls: [SPOKE], outboundHoursAgo: 2 }), NOW,
    );
    expect(d.inCockpit).toBe(false);
    expect(d.why).toBe('waiting_reply');
  });

  it('comes back the moment they write', () => {
    const d = isCockpitDeal(
      state({ column: WAITING_COLUMN, calls: [SPOKE], outboundHoursAgo: 24, inboundHoursAgo: 1 }), NOW,
    );
    expect(d.inCockpit).toBe(true);
    expect(d.why).toBe('branch_replied');
  });

  it('comes back as a chase after four days of silence', () => {
    const d = isCockpitDeal(
      state({ column: WAITING_COLUMN, calls: [SPOKE], outboundHoursAgo: 100 }), NOW,
    );
    expect(d.inCockpit).toBe(true);
    expect(d.reason).toMatch(/[Cc]hase/);
  });

  it('a booked follow-up still wins: the card is scheduled, not waiting', () => {
    const d = isCockpitDeal(
      state({ column: WAITING_COLUMN, calls: [SPOKE], outboundHoursAgo: 2, followupDueHoursAgo: -48 }), NOW,
    );
    expect(d.inCockpit).toBe(false);
    expect(d.why).toBe('scheduled');
  });

  it('the column name is the same string everywhere it is written', () => {
    // The migration creates it, cockpit-action moves cards into it, the
    // contract gives it an action list, and the stage picker offers it. One
    // typo in any of them and the exit silently stops existing.
    for (const file of [
      'supabase/migrations/20260816000005_waiting_on_their_answer.sql',
      'api/crm/cockpit-action.ts',
      'api/lib/deal-manager-contract.ts',
      'api/crm/cockpit.ts',
    ]) {
      expect(readFileSync(file, 'utf8'), file).toContain(`'${WAITING_COLUMN}'`);
    }
  });
});
