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

export interface VslSettings {
  enabled: boolean;                       // master switch — feature dark until true
  default_video_url: string;             // placeholder until the render pipeline lands
  send_template: string;                 // the SMS the agent sends with the link
  cta_labels: { a: string; b: string };  // button A/B
  watched_threshold_pct: number;         // % progress that counts as "watched"
  quiet_hours: { start: string; end: string }; // Europe/London, automation only
  agent_disabled: string[];              // agent ids opted out of automation
  spots_per_town: number;                // scarcity line pool size
  rules: {
    sent_not_opened: VslRule;
    opened_not_watched: VslRule;
    watched_no_click: VslRule;
    checkout_abandoned: VslRule;
    paid_welcome: VslRule;
  };
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
  send_template:
    "Hi {first}, it's {agent} from HeyElsie — here's the video I made for {business}: {url}",
  cta_labels: { a: 'Start getting reviews', b: 'Get my reviews rolling' },
  watched_threshold_pct: 50,
  quiet_hours: { start: '08:00', end: '20:00' },
  agent_disabled: [],
  spots_per_town: 5,
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

/** Fill {first} {business} {url} {agent} into a template. */
export function fillTemplate(
  template: string,
  vars: { first?: string | null; business?: string | null; url?: string | null; agent?: string | null },
): string {
  return template
    .replace(/\{\{?\s*first(?:_name)?\s*\}?\}/gi, (vars.first || 'there').split(' ')[0])
    .replace(/\{\{?\s*business\s*\}?\}/gi, vars.business || 'your business')
    .replace(/\{\{?\s*url\s*\}?\}/gi, vars.url || '')
    .replace(/\{\{?\s*agent(?:_first_name)?\s*\}?\}/gi, (vars.agent || 'the team').split(' ')[0])
    // Strip any leftover {token} so the SMS worker's own {first_name}→company
    // substitution can never touch an already-filled VSL body.
    .replace(/\{\{?[a-z_]+\}?\}/gi, '')
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

/** Pipeline auto-move: funnel state -> board column name (forward-only). */
export const VSL_STATE_TO_COLUMN: Record<string, string> = {
  sent: 'Video sent',
  opened: 'Opened page',
  watched: 'Watched video',
  cta_clicked: 'Clicked button',
  checkout_started: 'Checkout started',
  paid: 'Paid',
};

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
export async function advanceVslState(
  page: { id: string; contact_id: string; state: string } & Record<string, unknown>,
  target: string | null,
  extra: { watched_pct?: number; bump_open?: boolean; business_id?: string | null } = {},
): Promise<void> {
  const { data } = await supabase.rpc('wk_vsl_advance', {
    p_page_id: page.id,
    p_target: target,
    p_watched_pct: extra.watched_pct ?? null,
    p_bump_open: extra.bump_open ?? false,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.advanced && target) {
    await movePipelineCard(page.contact_id, target);
  }
  // business_id is set once, on the paid transition — write it separately
  // (the RPC only owns the funnel columns).
  if (extra.business_id) {
    await supabase.from('wk_vsl_pages').update({ business_id: extra.business_id }).eq('id', page.id);
  }
}

/** Move the contact's pipeline card to the column for this funnel state —
 *  forward-only: never demotes a card already sitting in a later funnel column.
 *  Manual drags outside the funnel columns are respected (we still promote on
 *  the next funnel event, matching "auto-moves on funnel events only"). */
export async function movePipelineCard(contactId: string, state: string): Promise<void> {
  const columnName = VSL_STATE_TO_COLUMN[state];
  if (!columnName) return;

  const { data: cols } = await supabase
    .from('wk_pipeline_columns')
    .select('id, name')
    .in('name', Object.values(VSL_STATE_TO_COLUMN));
  if (!cols?.length) return;
  const byName = new Map(cols.map((c) => [c.name, c.id]));
  const target = byName.get(columnName);
  if (!target) return;

  const order = Object.values(VSL_STATE_TO_COLUMN);
  const { data: contact } = await supabase
    .from('wk_contacts')
    .select('id, pipeline_column_id')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return;

  const currentName = cols.find((c) => c.id === contact.pipeline_column_id)?.name;
  if (currentName && order.indexOf(currentName) >= order.indexOf(columnName)) return;

  await supabase.from('wk_contacts').update({ pipeline_column_id: target }).eq('id', contactId);
}
