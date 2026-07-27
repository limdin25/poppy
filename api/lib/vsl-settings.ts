// VSL funnel settings + shared helpers. One platform_settings JSON key,
// mirroring api/lib/brrr.ts. Everything the funnel needs to be reconfigured
// without a deploy lives here: templates, delays, quiet hours, CTA A/B labels.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface VslRule {
  enabled: boolean;
  delay_minutes: number;   // wait this long in the state before the first nudge
  template: string;        // {first} {business} {url} {agent}
  max_sends: number;       // total nudges for this rule per page
  repeat_hours: number;    // gap between nudge 1..N
}

/** Which funnel events email. Every one still lands in the bell regardless —
 *  these only gate the email, so Hugo can dial the volume down without a
 *  deploy. Defaults are all on: he asked for every event (2026-07-26). */
export interface VslNotifySettings {
  sent: boolean;
  link_click: boolean;
  open: boolean;
  play: boolean;
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
  rules: {
    sent_not_opened: VslRule;
    opened_not_watched: VslRule;
    watched_no_click: VslRule;
    checkout_abandoned: VslRule;
    paid_welcome: VslRule;
  };
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

export const VSL_PRICES: Record<string, { plan: string; label: string; monthly: string; requests: string }> = {
  price_1TvIMsLdAEhwWg6w9VFZFSJ0: { plan: 'reviews_starter', label: 'Starter', monthly: '£99', requests: 'up to 50 review requests a month' },
  price_1TvIMtLdAEhwWg6wjAfYPZeq: { plan: 'reviews_growth', label: 'Growth', monthly: '£179', requests: 'up to 100 review requests a month' },
  price_1TvIMtLdAEhwWg6wiQM7pKvR: { plan: 'reviews_pro', label: 'Pro', monthly: '£279', requests: 'up to 200 review requests a month' },
};
// One-time "first 10 days" pound, created 2026-07-25 under prod_Uv8eim0pBOmEGZ.
export const VSL_POUND_PRICE = process.env.VSL_POUND_PRICE || 'price_1Tx5miLdAEhwWg6wqTTWjQsC';

export const DEFAULT_VSL_SETTINGS: VslSettings = {
  enabled: false,
  default_video_url: '',
  // Must echo the exact words the agent just said on the phone — "a 90-second
  // audit" — or the text reads like a different offer arriving from a stranger
  // (Hugo 2026-07-26, the new video-first call).
  send_template:
    "Hi {first}, it's {agent} from HeyElsie — here's the 90-second audit I just mentioned for {business}: {url}",
  // free-website offer withdrawn (Hugo 2026-07-26) — same message as the
  // with-site variant; the field stays so the drawer can differentiate later
  send_template_no_site:
    "Hi {first}, it's {agent} from HeyElsie — here's the 90-second audit I just mentioned for {business}: {url}",
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
    sent: true, link_click: true, open: true, play: true,
    watched_50: true, watched_90: true, watched_100: true,
    cta_click: true, checkout_start: true, paid: true,
  },
  rules: {
    sent_not_opened: {
      enabled: true, delay_minutes: 180, max_sends: 2, repeat_hours: 24,
      template: 'Hi {first}, did you get a chance to watch your video? Takes 90 seconds — worth a look: {url}',
    },
    opened_not_watched: {
      enabled: true, delay_minutes: 60, max_sends: 1, repeat_hours: 24,
      template: 'Hi {first}, the video’s only 90 seconds — it shows exactly where {business} sits on Google right now: {url}',
    },
    watched_no_click: {
      enabled: true, delay_minutes: 30, max_sends: 2, repeat_hours: 24,
      template: 'Nice one {first} — saw you watched the video. Want me to get {business} set up? Takes 2 minutes: {url}',
    },
    checkout_abandoned: {
      enabled: true, delay_minutes: 30, max_sends: 2, repeat_hours: 24,
      template: 'Hi {first}, you were nearly there — it’s just £1 to start and we set everything up for you: {url}',
    },
    paid_welcome: {
      enabled: true, delay_minutes: 1, max_sends: 1, repeat_hours: 24,
      template: 'Welcome aboard {first}! We’re setting {business} up now — your reviews start rolling shortly. Any questions, just reply here.',
    },
  },
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
  const rules = (patch.rules || {}) as Partial<VslSettings['rules']>;
  for (const k of Object.keys(base.rules) as (keyof VslSettings['rules'])[]) {
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

/** Fill {first} {business} {url} {agent} into a template. */
export function fillTemplate(
  template: string,
  vars: { first?: string | null; business?: string | null; url?: string | null; agent?: string | null },
): string {
  return template
    // No name → drop it (NOT "there" — a fake first name reads like spam; the
    // business name carries the personalisation). Grammar is cleaned below.
    .replace(/\{\{?\s*first(?:_name)?\s*\}?\}/gi, (vars.first || '').split(' ')[0])
    .replace(/\{\{?\s*business\s*\}?\}/gi, vars.business || 'your business')
    .replace(/\{\{?\s*url\s*\}?\}/gi, vars.url || '')
    .replace(/\{\{?\s*agent(?:_first_name)?\s*\}?\}/gi, (vars.agent || 'the team').split(' ')[0])
    // Strip any leftover {token} so the SMS worker's own {first_name}→company
    // substitution can never touch an already-filled VSL body.
    .replace(/\{\{?[a-z_]+\}?\}/gi, '')
    // Tidy up the hole a missing name leaves: "Hi , it's" → "Hi, it's".
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
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
  'api', 'assets', 'r', 'report', 'welcome', 'subscribe', 'onboarding', 'login',
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
