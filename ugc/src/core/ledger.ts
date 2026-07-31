// The credit ledger as a pure reducer. The database RPCs are the enforcement
// point (SECURITY DEFINER, one transaction with the balance row); this module
// is the same arithmetic for the UI and for tests, and the idempotency rules
// live here so they are pinned by unit tests before the SQL exists.
//
// Idempotency is the entry key: purchase:<sessionId>, debit:<jobId>,
// refund:<jobId>, clawback:<sessionId>. Applying the same key twice is a
// no-op, which is what makes Stripe webhook replays and worker retries safe.

export type LedgerReason = 'purchase' | 'debit' | 'refund' | 'clawback' | 'adjustment';

export interface LedgerEntry {
  entryKey: string;
  userId: string;
  delta: number;
  reason: LedgerReason;
  jobId?: string;
  stripeSessionId?: string;
  createdAt: string;
}

export function applyEntry(entries: LedgerEntry[], next: LedgerEntry): LedgerEntry[] {
  if (entries.some((e) => e.entryKey === next.entryKey)) return entries;
  return [...entries, next];
}

export function balance(entries: LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.delta, 0);
}

export function purchaseEntry(sessionId: string, userId: string, credits: number, at: string): LedgerEntry {
  if (credits <= 0) throw new Error('A purchase must add credits');
  return {
    entryKey: `purchase:${sessionId}`,
    userId,
    delta: credits,
    reason: 'purchase',
    stripeSessionId: sessionId,
    createdAt: at,
  };
}

export function debitEntry(jobId: string, userId: string, credits: number, at: string): LedgerEntry {
  if (credits <= 0) throw new Error('A debit must remove credits');
  return { entryKey: `debit:${jobId}`, userId, delta: -credits, reason: 'debit', jobId, createdAt: at };
}

// A refund compensates its debit EXACTLY, keyed to the job so it can only
// happen once no matter how many times the worker retries the failure path.
export function refundEntry(entries: LedgerEntry[], jobId: string, at: string): LedgerEntry {
  const debit = entries.find((e) => e.entryKey === `debit:${jobId}`);
  if (!debit) throw new Error(`No debit found for job ${jobId}`);
  return {
    entryKey: `refund:${jobId}`,
    userId: debit.userId,
    delta: -debit.delta,
    reason: 'refund',
    jobId,
    createdAt: at,
  };
}

// A Stripe chargeback claws the pack back but never pushes the balance below
// zero (the user may have already spent some of it; the flagged account is
// the recourse, not a negative balance).
export function clawbackEntry(entries: LedgerEntry[], sessionId: string, at: string): LedgerEntry {
  const purchase = entries.find((e) => e.entryKey === `purchase:${sessionId}`);
  if (!purchase) throw new Error(`No purchase found for session ${sessionId}`);
  const current = balance(entries.filter((e) => e.userId === purchase.userId));
  const take = Math.min(purchase.delta, Math.max(0, current));
  return {
    entryKey: `clawback:${sessionId}`,
    userId: purchase.userId,
    delta: -take,
    reason: 'clawback',
    stripeSessionId: sessionId,
    createdAt: at,
  };
}
