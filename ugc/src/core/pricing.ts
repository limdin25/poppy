// THE pricing canon. The Supabase seed (supabase/migrations), the UI credit
// meter, the enqueue RPC cost table and the bench harness all derive from this
// file; tests/unit/pricing.test.ts holds the no-loss invariant and
// pricing-seed.test.ts (step 5) holds the SQL seed to this exact shape.
//
// Worst-case assumptions, on purpose:
// - FX 1 GBP = 1.20 USD (weak pound). Costs are billed in USD, revenue in GBP.
// - Stripe worst case 3.25% + 20p (international card).
// - Every provider priced at the HIGHEST figure any source claims, not the
//   likely one. Kling Avatar sources conflict at $0.044-0.115/s: we assume
//   0.115 until the bake-off reads the real bill, then the price book row can
//   come down (it is a DB row, not a deploy).

export const CREDIT_VALUE_GBP = 0.01;
export const PACK_PRICE_GBP = 49;
export const PACK_CREDITS = 4900;
export const FX_USD_PER_GBP = 1.2;
export const STRIPE_FEE_RATE = 0.0325;
export const STRIPE_FEE_FIXED_GBP = 0.2;
export const MIN_MARGIN_MULTIPLE = 2.0;

export type OpCode =
  | 'image_draft'
  | 'image_final'
  | 'voice_take'
  | 'voice_clone'
  | 'lipsync_second'
  | 'broll_second';

export type OpUnit = 'image' | 'take' | 'clone' | 'second';

export interface PriceBookRow {
  opCode: OpCode;
  creditsPerUnit: number;
  unit: OpUnit;
  active: boolean;
  worstCaseUnitCostUsd: number;
  note: string;
}

export const PRICE_BOOK: PriceBookRow[] = [
  {
    opCode: 'image_draft',
    creditsPerUnit: 15,
    unit: 'image',
    active: true,
    worstCaseUnitCostUsd: 0.067,
    note: 'Nano Banana 2 (gemini-3.1-flash-image), the drafting tier',
  },
  {
    opCode: 'image_final',
    creditsPerUnit: 30,
    unit: 'image',
    active: true,
    worstCaseUnitCostUsd: 0.134,
    note: 'Nano Banana Pro (gemini-3-pro-image) at 2K',
  },
  {
    opCode: 'voice_take',
    creditsPerUnit: 5,
    unit: 'take',
    active: true,
    worstCaseUnitCostUsd: 0.02,
    note: 'Fish s2.1-pro, up to 1200 chars; padded above the ~$0.007 estimate for after the free tier ends 2026-08-31',
  },
  {
    opCode: 'voice_clone',
    creditsPerUnit: 100,
    unit: 'clone',
    active: true,
    worstCaseUnitCostUsd: 0,
    note: 'Fish instant clone is free-tier; the 100 credits are an abuse buffer, not a cost recovery',
  },
  {
    opCode: 'lipsync_second',
    creditsPerUnit: 20,
    unit: 'second',
    active: true,
    worstCaseUnitCostUsd: 0.115,
    note: 'Kling Avatar 2.0 Standard at the conflict-ceiling price; likely 0.056, bake-off verifies, then this row can drop to ~12',
  },
  {
    opCode: 'broll_second',
    creditsPerUnit: 75,
    unit: 'second',
    active: false,
    worstCaseUnitCostUsd: 0.3,
    note: 'Seedance 2.0: origin claims $0.03/s, fal charges $0.30/s. Stays OFF until the bake-off reads a real origin bill',
  },
];

function row(op: OpCode): PriceBookRow {
  const found = PRICE_BOOK.find((r) => r.opCode === op);
  if (!found) throw new Error(`Unknown op code: ${op}`);
  return found;
}

// Units are billed whole: a 29.2s clip is 30 billable seconds. Fractional
// images or takes do not exist, but ceil keeps that true if anyone tries.
export function creditsFor(op: OpCode, units: number): number {
  return row(op).creditsPerUnit * Math.ceil(units);
}

export function packNetRevenueGbp(): number {
  return PACK_PRICE_GBP - (PACK_PRICE_GBP * STRIPE_FEE_RATE + STRIPE_FEE_FIXED_GBP);
}

// Provider cost in GBP if a user burns the ENTIRE pack on one op at the
// worst-case unit price. The invariant test requires this to stay below net
// revenue for every active op: the shape of "we cannot lose money".
export function worstCaseBurnProviderCostGbp(op: OpCode): number {
  const r = row(op);
  const units = PACK_CREDITS / r.creditsPerUnit;
  return (units * r.worstCaseUnitCostUsd) / FX_USD_PER_GBP;
}
