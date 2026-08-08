import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HEYPUBLI_STEPS,
  STEP_LABEL,
  CHECK_IN_LADDER_MINUTES,
  FIRST_NUDGE_AFTER_HOURS,
  MAX_NUDGES,
  REPLY_PAUSE_HOURS,
  nudgeGapHours,
  phoneKey,
  resolveJourneySteps,
  nextTouch,
  dueLabel,
  type JourneyProfile,
  type ProgressRow,
} from '../src/core/heypubli/journey';

// The five onboarding steps and the follow-up ladder both already exist in the
// HeyPubli repo. This module is the ONE place the Elsie inbox reads them from,
// so nobody re-derives "how far along is this lead" a second time and gets a
// different answer. Sources of truth:
//   heypubli/lib/data/onboarding.ts        ONBOARDING_STEPS + resolveFunnel
//   heypubli/scripts/check-creators.mjs    the 5/5 count Hugo reads
//   heypubli/lib/data/onboarding-nudges.ts the ladder that actually sends
//   heypubli/lib/data/reply-brain.ts       the fast check-in rungs

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('the five steps', () => {
  it('is the same list, in the same order, as the HeyPubli funnel', () => {
    expect([...HEYPUBLI_STEPS]).toEqual([
      'instagram',
      'community',
      'affiliate',
      'photo',
      'bio',
    ]);
  });

  it('matches heypubli/lib/data/onboarding.ts, which is the original', () => {
    const src = read('heypubli/lib/data/onboarding.ts');
    const block = src.slice(src.indexOf('ONBOARDING_STEPS'));
    const order = [...block.matchAll(/"(instagram|community|affiliate|photo|bio)"/g)].map(
      (m) => m[1],
    );
    expect(order.slice(0, 5)).toEqual([...HEYPUBLI_STEPS]);
  });

  it('gives every step words a human can read', () => {
    for (const s of HEYPUBLI_STEPS) {
      expect(STEP_LABEL[s].length).toBeGreaterThan(3);
    }
  });
});

describe('the ladder constants', () => {
  it('matches the nudge brain that actually sends', () => {
    const src = read('heypubli/lib/data/onboarding-nudges.ts');
    expect(src).toMatch(new RegExp(`FIRST_NUDGE_AFTER_HOURS = ${FIRST_NUDGE_AFTER_HOURS}\\b`));
    expect(src).toMatch(new RegExp(`MAX_NUDGES = ${MAX_NUDGES}\\b`));
    expect(src).toMatch(new RegExp(`REPLY_PAUSE_HOURS = ${REPLY_PAUSE_HOURS}\\b`));
    expect(nudgeGapHours(0)).toBe(22);
    expect(nudgeGapHours(1)).toBe(22);
    expect(nudgeGapHours(2)).toBe(44);
    expect(src).toMatch(/nudgeCount <= 1 \? 22 : 44/);
  });

  // READ the numbers out of the HeyPubli source rather than repeating them,
  // so changing the cadence there needs no edit here and the two can still
  // never disagree. Hardcoding them meant every cadence change broke the
  // build in a file that has nothing to do with cadence.
  it('matches the reply brain for the fast check-ins', () => {
    const src = read('heypubli/lib/data/reply-brain.ts');
    const m = src.match(/CHECK_IN_LADDER_MINUTES = \[([\d, ]+)\]/);
    expect(m, 'CHECK_IN_LADDER_MINUTES not found in reply-brain.ts').toBeTruthy();
    const fromSource = m![1].split(',').map((n) => Number(n.trim()));
    expect([...CHECK_IN_LADDER_MINUTES]).toEqual(fromSource);
    // Every rung must fit inside the free 24h window their own message opens.
    for (const mins of fromSource) expect(mins).toBeLessThan(24 * 60);
  });
});

describe('phoneKey', () => {
  it('matches a HeyPubli whatsapp column against an Elsie contact phone', () => {
    expect(phoneKey('+918207324841')).toBe('918207324841');
    expect(phoneKey('whatsapp:+918207324841')).toBe('918207324841');
    expect(phoneKey('+91 8207 324841')).toBe('918207324841');
  });

  it('is empty for nothing, so a null phone never collides with another null', () => {
    expect(phoneKey(null)).toBe('');
    expect(phoneKey('')).toBe('');
  });
});

// ---------------------------------------------------------------------------

const profile = (over: Partial<JourneyProfile> = {}): JourneyProfile => ({
  id: 'p1',
  firstName: 'Prem',
  lastName: 'Bharti',
  email: 'premuphar007@gmail.com',
  whatsapp: '+918207324841',
  igUsername: 'upharprem',
  igConnected: true,
  createdAt: '2026-08-07T09:57:42Z',
  onboardingComplete: false,
  suspendedAt: null,
  communityJoinedDeclaredAt: null,
  photoDeclaredAt: null,
  bioLinkDeclaredAt: null,
  skoolAffiliateUrl: null,
  ...over,
});

const progress = (rows: Array<[string, string | null]>): ProgressRow[] =>
  rows.map(([step, completed_at]) => ({
    step,
    first_seen_at: '2026-08-07T09:58:00Z',
    completed_at,
  }));

describe('resolveJourneySteps', () => {
  it('reads the completed_at stamps, which is what check-creators.mjs counts', () => {
    const steps = resolveJourneySteps(
      profile(),
      progress([
        ['instagram', '2026-08-07T09:58:00Z'],
        ['community', '2026-08-07T10:03:47Z'],
        ['affiliate', null],
      ]),
    );
    expect(steps.filter((s) => s.done).map((s) => s.id)).toEqual(['instagram', 'community']);
    expect(steps[1].at).toBe('2026-08-07T10:03:47Z');
  });

  it('falls back to the profile stamp when no progress row exists yet', () => {
    // A creator who ticked the box before onboarding_progress was introduced
    // still has photo_declared_at on the profile. Reading only one of the two
    // sources under-reports people who really are done.
    const steps = resolveJourneySteps(
      profile({ photoDeclaredAt: '2026-08-07T10:32:33Z', skoolAffiliateUrl: 'https://skool.com/x?ref=abc' }),
      [],
    );
    const by = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(by.photo.done).toBe(true);
    expect(by.photo.at).toBe('2026-08-07T10:32:33Z');
    expect(by.affiliate.done).toBe(true);
  });

  it('reads Instagram from the live connection, never from instagram_connections', () => {
    // instagram_connections is empty and always has been. The connection flag
    // fed in here comes from outstand_connections.
    expect(resolveJourneySteps(profile({ igConnected: false }), [])[0].done).toBe(false);
    expect(resolveJourneySteps(profile({ igConnected: true }), [])[0].done).toBe(true);
  });

  it('is forward-only: a stamped step stays done', () => {
    const steps = resolveJourneySteps(
      profile({ igConnected: false }),
      progress([['instagram', '2026-08-07T09:58:00Z']]),
    );
    expect(steps[0].done).toBe(true);
  });

  it('always returns all five, in order, so a badge can say n/5', () => {
    const steps = resolveJourneySteps(profile(), []);
    expect(steps.map((s) => s.id)).toEqual([...HEYPUBLI_STEPS]);
  });
});

// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-07T12:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString();

const touch = (over: Partial<Parameters<typeof nextTouch>[0]> = {}) =>
  nextTouch({
    now: NOW,
    hasAccount: true,
    allDone: false,
    openStep: 'community',
    suspendedAt: null,
    stoppedAt: null,
    nudgeCount: 0,
    lastNudgedAt: null,
    lastActivityAt: ago(6),
    lastInboundAt: null,
    lastOutboundAt: ago(6),
    checkInsThisStep: 0,
    checkInsLive: false,
    ...over,
  });

describe('nextTouch', () => {
  it('says there is nothing to chase once all five are done', () => {
    const t = touch({ allDone: true, openStep: null });
    expect(t.kind).toBe('done');
    expect(t.dueAt).toBeNull();
  });

  it('says so plainly when the lead has no HeyPubli account yet', () => {
    expect(touch({ hasAccount: false }).kind).toBe('none');
  });

  it('stops for good on a suspended or stopped creator', () => {
    expect(touch({ suspendedAt: ago(1) }).kind).toBe('stopped');
    expect(touch({ stoppedAt: ago(1) }).kind).toBe('stopped');
  });

  it('stops once the lifetime cap is spent', () => {
    expect(touch({ nudgeCount: MAX_NUDGES }).kind).toBe('stopped');
  });

  it('hands the thread to a human the moment they write back', () => {
    // Hugo, 2026-08-06: a lead said "not interested" and got pitched anyway.
    // A reply is a conversation, not a slot in a drip.
    const t = touch({ lastInboundAt: ago(0.2), lastOutboundAt: ago(3) });
    expect(t.kind).toBe('reply');
    expect(t.dueAt).toBeNull();
  });

  it('claims nothing about the automation when they wrote last', () => {
    // It used to say "the automatic follow-ups are paused", which is not what
    // the engine does. shouldNudge() pauses for REPLY_PAUSE_HOURS measured
    // from signup_leads.engaged_at, a FIRST-reply stamp that is never
    // refreshed, so a nudge can go out to a lead the panel called paused.
    // The wording now makes no promise at all rather than a wrong one.
    const t = touch({ lastInboundAt: ago(0.2), lastOutboundAt: ago(3) });
    expect(t.detail).toBe('They wrote last. Answer them here.');
    expect(t.detail).not.toMatch(/paus/i);

    // The real rule, so this stays true if somebody changes the engine.
    const brain = read('heypubli/lib/data/onboarding-nudges.ts');
    expect(brain).toContain('hoursSince(input.engagedAt, input.now) < REPLY_PAUSE_HOURS');
    expect(brain).toContain('engaged_at');
  });

  it('holds the drip for three hours after they reply', () => {
    // REPLY_PAUSE_HOURS in the nudge brain. Their reply is newer than nothing
    // we sent, but it still parks the robot.
    const t = touch({ lastInboundAt: ago(1), lastOutboundAt: ago(0.5), lastActivityAt: ago(30) });
    expect(t.kind).toBe('nudge');
    expect(new Date(t.dueAt!).toISOString()).toBe(
      new Date(NOW.getTime() + (REPLY_PAUSE_HOURS - 1) * 3600_000).toISOString(),
    );
  });

  it('sends the first nudge two hours after the last sign of life', () => {
    const t = touch({ lastActivityAt: ago(0.5), lastNudgedAt: null });
    expect(t.kind).toBe('nudge');
    expect(t.nudgeNumber).toBe(1);
    expect(new Date(t.dueAt!).toISOString()).toBe(
      new Date(NOW.getTime() + 1.5 * 3600_000).toISOString(),
    );
  });

  it('is due right now once the wait has already passed', () => {
    const t = touch({ lastActivityAt: ago(9) });
    expect(t.kind).toBe('nudge');
    expect(new Date(t.dueAt!).getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(t.overdue).toBe(true);
  });

  it('waits 22 hours before the second, then 44 before the fourth', () => {
    const second = touch({ nudgeCount: 1, lastNudgedAt: ago(1), lastActivityAt: ago(40) });
    expect(new Date(second.dueAt!).toISOString()).toBe(
      new Date(NOW.getTime() + 21 * 3600_000).toISOString(),
    );
    const fourth = touch({ nudgeCount: 3, lastNudgedAt: ago(4), lastActivityAt: ago(80) });
    expect(new Date(fourth.dueAt!).toISOString()).toBe(
      new Date(NOW.getTime() + 40 * 3600_000).toISOString(),
    );
  });

  it('counts the nudge it is about to send, not the ones already spent', () => {
    expect(touch({ nudgeCount: 2, lastNudgedAt: ago(50), lastActivityAt: ago(50) }).nudgeNumber).toBe(3);
  });

  it('does not promise the 15 minute check-in, because nothing sends it yet', () => {
    // decideCheckIn() in heypubli/lib/data/reply-brain.ts has tests and no
    // production caller. Showing "next follow-up in 15 minutes" would be the
    // inbox telling Hugo about a message that is never sent.
    const t = touch({ lastOutboundAt: ago(0.1), lastActivityAt: ago(0.1), checkInsLive: false });
    expect(t.kind).not.toBe('check_in');
  });

  it('counts down to the rung the reply brain will actually send', () => {
    // The due time comes off CHECK_IN_LADDER_MINUTES, so the card is right
    // whatever the cadence is set to; the test asserts the relationship, not
    // a number it would have to be edited to keep.
    const minsAgo = 6;
    const first = touch({ lastOutboundAt: ago(0.1), lastActivityAt: ago(0.1), checkInsLive: true });
    expect(first.kind).toBe('check_in');
    expect(first.rung).toBe(1);
    expect(new Date(first.dueAt!).toISOString()).toBe(
      new Date(NOW.getTime() + (CHECK_IN_LADDER_MINUTES[0] - minsAgo) * 60_000).toISOString(),
    );
    const second = touch({
      lastOutboundAt: ago(0.5),
      lastActivityAt: ago(0.5),
      checkInsThisStep: 1,
      checkInsLive: true,
    });
    expect(second.kind).toBe('check_in');
    expect(second.rung).toBe(2);
    // Every rung spent hands over to the slow ladder, exactly like decideCheckIn.
    expect(
      touch({
        lastOutboundAt: ago(30),
        lastActivityAt: ago(30),
        checkInsThisStep: CHECK_IN_LADDER_MINUTES.length,
        checkInsLive: true,
      }).kind,
    ).toBe('nudge');
  });

  it('always says something, so the panel is never blank', () => {
    for (const t of [
      touch(),
      touch({ allDone: true }),
      touch({ hasAccount: false }),
      touch({ stoppedAt: ago(1) }),
      touch({ lastInboundAt: ago(0.1) }),
    ]) {
      expect(t.label.length).toBeGreaterThan(3);
      expect(t.detail.length).toBeGreaterThan(3);
    }
  });
});

describe('dueLabel', () => {
  it('says "due now" once the moment has passed', () => {
    expect(dueLabel(ago(1), NOW)).toBe('due now');
    expect(dueLabel(NOW.toISOString(), NOW)).toBe('due now');
  });

  it('counts minutes, then hours, then days', () => {
    const inMs = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();
    expect(dueLabel(inMs(9), NOW)).toBe('in 9 min');
    expect(dueLabel(inMs(75), NOW)).toBe('in 1h');
    expect(dueLabel(inMs(60 * 21), NOW)).toBe('in 21h');
    expect(dueLabel(inMs(60 * 45), NOW)).toBe('in 1 day');
    expect(dueLabel(inMs(60 * 24 * 3), NOW)).toBe('in 3 days');
  });

  it('says nothing at all when nothing is scheduled', () => {
    expect(dueLabel(null, NOW)).toBe('');
  });
});

describe('the house punctuation rule', () => {
  it('puts no long dash, curly quote or ellipsis character in front of anyone', () => {
    const src = read('src/core/heypubli/journey.ts') + read('src/core/heypubli/lead-form.ts');
    expect(src).not.toMatch(/[–—‘’“”…]/);
  });
});
