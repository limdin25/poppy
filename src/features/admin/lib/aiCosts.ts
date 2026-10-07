// Admin, AI Costs. Everything the page works out that is not drawing: money
// formatting, the date ranges behind the preset buttons, the list of bars for
// the chart and how each bar splits across models.

export interface CostTotals {
  cost: number; calls: number; input_tokens: number; output_tokens: number; cached_tokens: number;
  units: number; errors: number; unpriced: number; fallbacks: number;
}
export interface SeriesPoint { bucket: string; provider: string; model: string; cost: number; calls: number }
export interface ModelRow {
  provider: string; model: string; calls: number; input_tokens: number; output_tokens: number;
  cached_tokens: number; units: number; cost: number; errors: number; unpriced: number;
}
export interface FeatureRow { feature: string; calls: number; input_tokens: number; output_tokens: number; units: number; cost: number }
export interface ProviderRow { provider: string; calls: number; cost: number }
export interface RecentCall {
  at: string; provider: string; model: string; feature: string; input_tokens: number; output_tokens: number;
  units: number; cost: number; ok: boolean; priced: boolean; requested_model: string | null; latency_ms: number | null;
}
export interface CostOverview {
  from: string; to: string; bucket: Bucket; bucket_forced: boolean;
  totals: CostTotals; series: SeriesPoint[]; by_model: ModelRow[]; by_feature: FeatureRow[]; by_provider: ProviderRow[];
  recent: RecentCall[];
  options: { providers: string[]; models: string[]; features: string[] };
  periods: { today: number; yesterday: number; last7: number; month: number; projected_month: number };
  first_recorded: string | null;
  usd_to_gbp: number | null;
}

export type Bucket = 'hour' | 'day';
export type PresetKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

// ---- money and numbers -----------------------------------------------------

function scaled(n: number): string {
  const v = Math.abs(n);
  if (v === 0) return '0';
  if (v >= 1000) return Math.round(v).toLocaleString('en-GB');
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(3);
  return v.toFixed(4);
}
export const usd = (n: number | null | undefined) => `$${scaled(Number(n) || 0)}`;
/** The pound figure beside the dollars. Nothing when no rate is set. */
export const gbp = (n: number | null | undefined, rate: number | null | undefined) =>
  rate && rate > 0 ? `£${scaled((Number(n) || 0) * rate)}` : '';

export function tokens(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

// ---- dates (London calendar days as plain YYYY-MM-DD strings) ----------------

const MS_DAY = 86_400_000;
const asUtc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const asDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => asDay(asUtc(d) + n * MS_DAY);
export const daysBetween = (from: string, to: string) => Math.round((asUtc(to) - asUtc(from)) / MS_DAY) + 1;
export const londonToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now);

export const PRESETS: Array<{ key: Exclude<PresetKey, 'custom'>; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
];

/** The dates behind a preset, and the bar size that suits it. */
export function presetRange(key: Exclude<PresetKey, 'custom'>, today: string): { from: string; to: string; bucket: Bucket } {
  switch (key) {
    case 'today': return { from: today, to: today, bucket: 'hour' };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y, bucket: 'hour' }; }
    case '7d': return { from: addDays(today, -6), to: today, bucket: 'day' };
    case '30d': return { from: addDays(today, -29), to: today, bucket: 'day' };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today, bucket: 'day' };
  }
}

// ---- the chart -------------------------------------------------------------

/** Every bar from the first to the last, so a quiet hour shows as a gap and not as a missing bar. */
export function buildBuckets(from: string, to: string, bucket: Bucket): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (bucket === 'day') out.push(d);
    else for (let h = 0; h < 24; h++) out.push(`${d}T${String(h).padStart(2, '0')}:00`);
  }
  return out;
}

/** The database answers 2026-10-07T09:00 for an hour and 2026-10-07T00:00 for a day. */
export const bucketKey = (raw: string, bucket: Bucket) => (bucket === 'day' ? raw.slice(0, 10) : `${raw.slice(0, 13)}:00`);

export const OTHER_KEY = 'other|other';
export const modelKey = (provider: string, model: string) => `${provider}|${model}`;

// Blue first (the brand), then colours that stay apart from each other and from it.
export const PALETTE = ['#2563eb', '#f59e0b', '#14b8a6', '#8b5cf6', '#ef4444', '#0ea5e9', '#84cc16', '#ec4899'];
export const OTHER_COLOUR = '#94a3b8';

export interface StackModel { key: string; provider: string; model: string; total: number; colour: string }
export interface StackRow { bucket: string; total: number; calls: number; parts: Record<string, number> }

/** The biggest `top` models keep their own colour, the rest share one grey "Other". */
export function stackSeries(series: SeriesPoint[], buckets: string[], bucket: Bucket, top = 8): { models: StackModel[]; rows: StackRow[]; max: number } {
  const totals = new Map<string, StackModel>();
  for (const p of series) {
    const key = modelKey(p.provider, p.model);
    const m = totals.get(key) ?? { key, provider: p.provider, model: p.model, total: 0, colour: '' };
    m.total += p.cost;
    totals.set(key, m);
  }
  const ranked = [...totals.values()].sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));
  const kept = ranked.slice(0, top).map((m, i) => ({ ...m, colour: PALETTE[i % PALETTE.length] }));
  const keptKeys = new Set(kept.map((m) => m.key));
  const rest = ranked.slice(top);
  const models: StackModel[] = rest.length
    ? [...kept, { key: OTHER_KEY, provider: 'other', model: `Other (${rest.length} models)`, total: rest.reduce((s, m) => s + m.total, 0), colour: OTHER_COLOUR }]
    : kept;

  const byBucket = new Map<string, StackRow>(buckets.map((b) => [b, { bucket: b, total: 0, calls: 0, parts: {} }]));
  for (const p of series) {
    const row = byBucket.get(bucketKey(p.bucket, bucket));
    if (!row) continue;
    const key = keptKeys.has(modelKey(p.provider, p.model)) ? modelKey(p.provider, p.model) : OTHER_KEY;
    row.parts[key] = (row.parts[key] ?? 0) + p.cost;
    row.total += p.cost;
    row.calls += p.calls;
  }
  const rows = buckets.map((b) => byBucket.get(b)!);
  return { models, rows, max: rows.reduce((m, r) => Math.max(m, r.total), 0) };
}

/** An axis top that gives tidy gridlines without wasting the height:
 *  0.37 becomes 0.4, 0.57 becomes 0.6, 8.2 becomes 10. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => f <= n + 1e-9) ?? 10;
  return Math.round(nice * exp * 1e9) / 1e9;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function bucketLabel(key: string, bucket: Bucket): string {
  const [date, time] = key.split('T');
  const [, m, d] = date.split('-').map(Number);
  return bucket === 'day' ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${time}`;
}
