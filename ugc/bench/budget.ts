// The bake-off's money guard, pure so the unit suite can prove it refuses.
// Estimates are conflict-CEILING prices on purpose: the guard must hold even
// if every disputed price resolves against us. Real billed cost is measured
// separately (fal balance before/after) and recorded next to the estimate.

export const EST_USD = {
  image_draft: 0.067,
  image_final: 0.134,
  // fal-hosted Nano Banana (used while the direct Google key awaits billing);
  // ceilings above fal's listed per-image prices.
  fal_image: 0.05,
  fal_image_pro: 0.3,
  voice_take: 0.01,
  kling_std_second: 0.115,
  kling_pro_second: 0.23,
  omnihuman_second: 0.16,
  seedance_video_480p: 1.1,
} as const;

export interface SpendEntry {
  key: string;
  estUsd: number;
  requestId?: string;
  realUsd?: number;
  ts: string;
}

// A measured real bill (settled balance delta) beats the ceiling estimate;
// entries not yet measured keep their estimate. The guard therefore tracks
// truth where truth exists and stays pessimistic where it does not.
export function spentUsd(entries: SpendEntry[]): number {
  return entries.reduce((sum, e) => sum + (Number.isFinite(e.realUsd) ? (e.realUsd as number) : e.estUsd), 0);
}

// Throws BEFORE a submission would take the ledger past the budget. The cap
// is the plan's hard rule: the harness refuses, it does not warn.
export function assertWithinBudget(entries: SpendEntry[], nextEstUsd: number, budgetUsd: number): void {
  if (!(budgetUsd > 0)) throw new Error(`Bench budget must be positive, got ${budgetUsd}`);
  if (!(nextEstUsd >= 0)) throw new Error(`Bad spend estimate: ${nextEstUsd}`);
  const total = spentUsd(entries) + nextEstUsd;
  // NaN > cap is false, so a corrupt ledger entry would otherwise fail OPEN.
  if (!Number.isFinite(total)) {
    throw new Error(`Budget guard: spend ledger is corrupt (total ${total}); fix bench/out/state.json before submitting`);
  }
  if (total > budgetUsd + 1e-9) {
    throw new Error(
      `Budget guard: refusing a ~$${nextEstUsd.toFixed(2)} submission. ` +
        `Spent (estimated) $${spentUsd(entries).toFixed(2)} of $${budgetUsd.toFixed(2)}.`,
    );
  }
}
