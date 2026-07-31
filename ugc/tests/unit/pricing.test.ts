// The no-loss invariant, executable. Hugo, 2026-07-31: users "pay 49 and get
// some credits where we dont loose". This test is that sentence as machine
// law: if anyone edits the price book into a shape that could lose money on
// API costs, the build fails. Assumptions are deliberately pessimistic:
// weak pound (1 GBP = 1.20 USD), worst-case Stripe fee (3.25% + 20p
// international card), and every provider billed at the highest price any
// source claims (the "conflict ceiling"), not the likely price.

import { describe, it, expect } from 'vitest';
import {
  CREDIT_VALUE_GBP,
  PACK_PRICE_GBP,
  PACK_CREDITS,
  FX_USD_PER_GBP,
  MIN_MARGIN_MULTIPLE,
  PRICE_BOOK,
  creditsFor,
  packNetRevenueGbp,
  worstCaseBurnProviderCostGbp,
} from '../../src/core/pricing';

describe('pricing canon', () => {
  it('one credit is exactly one penny and the pack maths is exact', () => {
    expect(CREDIT_VALUE_GBP).toBe(0.01);
    expect(PACK_CREDITS * CREDIT_VALUE_GBP).toBeCloseTo(PACK_PRICE_GBP, 10);
    expect(PACK_CREDITS).toBe(4900);
    expect(PACK_PRICE_GBP).toBe(49);
  });

  it('net revenue survives the worst-case Stripe fee', () => {
    const net = packNetRevenueGbp();
    expect(net).toBeGreaterThan(47);
    expect(net).toBeLessThan(PACK_PRICE_GBP);
  });

  it('every ACTIVE op is priced at or above the margin multiple of its worst-case cost', () => {
    for (const row of PRICE_BOOK.filter((r) => r.active)) {
      const priceUsd = row.creditsPerUnit * CREDIT_VALUE_GBP * FX_USD_PER_GBP;
      expect(
        priceUsd,
        `${row.opCode}: ${row.creditsPerUnit}cr sells for $${priceUsd.toFixed(3)} against a worst-case cost of $${row.worstCaseUnitCostUsd}`,
      ).toBeGreaterThanOrEqual(MIN_MARGIN_MULTIPLE * row.worstCaseUnitCostUsd);
    }
  });

  it('burning the ENTIRE pack on any single active op still cannot lose money', () => {
    const net = packNetRevenueGbp();
    for (const row of PRICE_BOOK.filter((r) => r.active && r.worstCaseUnitCostUsd > 0)) {
      const providerCost = worstCaseBurnProviderCostGbp(row.opCode);
      expect(
        providerCost,
        `${row.opCode}: whole-pack burn costs ${providerCost.toFixed(2)} GBP vs ${net.toFixed(2)} GBP net revenue`,
      ).toBeLessThan(net);
    }
  });

  it('b-roll stays INACTIVE until the disputed Seedance origin price is verified against a real bill', () => {
    const broll = PRICE_BOOK.find((r) => r.opCode === 'broll_second');
    expect(broll).toBeDefined();
    expect(broll!.active).toBe(false);
  });

  it('lip-sync seconds are billed on the ceiling, whole seconds, rounded up', () => {
    expect(creditsFor('lipsync_second', 30)).toBe(600);
    expect(creditsFor('lipsync_second', 29.2)).toBe(600);
    expect(creditsFor('lipsync_second', 30.001)).toBe(620);
  });

  it('the typical 30s ad lands near 675 credits, about 7 ads per pack', () => {
    const typicalAd =
      creditsFor('image_draft', 2) +
      creditsFor('image_final', 1) +
      creditsFor('voice_take', 3) +
      creditsFor('lipsync_second', 30);
    expect(typicalAd).toBe(675);
    expect(Math.floor(PACK_CREDITS / typicalAd)).toBe(7);
  });

  it('unknown op codes throw instead of silently billing zero', () => {
    expect(() => creditsFor('nonsense' as never, 1)).toThrow();
  });
});
