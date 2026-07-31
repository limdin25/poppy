// Ledger arithmetic and idempotency: replays are no-ops, refunds compensate
// exactly, clawbacks floor at zero.

import { describe, it, expect } from 'vitest';
import {
  applyEntry,
  balance,
  purchaseEntry,
  debitEntry,
  refundEntry,
  clawbackEntry,
  type LedgerEntry,
} from '../../src/core/ledger';

const AT = '2026-07-31T12:00:00Z';

describe('ledger', () => {
  it('a purchase applied twice credits once (webhook replay safety)', () => {
    const p = purchaseEntry('cs_123', 'u1', 4900, AT);
    let entries: LedgerEntry[] = [];
    entries = applyEntry(entries, p);
    entries = applyEntry(entries, p);
    expect(entries).toHaveLength(1);
    expect(balance(entries)).toBe(4900);
  });

  it('debit and refund cancel exactly, and a refund cannot happen twice', () => {
    let entries: LedgerEntry[] = [purchaseEntry('cs_1', 'u1', 4900, AT)];
    entries = applyEntry(entries, debitEntry('job-1', 'u1', 675, AT));
    expect(balance(entries)).toBe(4225);
    const refund = refundEntry(entries, 'job-1', AT);
    entries = applyEntry(entries, refund);
    entries = applyEntry(entries, refund);
    expect(balance(entries)).toBe(4900);
  });

  it('a refund without a matching debit throws instead of inventing credits', () => {
    expect(() => refundEntry([], 'job-x', AT)).toThrow();
  });

  it('a clawback takes back the pack but floors at zero', () => {
    let entries: LedgerEntry[] = [purchaseEntry('cs_1', 'u1', 4900, AT)];
    entries = applyEntry(entries, debitEntry('job-1', 'u1', 4000, AT));
    // Balance is 900; the chargeback wants 4900 back but can only take 900.
    const claw = clawbackEntry(entries, 'cs_1', AT);
    entries = applyEntry(entries, claw);
    expect(balance(entries)).toBe(0);
  });

  it('entries with nonsense amounts are refused at construction', () => {
    expect(() => purchaseEntry('cs', 'u1', 0, AT)).toThrow();
    expect(() => purchaseEntry('cs', 'u1', -5, AT)).toThrow();
    expect(() => debitEntry('j', 'u1', 0, AT)).toThrow();
    expect(() => debitEntry('j', 'u1', -5, AT)).toThrow();
  });
});
