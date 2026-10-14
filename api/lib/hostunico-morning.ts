// Morning leads for Pedro (Hugo, 2026-10-14). Pure helpers for
// api/cron/hostunico-morning-leads.ts, so the rules are unit tested.
// Nothing here sends a call, text or email.

export interface MorningSettings {
  enabled: boolean;
  target_ready: number;
  max_new_listings: number;
  max_reports: number;
  daily_leads: number;
}
export const MORNING_DEFAULTS: MorningSettings = { enabled: true, target_ready: 150, max_new_listings: 150, max_reports: 200, daily_leads: 100 };

export function morningSettings(raw: string | null | undefined): MorningSettings {
  let v: Record<string, unknown> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { /* defaults below */ }
  const n = (key: keyof MorningSettings, max: number) => {
    const x = v[key];
    return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : MORNING_DEFAULTS[key] as number;
  };
  return { enabled: v.enabled !== false, target_ready: n('target_ready', 1000), max_new_listings: n('max_new_listings', 1000), max_reports: n('max_reports', 500), daily_leads: n('daily_leads', 1000) };
}

/** London date, weekday (0 Sunday) and minutes past midnight. */
export function londonClock(at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(at).map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Monday to Saturday, from 05:45 to 10:00 London. The cron fires in UTC, so this keeps it right across the clock change. */
export function morningWindowOpen(at: Date) {
  const c = londonClock(at);
  return c.weekday >= 1 && c.weekday <= 6 && c.minutes >= 5 * 60 + 45 && c.minutes < 10 * 60;
}

/** Warn when ready leads plus stock would not cover two days of calling. */
export function morningLevel(ready: number, stock: number, settings: MorningSettings, vpsBlocked = false): 'info' | 'warn' | 'blocked' {
  if (vpsBlocked) return 'blocked';
  return ready + stock < 2 * settings.daily_leads ? 'warn' : 'info';
}

export interface ReportListing { id: string; hostunico_uplift_status: string | null; report_property: unknown; photo_urls: string[] | null }
/** The property a contact's report is made for: a qualifying one first, then one still being researched. */
export function pickReportListing<T extends ReportListing>(listings: T[]): T | null {
  const usable = listings.filter((l) => l.report_property && (l.photo_urls?.length ?? 0) > 0);
  return usable.find((l) => l.hostunico_uplift_status === 'eligible') || usable.find((l) => l.hostunico_uplift_status === 'pending') || null;
}

/** "Unfurnished" stated on the advert or its type, so the report can say so. */
export function listingUnfurnished(listing: { summary?: string | null; property_type?: string | null }) {
  return /\bunfurnished\b/i.test(`${listing.summary || ''} ${listing.property_type || ''}`);
}

export async function inBatches<T>(items: T[], size: number, deadline: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length && Date.now() < deadline; i += size) await Promise.all(items.slice(i, i + size).map(run));
}
