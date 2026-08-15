// When the machine is allowed to spend money, and when it must not.
//
// Written 2026-08-15 with api/lib/deal-manager-run.ts. AI_DEAL_MANAGER_PLAN
// section 9 budgets GBP 2 to 3 a day for roughly 150 to 250 assessments after
// dedupe. Every rule below exists to hold that by construction rather than by
// hoping, because the failure mode of an assessment loop is not a wrong answer,
// it is an invoice.
//
// These are pure functions on purpose: the spending rule is the thing most
// worth being able to test without a database in front of it.

import { describe, it, expect } from 'vitest';
import {
  shouldAssess, shouldRunFullSweep, FORCE_REASSESS_HOURS, MANAGER_DEFAULTS,
  RETRY_REFUSAL_MINUTES, ukDayStartIso,
} from '../api/lib/deal-manager-run';

const NOW = new Date('2026-08-15T14:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

describe('nothing changed means nothing is paid for', () => {
  it('skips a deal whose state hash is the same', () => {
    const r = shouldAssess({
      hash: 'abc', lastHash: 'abc', lastAssessedAt: ago(4), mode: 'event', now: NOW,
    });
    expect(r).toEqual({ assess: false, why: 'unchanged' });
  });

  it('assesses a deal whose state has genuinely moved', () => {
    const r = shouldAssess({
      hash: 'def', lastHash: 'abc', lastAssessedAt: ago(4), mode: 'event', now: NOW,
    });
    expect(r).toEqual({ assess: true, why: 'new_state' });
  });

  it('assesses a deal it has never seen', () => {
    const r = shouldAssess({
      hash: 'abc', lastHash: null, lastAssessedAt: null, mode: 'event', now: NOW,
    });
    expect(r.assess).toBe(true);
  });
});

describe('never twice in a minute, whatever happened', () => {
  it('refuses a second look inside the minimum gap even when the state changed', () => {
    // A branch replying twice in ten seconds is one event as far as an
    // instruction is concerned. Without this, a busy thread costs a pound.
    const r = shouldAssess({
      hash: 'def', lastHash: 'abc', lastAssessedAt: ago(0.005), mode: 'event', now: NOW,
    });
    expect(r).toEqual({ assess: false, why: 'too_soon' });
  });

  it('uses sixty seconds unless told otherwise', () => {
    expect(MANAGER_DEFAULTS.reassess_min_seconds).toBe(60);
    const justInside = shouldAssess({
      hash: 'def', lastHash: 'abc',
      lastAssessedAt: new Date(NOW.getTime() - 59_000).toISOString(),
      mode: 'event', now: NOW,
    });
    const justOutside = shouldAssess({
      hash: 'def', lastHash: 'abc',
      lastAssessedAt: new Date(NOW.getTime() - 61_000).toISOString(),
      mode: 'event', now: NOW,
    });
    expect(justInside.why).toBe('too_soon');
    expect(justOutside.why).toBe('new_state');
  });

  it('honours a caller that wants a different gap', () => {
    const r = shouldAssess({
      hash: 'def', lastHash: 'abc', lastAssessedAt: ago(0.5), mode: 'event', now: NOW,
      minSeconds: 3600,
    });
    expect(r.why).toBe('too_soon');
  });
});

describe('the morning sweep catches the deals nothing happened to', () => {
  it('re-assesses a stale instruction even on an identical hash', () => {
    // AI_DEAL_MANAGER_PLAN: the 07:30 run also catches "nothing happened
    // yesterday and that is the problem". A card sitting untouched in Ready for
    // call 2 is exactly the case the whole Manager exists for.
    const r = shouldAssess({
      hash: 'abc', lastHash: 'abc',
      lastAssessedAt: ago(FORCE_REASSESS_HOURS + 1), mode: 'full', now: NOW,
    });
    expect(r).toEqual({ assess: true, why: 'forced_daily' });
  });

  it('does NOT do that on the every-two-minutes run', () => {
    // Otherwise the force would fire every two minutes for the rest of the day
    // once a deal passed twenty hours, which is the cap gone by lunchtime.
    const r = shouldAssess({
      hash: 'abc', lastHash: 'abc',
      lastAssessedAt: ago(FORCE_REASSESS_HOURS + 1), mode: 'event', now: NOW,
    });
    expect(r).toEqual({ assess: false, why: 'unchanged' });
  });

  it('leaves a recently assessed deal alone even in full mode', () => {
    const r = shouldAssess({
      hash: 'abc', lastHash: 'abc',
      lastAssessedAt: ago(FORCE_REASSESS_HOURS - 1), mode: 'full', now: NOW,
    });
    expect(r.assess).toBe(false);
  });

  it('forces at twenty hours, not twenty-four, so 07:31 yesterday is not skipped at 07:29 today', () => {
    expect(FORCE_REASSESS_HOURS).toBe(20);
  });
});

describe('the full sweep runs once a day, in the morning, UK time', () => {
  // 07:30 UK is 06:30 UTC in August, because Britain is on summer time. Getting
  // this wrong by an hour means the sweep either runs before the overnight
  // machine has finished or after Pedro has started.
  const bstMorning = new Date('2026-08-15T06:30:00Z');
  const bstJustBefore = new Date('2026-08-15T06:29:00Z');
  const gmtMorning = new Date('2026-12-15T07:30:00Z');

  it('fires at 07:30 UK in summer', () => {
    expect(shouldRunFullSweep(bstMorning, null)).toBe(true);
  });

  it('fires at 07:30 UK in winter, when the offset is different', () => {
    expect(shouldRunFullSweep(gmtMorning, null)).toBe(true);
  });

  it('does not fire a minute early', () => {
    expect(shouldRunFullSweep(bstJustBefore, null)).toBe(false);
  });

  it('does not fire in the afternoon', () => {
    expect(shouldRunFullSweep(new Date('2026-08-15T14:00:00Z'), null)).toBe(false);
  });

  it('does not fire twice in one morning', () => {
    // The route asks this on every two-minute run, so without the "already done
    // today" half it would fire fifteen times in half an hour.
    const already = new Date('2026-08-15T06:30:00Z').toISOString();
    expect(shouldRunFullSweep(new Date('2026-08-15T06:40:00Z'), already)).toBe(false);
    expect(shouldRunFullSweep(new Date('2026-08-15T06:58:00Z'), already)).toBe(false);
  });

  it('fires again the next morning', () => {
    const yesterday = new Date('2026-08-14T06:30:00Z').toISOString();
    expect(shouldRunFullSweep(new Date('2026-08-15T06:35:00Z'), yesterday)).toBe(true);
  });

  it('fires when the last run is unreadable rather than never running again', () => {
    // Silence is the failure mode we refuse. A corrupt timestamp must not
    // switch the morning sweep off permanently.
    expect(shouldRunFullSweep(bstMorning, 'not a date')).toBe(true);
  });
});

describe('a refusal is not an answer, so it must not dedupe like one', () => {
  // Found on the live board 2026-08-15, in a screenshot rather than a test:
  // the MOST URGENT deal in the business read "No instruction on file yet"
  // because its one assessment came back as unparseable JSON. The hash matched
  // from then on, so every later sweep skipped it as "unchanged". The card that
  // most needs a human is exactly the one that must not be stuck holding a
  // fallback.

  it('tries a failed assessment again once the retry gap has passed', () => {
    const r = shouldAssess({
      hash: 'abc', lastHash: 'abc', lastAssessedAt: ago(1),
      lastWasRefusal: true, mode: 'event', now: NOW,
    });
    expect(r).toEqual({ assess: true, why: 'retry_refusal' });
  });

  it('does not retry it immediately, so a bad minute is not a retry loop', () => {
    const r = shouldAssess({
      hash: 'abc', lastHash: 'abc',
      lastAssessedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      lastWasRefusal: true, mode: 'event', now: NOW,
    });
    expect(r.assess).toBe(false);
    expect(r.why).toBe('unchanged');
  });

  it('leaves a SUCCESSFUL assessment deduped, which is the whole saving', () => {
    const r = shouldAssess({
      hash: 'abc', lastHash: 'abc', lastAssessedAt: ago(4),
      lastWasRefusal: false, mode: 'event', now: NOW,
    });
    expect(r).toEqual({ assess: false, why: 'unchanged' });
  });

  it('waits half an hour', () => {
    expect(RETRY_REFUSAL_MINUTES).toBe(30);
  });
});

describe('the day the cap counts is a UK day, not a UTC one', () => {
  // MEASURED ON THE LIVE BOARD 2026-08-15 at 23:14 UTC, which is 00:14 the next
  // day in British Summer Time. The naive version built the boundary as
  // `${ukDay}T00:00:00Z`, treating a UK date as a UTC one, so it landed an hour
  // in the FUTURE, the query matched nothing, and spentToday read 0 with 58
  // assessments sitting in the table. A daily cap that silently reads zero is
  // not a cap, it is a decoration.

  it('gives the right instant an hour after UK midnight in summer', () => {
    expect(ukDayStartIso(new Date('2026-08-15T23:14:00Z'))).toBe('2026-08-15T23:00:00.000Z');
  });

  it('gives yesterday evening UTC for a summer afternoon', () => {
    expect(ukDayStartIso(new Date('2026-08-15T14:00:00Z'))).toBe('2026-08-14T23:00:00.000Z');
  });

  it('agrees with UTC in winter, when there is no offset', () => {
    expect(ukDayStartIso(new Date('2026-12-15T14:00:00Z'))).toBe('2026-12-15T00:00:00.000Z');
  });

  it('is never in the future, which was the whole bug', () => {
    for (const iso of [
      '2026-08-15T23:14:00Z', '2026-08-15T00:30:00Z', '2026-06-21T22:59:00Z',
      '2026-12-31T23:59:00Z', '2026-01-01T00:01:00Z',
    ]) {
      const now = new Date(iso);
      expect(Date.parse(ukDayStartIso(now)), iso).toBeLessThanOrEqual(now.getTime());
    }
  });
});

describe('the defaults are the ones the plan budgeted for', () => {
  it('caps the day at 250 assessments', () => {
    expect(MANAGER_DEFAULTS.daily_cap).toBe(250);
  });

  it('takes at most 8 deals per sweep, which is what fits in 60 seconds', () => {
    // MEASURED on the live deployment 2026-08-15, not guessed: the first real
    // sweep timed out at 25. Loading 179 deals costs about 8 seconds and each
    // assessment about 5, so 8 + 5n must stay under the route's maxDuration of
    // 60. Eight every two minutes is still thousands of assessments of daily
    // capacity against a cap of 250.
    expect(MANAGER_DEFAULTS.sweep_batch).toBe(8);
  });

  it('starts switched OFF, so the flag has to be set deliberately', () => {
    expect(MANAGER_DEFAULTS.enabled).toBe(false);
  });
});
