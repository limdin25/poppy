import { callbackDisplayNumber, callbackFirstName, callbackSmsLine, type HostunicoCallback } from '../../supabase/functions/_shared/hostunico-callback.js';
export interface ReportProperty { postcode: string; bedrooms: number; bathrooms: number; wholeProperty: true; advertisedRentPcm?: number; areaEstimate?: true; areaLabel?: string }
export function reportProperty(value: unknown): ReportProperty | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  const postcode = String(p.postcode ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  const area = p.areaEstimate === true;
  if (!(area ? /^[A-Z]{1,2}\d[A-Z\d]?$/.test(postcode) : /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(postcode)) || p.wholeProperty !== true) return null;
  if (![p.bedrooms, p.bathrooms].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 12)) return null;
  if (p.advertisedRentPcm != null && (typeof p.advertisedRentPcm !== 'number' || !Number.isFinite(p.advertisedRentPcm) || p.advertisedRentPcm <= 0 || p.advertisedRentPcm > 100000)) return null;
  return { postcode, bedrooms: p.bedrooms as number, bathrooms: p.bathrooms as number, wholeProperty: true, ...(p.advertisedRentPcm ? { advertisedRentPcm: p.advertisedRentPcm as number } : {}), ...(area ? { areaEstimate: true as const, areaLabel: String(p.areaLabel || postcode).slice(0, 120) } : {}) };
}
export const REPORT_AHEAD = 20;
export const REPORT_SCAN_LIMIT = 500;
export function cachedReportReady(row: { state?: string; report_url?: string; created_at?: string } | null) {
  return row?.state === 'ready' && /^https:\/\/hostunico\.com\/r\/[A-Za-z0-9]{5}$/.test(row.report_url || '')
    && Date.now() - Date.parse(row.created_at || '') < 29 * 86400000;
}
export const HOSTUNICO_CAMPAIGN = '5d9657f9-d9b4-4e27-a2d1-83db80867f92';
export const HOSTUNICO_PIPELINE = 'dadce4ac-90b5-4320-9291-ff6bb1cf89f0';
export function reportSms(url: string, areaEstimate = false, callback: HostunicoCallback | null = null) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://hostunico.com' || !/^\/r\/[A-Za-z0-9]{5}$/.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Invalid property report link');
  const text = `Hi, here's your Hostunico ${areaEstimate ? 'area estimate' : 'property report'}: ${url}\nLet me know what you think.`;
  return callback ? `${text}\n${callbackSmsLine(callback)}` : text;
}

interface CallbackDb { from(table: string): any }
/** The sending agent's own caller id, else the Hostunico campaign SMS number. Null when neither resolves. */
export async function hostunicoCallback(supa: CallbackDb, agentId: string): Promise<(HostunicoCallback & { e164: string }) | null> {
  try {
    const { data: profile } = await supa.from('profiles').select('name,default_caller_id_number_id').eq('id', agentId).maybeSingle();
    const name = callbackFirstName(profile?.name);
    let e164: string | undefined;
    if (profile?.default_caller_id_number_id) {
      const { data: own } = await supa.from('wk_numbers').select('e164,is_active').eq('id', profile.default_caller_id_number_id).maybeSingle();
      if (own?.is_active !== false) e164 = own?.e164;
    }
    if (!callbackDisplayNumber(e164)) {
      const { data: pinned } = await supa.from('wk_campaign_numbers').select('priority,wk_numbers!inner(e164,is_active,channel)').eq('campaign_id', HOSTUNICO_CAMPAIGN).order('priority').limit(10);
      const first = ((pinned || []) as { wk_numbers: { e164: string; is_active: boolean; channel: string } }[]).find((r) => r.wk_numbers?.is_active !== false && r.wk_numbers?.channel === 'sms');
      e164 = first?.wk_numbers.e164;
    }
    const number = callbackDisplayNumber(e164);
    return number && e164 ? { e164, number, name } : null;
  } catch {
    return null;
  }
}
