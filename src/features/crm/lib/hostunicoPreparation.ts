export type ReportPreparationTotals = { ready: number; preparing: number; needsDetails: number; failed: number };
type Batch = Partial<ReportPreparationTotals> & { nextOffset?: number | null };

export async function refreshHostunicoReports(
  requestBatch: (offset: number) => Promise<Batch>,
  update: (totals: ReportPreparationTotals, checking: boolean) => void,
  cancelled: () => boolean,
) {
  const totals: ReportPreparationTotals = { ready: 0, preparing: 0, needsDetails: 0, failed: 0 };
  let offset: number | null = 0;
  while (offset !== null && !cancelled()) {
    const result = await requestBatch(offset);
    if (cancelled()) break;
    for (const key of Object.keys(totals) as (keyof ReportPreparationTotals)[]) totals[key] += Number(result[key]) || 0;
    const next = result.nextOffset ?? null;
    if (next !== null && (!Number.isInteger(next) || next <= offset || next >= 500)) throw new Error('Report queue cursor did not advance.');
    offset = next;
    // Twenty ready reports are a buffer, not permission to starve held leads.
    // Refresh the existing reports throughout the bounded queue window.
    update({ ...totals }, offset !== null);
  }
  return totals;
}
