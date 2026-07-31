// The bake-off budget guard: the harness must REFUSE a submission that would
// pass the cap, not warn about it. This is the machine form of the plan's
// "hard guard at 75 GBP" rule.

import { describe, it, expect } from 'vitest';
import { assertWithinBudget, spentUsd, EST_USD, type SpendEntry } from '../../bench/budget';

const entry = (estUsd: number): SpendEntry => ({ key: `k${estUsd}`, estUsd, ts: '2026-07-31T00:00:00Z' });

describe('bench budget guard', () => {
  it('allows spends at or below the budget', () => {
    expect(() => assertWithinBudget([], 5, 10)).not.toThrow();
    expect(() => assertWithinBudget([entry(4)], 6, 10)).not.toThrow();
  });

  it('refuses the submission that would cross the cap', () => {
    expect(() => assertWithinBudget([entry(9.5)], 0.6, 10)).toThrow(/Budget guard/);
  });

  it('sums prior entries', () => {
    const prior = [entry(3), entry(3), entry(3)];
    expect(spentUsd(prior)).toBeCloseTo(9);
    expect(() => assertWithinBudget(prior, 1.5, 10)).toThrow(/Budget guard/);
  });

  it('a measured real bill replaces the ceiling estimate in the sum', () => {
    const prior: SpendEntry[] = [
      { key: 'a', estUsd: 3, realUsd: 0.5, ts: '2026-07-31T00:00:00Z' },
      { key: 'b', estUsd: 3, ts: '2026-07-31T00:00:00Z' },
    ];
    expect(spentUsd(prior)).toBeCloseTo(3.5);
    expect(() => assertWithinBudget(prior, 6, 10)).not.toThrow();
  });

  it('rejects nonsense inputs instead of failing open', () => {
    expect(() => assertWithinBudget([], 1, 0)).toThrow();
    expect(() => assertWithinBudget([], 1, -5)).toThrow();
    expect(() => assertWithinBudget([], Number.NaN, 10)).toThrow();
    expect(() => assertWithinBudget([], -1, 10)).toThrow();
  });

  it('a corrupt ledger entry (NaN estUsd) refuses instead of failing open', () => {
    const corrupt = [{ key: 'k', ts: '2026-07-31T00:00:00Z' } as SpendEntry];
    expect(() => assertWithinBudget(corrupt, 1, 10)).toThrow(/corrupt/);
  });

  it('estimates are conflict-ceiling prices, so a 15s talking head fits in a $10 round', () => {
    const round1 = 2 * EST_USD.image_draft + EST_USD.voice_take + EST_USD.image_draft + EST_USD.image_final + 15 * EST_USD.kling_std_second + 15 * EST_USD.omnihuman_second;
    expect(round1).toBeLessThan(10);
  });
});
