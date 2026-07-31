// Helpers for the Hotmart purchase webhook (PIX model).
//
// In the PIX model NextPubli is the single seller/affiliate. Each influencer's share
// link carries their referral_tag as Hotmart's `sck` (source) parameter; Hotmart echoes
// it back on the purchase webhook. We pull that tag out to attribute the sale, and we
// compute the influencer's commission ourselves (Hotmart's own affiliate-commission
// value doesn't apply here).

type Data = Record<string, unknown>;

function path(data: Data, keys: string[]): string | null {
  let cur: unknown = data;
  for (const key of keys) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  const value = typeof cur === "string" ? cur.trim() : "";
  return value.length > 0 ? value : null;
}

// Candidate locations of the sck/source tag in the Hotmart v2 webhook `data`, in
// priority order. VERIFY against a real sandbox webhook; extra paths are harmless.
const SCK_PATHS: string[][] = [
  ["purchase", "tracking", "source"],
  ["purchase", "sck"],
  ["purchase", "tracking", "external_code"],
  ["purchase", "sckPaymentLink"],
  ["sck"],
];

/** Pull the influencer's tracking tag (`sck`) out of a Hotmart webhook `data` object, or null. */
export function extractSck(data: Data): string | null {
  for (const keys of SCK_PATHS) {
    const value = path(data, keys);
    if (value) return value;
  }
  return null;
}

/** Influencer commission = saleAmount × rate, rounded to 2 decimals. Guards bad inputs. */
export function computeCommission(saleAmount: number, rate: number): number {
  if (!(saleAmount > 0) || !(rate > 0)) return 0;
  return Math.round(saleAmount * rate * 100) / 100;
}
