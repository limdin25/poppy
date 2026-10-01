export type HostunicoUpliftStatus = 'eligible' | 'excluded' | 'pending';
export const HOSTUNICO_UPLIFT_BLOCK = 'This property does not meet the minimum 30% earnings uplift. Do not pitch or send its report.';
export const HOSTUNICO_UPLIFT_PENDING = 'Research must confirm at least 30% above the asking rent before this property can be called or sent.';

export function hostunicoUplift(state: unknown, value: unknown, rentPcm: unknown): { status: HostunicoUpliftStatus; message: string } {
  if (typeof rentPcm === 'string' && /^\d+(?:\.\d{1,2})?$/.test(rentPcm)) rentPcm = Number(rentPcm);
  const p = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const monthly = p.monthlyGbpPence;
  const rent = p.askingRentGbpPence;
  if (state !== 'ready' || p.planning === true || typeof monthly !== 'number' || !Number.isSafeInteger(monthly) || monthly <= 0
    || typeof rent !== 'number' || !Number.isSafeInteger(rent) || rent <= 0
    || typeof rentPcm !== 'number' || !Number.isFinite(rentPcm) || rentPcm <= 0 || Math.round(rentPcm * 100) !== rent) {
    return { status: 'pending', message: HOSTUNICO_UPLIFT_PENDING };
  }
  return BigInt(monthly) * 100n >= BigInt(rent) * 130n
    ? { status: 'eligible', message: 'Research meets the minimum 30% earnings uplift.' }
    : { status: 'excluded', message: HOSTUNICO_UPLIFT_BLOCK };
}

// All outbound paths use the database check, including a pasted report link.
// Database errors fail closed. A second property on the same contact does not
// make a failing report eligible.
export async function hostunicoOutreachAllowed(db: { rpc: (name: string, args: Record<string, unknown>) => any }, contactId: string, body = '', listingId: string | null = null): Promise<boolean> {
  const result = await db.rpc('wk_hostunico_outreach_allowed', { p_contact: contactId, p_body: body, p_listing: listingId });
  return !result.error && result.data === true;
}
