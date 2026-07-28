// Site demo funnel: server-side shared helpers.
//
// Standalone by design. Nothing here imports from or writes to the VSL funnel
// (wk_vsl_pages, wk_vsl_events, api/vsl/*). The two funnels are separate
// experiments and must be able to change without touching each other.
//
// The pure decision logic deliberately does NOT live here. The escalation
// ladder is in src/core/site-demo/ladder.ts with no supabase import, so the
// cron, the unit tests and the board all share one schedule.

import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const SITE_DEMO_SETTINGS_KEY = 'site_demo_settings';

/** The demo receptionist line. Its own env var so it can move without a deploy. */
export const DEMO_LINE_E164 = process.env.SITE_DEMO_FROM_NUMBER || '+447576558278';

export interface SiteDemoSettings {
  /**
   * Master switch. DEFAULTS TO FALSE: nothing generates, nudges, calls or
   * charges until Hugo flips this at go-live. The whole feature is dark until
   * then, which is what makes it safe to ship the code ahead of the decision.
   */
  enabled: boolean;
  /** Local time, Europe/London. No lead gets a text outside this window. */
  quiet_hours: { start: string; end: string };
  /** Outbound AI call attempts before we stop. Two, then leave them alone. */
  max_outbound_calls: number;
  /** Per-run cap on the ladder cron, so one bad query cannot text everybody. */
  max_per_run: number;
  /** Arms the "Get started" close and the checkout route. */
  checkout_enabled: boolean;
  /** Arms the on-page chat widget. */
  chat_enabled: boolean;
}

export const DEFAULT_SITE_DEMO_SETTINGS: SiteDemoSettings = {
  enabled: false,
  quiet_hours: { start: '09:00', end: '20:00' },
  max_outbound_calls: 2,
  max_per_run: 25,
  checkout_enabled: true,
  chat_enabled: true,
};

export async function getSiteDemoSettings(): Promise<SiteDemoSettings> {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', SITE_DEMO_SETTINGS_KEY)
    .maybeSingle();
  if (!data?.value) return { ...DEFAULT_SITE_DEMO_SETTINGS };
  try {
    const parsed = JSON.parse(data.value) as Partial<SiteDemoSettings>;
    return {
      ...DEFAULT_SITE_DEMO_SETTINGS,
      ...parsed,
      quiet_hours: { ...DEFAULT_SITE_DEMO_SETTINGS.quiet_hours, ...(parsed.quiet_hours || {}) },
    };
  } catch {
    return { ...DEFAULT_SITE_DEMO_SETTINGS };
  }
}

export async function saveSiteDemoSettings(
  patch: Partial<SiteDemoSettings>,
): Promise<SiteDemoSettings> {
  const merged = { ...(await getSiteDemoSettings()), ...patch };
  await supabase.from('platform_settings').upsert({
    key: SITE_DEMO_SETTINGS_KEY,
    value: JSON.stringify(merged),
    updated_at: new Date().toISOString(),
  });
  return merged;
}

// ---------------------------------------------------------------------------
// Beacons
//
// The threat is concrete, not theoretical. page_id is printed in the public
// HTML and slugs are guessable, so without a signature anyone could POST a
// forged 'chat_message' or 'open' against a real lead's page, flip its state,
// and trip a real nudge SMS to a real business. The token is hour-bucketed so
// a captured one expires on its own.
//
// Its own secret. Deliberately NOT VSL_BEACON_SECRET: two funnels sharing one
// signing key means rotating either one breaks both.
// ---------------------------------------------------------------------------

export function hourBucket(now = Date.now()): number {
  return Math.floor(now / 3_600_000);
}

/** Empty string when unconfigured, which the page reads as "send nothing". */
export function beaconToken(pageId: string, bucket?: number): string {
  const secret = process.env.SITE_BEACON_SECRET || '';
  if (!secret) return '';
  const b = bucket ?? hourBucket();
  return createHmac('sha256', secret).update(`${pageId}:${b}`).digest('hex').slice(0, 32);
}

export type SiteEventType =
  | 'sent'
  | 'link_click'
  | 'open'
  | 'phone_tap'
  | 'chat_message'
  | 'call_started'
  | 'call_ended'
  | 'followup_sent'
  | 'outbound_call'
  | 'checkout_start'
  | 'converted';

/**
 * Always reads the insert error. A type missing from the CHECK constraint fails
 * with 23514, and on the VSL side that went unnoticed for weeks precisely
 * because nobody looked at the result.
 */
export async function logSiteEvent(
  pageId: string,
  type: SiteEventType,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.from('wk_site_events').insert({
    page_id: pageId,
    type,
    meta,
  });
  if (error) console.error('[site-demo] event insert failed:', type, error.message);
}

export interface SiteAdvanceResult {
  state: string;
  advanced: boolean;
  contact_id: string;
  first_click: boolean;
  first_open: boolean;
  first_chat: boolean;
  first_call: boolean;
  first_engage: boolean;
}

export interface SiteAdvanceExtra {
  bump_open?: boolean;
  link_click?: boolean;
  phone_tap?: boolean;
  chat?: boolean;
  call?: boolean;
  nudge?: boolean;
  outbound_call?: boolean;
  /** Written separately: the RPC owns the funnel columns, not this one. */
  business_id?: string | null;
}

/**
 * Forward-only state transition, under a row lock in the RPC.
 *
 * Does NOT touch wk_contacts.pipeline_column_id, and must never be made to.
 * That column is the agent's own call outcome; the VSL funnel wrote to it once
 * and destroyed the outcome on every lead it touched. See
 * 20260727000009_unhijack_pipeline.sql.
 */
export async function advanceSiteState(
  page: { id: string },
  target: string | null,
  extra: SiteAdvanceExtra = {},
): Promise<SiteAdvanceResult | null> {
  const { data, error } = await supabase.rpc('wk_site_advance', {
    p_page_id: page.id,
    p_target: target,
    p_bump_open: extra.bump_open ?? false,
    p_link_click: extra.link_click ?? false,
    p_phone_tap: extra.phone_tap ?? false,
    p_chat: extra.chat ?? false,
    p_call: extra.call ?? false,
    p_nudge: extra.nudge ?? false,
    p_outbound_call: extra.outbound_call ?? false,
  });
  if (error) console.error('[site-demo] advance failed:', error.message);

  if (extra.business_id) {
    await supabase.from('wk_site_pages').update({ business_id: extra.business_id }).eq('id', page.id);
  }

  const row = (Array.isArray(data) ? data[0] : data) as SiteAdvanceResult | undefined;
  return row ?? null;
}

/** The public URL for a site. One place, so the SMS and the OG tag agree. */
export function siteUrl(slug: string): string {
  const base = process.env.SITE_DEMO_BASE_URL || 'https://heyelsie.com';
  return `${base.replace(/\/+$/, '')}/s/${slug}`;
}

export { supabase as siteDemoDb };
