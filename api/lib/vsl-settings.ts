// VSL funnel settings + shared helpers. One platform_settings JSON key,
// mirroring api/lib/brrr.ts. Everything the funnel needs to be reconfigured
// without a deploy lives here: templates, delays, quiet hours, CTA A/B labels.

import { createClient } from '@supabase/supabase-js';
import { REVIEW_PLANS, requestsLabel } from './review-plans.js';
import {
  DEFAULT_VSL_RULES,
  VSL_RULE_KEYS,
  type VslRule,
  type VslRuleKey,
  type VslRules,
} from './vsl-sequence.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// The rules themselves live in vsl-sequence.ts, which has no supabase import so
// the cron, the tests and the funnel drawer can all read the same schedule.
// Re-exported here because everything already imports rules from this file.
export type { VslRule, VslRuleKey, VslRules };

/** Which funnel events email. Every one still lands in the bell regardless —
 *  these only gate the email, so Hugo can dial the volume down without a
 *  deploy. Defaults are all on: he asked for every event (2026-07-26). */
export interface VslNotifySettings {
  sent: boolean;
  link_click: boolean;
  open: boolean;
  play: boolean;
  calc: boolean;
  watched_50: boolean;
  watched_90: boolean;
  watched_100: boolean;
  cta_click: boolean;
  checkout_start: boolean;
  paid: boolean;
}

export interface VslSettings {
  enabled: boolean;                       // master switch — feature dark until true
  default_video_url: string;             // fallback when a page has no per-lead render
  send_template: string;                 // the SMS the agent sends with the link
  send_template_no_site: string;         // variant for leads with no website
  cta_labels: { a: string; b: string };  // button A/B
  watched_threshold_pct: number;         // % progress that counts as "watched"
  quiet_hours: { start: string; end: string }; // Europe/London, automation only
  agent_disabled: string[];              // agent ids opted out of automation
  spots_per_town: number;                // scarcity line pool size
  proof_image_url: string;               // before/after proof shown below the CTA
  proof_caption: string;                 // one-line caption above the proof
  notify: VslNotifySettings;             // which events send an email
  rules: VslRules;                       // the 14 follow-ups + the welcome
}

/** Watch-coverage markers the page reports. 50/90/100 are the ones Hugo asked
 *  for by name; 10/25/75 fill in the drop-off curve on the board. */
export const VSL_PROGRESS_MARKERS = [10, 25, 50, 75, 90, 100] as const;

/** Markers newly crossed by a beacon that moved coverage `before` → `after`.
 *  The dedupe primitive: a reload, a rewind or a replayed beacon returns [],
 *  so each milestone notifies exactly once. Inclusive at the marker itself. */
export function crossedMilestones(before: number, after: number): number[] {
  if (!(after > before)) return [];
  return VSL_PROGRESS_MARKERS.filter((m) => m > before && m <= after);
}

// Derived from the canon — NOT a second price table. The hand-written version
// this replaced advertised Pro as "up to 200 review requests a month" while
// capForPlan() enforced 300, so a lead was quoted a smaller product than they
// were billed for.
export const VSL_PRICES: Record<string, {
  plan: string; label: string; monthly: string; requests: string; popular: boolean;
}> = Object.fromEntries(
  REVIEW_PLANS.map((p) => [p.stripePriceId, {
    plan: p.key,
    label: p.name,
    monthly: `£${p.priceGbp}`,
    requests: requestsLabel(p).toLowerCase(),
    popular: !!p.popular,
  }]),
);
// One-time "first 10 days" pound, created 2026-07-25 under prod_Uv8eim0pBOmEGZ.
export const VSL_POUND_PRICE = process.env.VSL_POUND_PRICE || 'price_1Tx5miLdAEhwWg6wqTTWjQsC';

/** The message itself. Both variants send THIS; the no-website one only adds a
 *  P.S. Built from one constant so they cannot drift apart, because they are
 *  not meant to differ (Hugo 2026-07-27: "the audit is always from Google
 *  anyway, so the message should be the same").
 *
 *  Must echo the exact words the agent just said on the phone, "a 2-minute
 *  audit", or the text reads like a different offer arriving from a stranger
 *  (Hugo 2026-07-26, the new video-first call).
 *
 *  It said "90-second" until 2026-07-27. The video is 2:35. Promising 90
 *  seconds and then opening a player that reads 2:35 is the exact thing our
 *  own script warns against ("never say a minute and then send five"), and
 *  every lead saw it. Hugo: "lets call it a 2 minutes videos."
 *
 *  Laid out in paragraphs with the link on its own line: it lands on a phone,
 *  where a single run-on sentence hides the one thing we want tapped. Every
 *  character is GSM-7 (see api/lib/sms-charset.ts). NO LONG DASHES, ever
 *  (Hugo 2026-07-27): tests/message-copy.test.ts fails the build if one
 *  comes back. */
const VIDEO_SMS =
  "Hi {first}, it's {agent} from HeyElsie.\n\n" +
  "Here's the 2-minute video I just mentioned for {business}:\n{url}\n\n" +
  'Any questions, just message me here any time.';

/** The free-website offer, REINSTATED by Hugo on 2026-07-27 after he withdrew
 *  it on 2026-07-26. It rides only the no-website variant, as a P.S. after the
 *  same message everyone else gets, so a lead who already has a site is never
 *  told we could not find one. Costs a third SMS segment; Hugo asked for it
 *  knowing the message gets longer. */
const FREE_SITE_PS =
  "By the way, I couldn't find a website for you. If you haven't got one, " +
  "we're happy to make you one for free, just let us know.";

export const DEFAULT_VSL_SETTINGS: VslSettings = {
  enabled: false,
  default_video_url: '',
  send_template: VIDEO_SMS,
  // Identical, plus the free-website P.S. The earlier version of this variant
  // explained that the audit ran "from your Google listing instead", which was
  // wrong: it runs from Google either way, so that read as a difference where
  // there is none.
  send_template_no_site: `${VIDEO_SMS}\n\n${FREE_SITE_PS}`,
  cta_labels: { a: 'Start getting reviews', b: 'Get my reviews rolling' },
  watched_threshold_pct: 50,
  quiet_hours: { start: '08:00', end: '20:00' },
  agent_disabled: [],
  spots_per_town: 5,
  proof_image_url: '',
  // blank = the page's own default ("Examples of businesses that invest in
  // reviews") — examples wording, never a client claim (Hugo 2026-07-26)
  proof_caption: '',
  // Hugo 2026-07-26: "email notification for all action". Every event on by
  // default; untick here to quieten one without a deploy.
  notify: {
    sent: true, link_click: true, open: true, play: true, calc: true,
    watched_50: true, watched_90: true, watched_100: true,
    cta_click: true, checkout_start: true, paid: true,
  },
  // Hugo's 14-step sequence plus the welcome. The old five rules are GONE, and
  // deepMerge below only ever copies keys that exist in the defaults, so a saved
  // blob still carrying `watched_no_click` ("saw you watched the video", which
  // told a lead we were tracking them) is dropped on the next read rather than
  // resurrected.
  rules: DEFAULT_VSL_RULES,
};

function deepMerge(base: VslSettings, patch: Partial<VslSettings>): VslSettings {
  const merged: VslSettings = {
    ...base,
    ...patch,
    cta_labels: { ...base.cta_labels, ...(patch.cta_labels || {}) },
    quiet_hours: { ...base.quiet_hours, ...(patch.quiet_hours || {}) },
    // Must be listed explicitly: the spread above would REPLACE the whole blob,
    // so saving one toggle would silently reset the other eight.
    notify: { ...base.notify, ...(patch.notify || {}) },
    rules: { ...base.rules },
  };
  const rules = (patch.rules || {}) as Partial<VslRules>;
  // VSL_RULE_KEYS, not Object.keys(patch): a key that is not in the sequence is
  // not a rule the cron can run, so a stale one in a saved blob is dropped here
  // rather than carried forever.
  for (const k of VSL_RULE_KEYS) {
    merged.rules[k] = { ...base.rules[k], ...(rules[k] || {}) };
  }
  return merged;
}

export async function getVslSettings(): Promise<VslSettings> {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'vsl_automation')
    .maybeSingle();
  if (!data?.value) return deepMerge(DEFAULT_VSL_SETTINGS, {});
  try {
    return deepMerge(DEFAULT_VSL_SETTINGS, JSON.parse(data.value));
  } catch {
    return deepMerge(DEFAULT_VSL_SETTINGS, {});
  }
}

export async function saveVslSettings(patch: Partial<VslSettings>): Promise<VslSettings> {
  const merged = deepMerge(await getVslSettings(), patch);
  await supabase.from('platform_settings').upsert({
    key: 'vsl_automation',
    value: JSON.stringify(merged),
    updated_at: new Date().toISOString(),
  });
  return merged;
}

/**
 * The owning agent's SMS line (wk_number_agents → wk_numbers, GB preferred).
 * Falls back to the workspace's first GB-preferred sms-enabled line so a lead
 * never silently goes un-texted just because their agent has no assigned number
 * (mirrors wk-sms-send's workspace-default fallback).
 *
 * Shared by the nudge cron and the auto-send cron — two funnel texts arriving
 * from two different numbers would read as two different companies.
 */
export async function agentSmsLine(agentId: string): Promise<string | null> {
  const { data } = await supabase
    .from('wk_number_agents')
    .select('is_primary, wk_numbers ( e164, channel, sms_enabled, is_active )')
    .eq('agent_id', agentId);
  const rows = (data || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => ({ primary: r.is_primary, n: r.wk_numbers }))
    .filter((r) => r.n && r.n.channel === 'sms' && r.n.sms_enabled && r.n.is_active);
  if (rows.length) {
    rows.sort((a, b) => {
      const gb = Number((b.n.e164 || '').startsWith('+44')) - Number((a.n.e164 || '').startsWith('+44'));
      if (gb) return gb;
      return Number(b.primary) - Number(a.primary);
    });
    return rows[0].n.e164;
  }
  const { data: fallback } = await supabase
    .from('wk_numbers')
    .select('e164')
    .eq('channel', 'sms')
    .eq('sms_enabled', true)
    .eq('is_active', true)
    .order('e164', { ascending: false }); // +44 sorts before +1
  return fallback?.[0]?.e164 ?? null;
}

/** The first name, with the punctuation stripped off both ends.
 *
 *  Owner names arrive from Companies House and from CSVs in every shape there
 *  is: "Hywel, Mr. Herbert" gives a first token of "Hywel," and the template
 *  then produced "Hi Hywel,, it's Marr". Caught on a real lead moments before
 *  it was sent (2026-07-27).
 *
 *  Only the EDGES are stripped, so O'Brien and Anne-Marie survive intact. */
export function firstName(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .split(/\s+/)[0]
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
}

/** Fill {first} {business} {url} {agent} into a template. */
export function fillTemplate(
  template: string,
  vars: { first?: string | null; business?: string | null; url?: string | null; agent?: string | null },
): string {
  return template
    // No name → drop it (NOT "there" — a fake first name reads like spam; the
    // business name carries the personalisation). Grammar is cleaned below.
    .replace(/\{\{?\s*first(?:_name)?\s*\}?\}/gi, firstName(vars.first))
    .replace(/\{\{?\s*business\s*\}?\}/gi, vars.business || 'your business')
    .replace(/\{\{?\s*url\s*\}?\}/gi, vars.url || '')
    .replace(/\{\{?\s*agent(?:_first_name)?\s*\}?\}/gi, (vars.agent || 'the team').split(' ')[0])
    // Strip any leftover {token} so the SMS worker's own {first_name}→company
    // substitution can never touch an already-filled VSL body.
    .replace(/\{\{?[a-z_]+\}?\}/gi, '')
    // Tidy up the hole a missing name leaves: "Hi , it's" → "Hi, it's".
    // HORIZONTAL whitespace only, here and below: \s matches \n, so the old
    // /\s{2,}/g → ' ' flattened every paragraph break the moment the templates
    // gained one (Hugo 2026-07-27 asked for paragraphs).
    .replace(/[^\S\n]+([,.!?])/g, '$1')
    .replace(/[^\S\n]{2,}/g, ' ')
    // Trailing spaces a stripped token leaves at the end of a line.
    .replace(/[^\S\n]+\n/g, '\n')
    // A token that resolved to nothing can leave a line empty; three or more
    // newlines in a row reads to a lead like a broken message.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Automation may only text inside these hours, Europe/London. */
export function insideQuietHours(s: VslSettings, now = new Date()): boolean {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);
  return hhmm >= s.quiet_hours.start && hhmm < s.quiet_hours.end;
}

/** Slugify a business name for heyelsie.com/{slug}. */
// Keep in lockstep with the heyelsie.com slug rewrite in vercel.json.
export const VSL_RESERVED_SLUGS = new Set([
  // 's' is the site-demo funnel's prefix (heyelsie.com/s/{slug}). A business
  // slugging to a bare 's' would be swallowed by that rewrite.
  'api', 'assets', 'r', 's', 'report', 'welcome', 'subscribe', 'onboarding', 'login',
  'continue', 'join', 'integrations', 'favicon', 'robots', 'sitemap', 'index',
  'admin', 'super', 'app', 'go', 'www', 'pricing', 'terms', 'privacy', 'dpa', 'blog',
  'register', 'forgot-password', 'reset-password', 'script', 'rank-frame', 'leads',
  'calls', 'appointments', 'conversations', 'quotes', 'invoices', 'contacts', 'settings',
]);

export function slugifyBusiness(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const safe = base || 'business';
  return VSL_RESERVED_SLUGS.has(safe) ? `${safe}-video` : safe;
}

/**
 * Loose business-name match — "24/7 Fast Flow Plumbing Ltd" vs Google's
 * "24/7 Fast Flow Plumbing". Used to dedupe a business against itself when the
 * same company arrives from two sources under slightly different names.
 * Shared by rank-frame (don't double-list the lead) and the VSL page's
 * examples carousel (don't show the same business twice).
 */
export function normBusinessName(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Pipeline auto-move: funnel state -> board column name (forward-only). */
export const VSL_STATE_TO_COLUMN: Record<string, string> = {
  sent: 'Video sent',
  opened: 'Opened page',
  watched: 'Watched video',
  cta_clicked: 'Clicked button',
  checkout_started: 'Checkout started',
  paid: 'Paid',
};

/** Render lifecycle -> board column ('failed' stays put on purpose). */
export const VSL_RENDER_TO_COLUMN: Record<string, string> = {
  queued: 'Rendering',
  rendering: 'Rendering',
  ready: 'Ready to send',
};

/** Every VSL board column, left→right — the forward-only ordering.
 *  KEEP IN LOCKSTEP with scripts/vsl-render-worker.mjs (worker duplicates it). */
export const VSL_COLUMN_ORDER = [
  'Rendering', 'Ready to send',
  ...Object.values(VSL_STATE_TO_COLUMN),
];

export const VSL_STATE_ORDER = [
  'created', 'sent', 'opened', 'watched', 'cta_clicked', 'checkout_started', 'paid',
] as const;

export function stateRank(state: string): number {
  return VSL_STATE_ORDER.indexOf(state as (typeof VSL_STATE_ORDER)[number]);
}

/** Forward-only funnel advance — ATOMIC via the wk_vsl_advance RPC (row lock in
 *  Postgres), so concurrent beacons can't demote state or lose counter bumps.
 *  Moves the pipeline card only when the state genuinely advanced. `extra` may
 *  carry watched_pct / bump_open / business_id. */
/** What the locked RPC saw before it wrote — the basis for notify-once. */
export interface VslAdvanceResult {
  state: string;
  advanced: boolean;
  contact_id: string;
  /** watched_pct BEFORE this call; feed to crossedMilestones(). */
  pct_before: number;
  first_click: boolean;
  first_open: boolean;
  first_play: boolean;
  first_complete: boolean;
  /** They moved the ROI calculator for the first time. The strongest
   *  pre-purchase signal on the page: watching is passive, typing your own job
   *  value in is working out whether this pays for itself. */
  first_calc: boolean;
}

export async function advanceVslState(
  page: { id: string; contact_id: string; state: string } & Record<string, unknown>,
  target: string | null,
  extra: {
    watched_pct?: number;
    bump_open?: boolean;
    business_id?: string | null;
    link_click?: boolean;
    play?: boolean;
    completed?: boolean;
    calc?: boolean;
  } = {},
): Promise<VslAdvanceResult | null> {
  const { data, error } = await supabase.rpc('wk_vsl_advance', {
    p_page_id: page.id,
    p_target: target,
    p_watched_pct: extra.watched_pct ?? null,
    p_bump_open: extra.bump_open ?? false,
    p_link_click: extra.link_click ?? false,
    p_play: extra.play ?? false,
    p_completed: extra.completed ?? false,
    p_calc: extra.calc ?? false,
  });
  if (error) console.error('[vsl] advance failed:', error);
  const row = (Array.isArray(data) ? data[0] : data) as VslAdvanceResult | undefined;
  // NOTE (Hugo 2026-07-27): this used to call movePipelineCard() here, which
  // wrote wk_contacts.pipeline_column_id. That DESTROYED the agent's call
  // outcome — a lead marked "Interested" was silently moved to "Video sent" the
  // moment the video went out. The funnel's state lives on wk_vsl_pages and has
  // its own board; the pipeline column belongs to the human. Two independent
  // axes on purpose. See 20260727000009_unhijack_pipeline.sql.
  // business_id is set once, on the paid transition — write it separately
  // (the RPC only owns the funnel columns).
  if (extra.business_id) {
    await supabase.from('wk_vsl_pages').update({ business_id: extra.business_id }).eq('id', page.id);
  }
  return row ?? null;
}

/**
 * REMOVED ON PURPOSE — Hugo 2026-07-27.
 *
 * `movePipelineCard()` / `movePipelineCardToColumn()` used to promote a lead
 * through Rendering -> Ready to send -> Video sent -> Opened page -> ... by
 * writing wk_contacts.pipeline_column_id. That overwrote whatever outcome the
 * agent had picked on the call: mark a lead "Interested", send the video, and
 * it silently became "Video sent".
 *
 * The pipeline is the HUMAN's axis (Interested / Nurturing / No pickup / ...).
 * The funnel is the VIDEO's axis and lives on wk_vsl_pages.state, which has its
 * own board. The funnel card now shows the call outcome beside its stage, so
 * nothing is lost by keeping them apart.
 *
 * The eight funnel columns are archived by 20260727000009_unhijack_pipeline.sql.
 * If you are about to re-add an automatic pipeline write here: don't. Surface
 * the funnel state on the card instead.
 */
