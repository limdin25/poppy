// followUpTimeline: the pure bits of the drawer's "Follow-ups" panel, how long
// until the next automatic message, and what has already gone out.
//
// The SCHEDULE is deliberately not here. Every delay, the one-per-24h cap and
// the deepest-first ordering live in api/lib/vsl-sequence.ts, which the
// five-minute cron calls too. A second copy of the schedule would drift, and a
// board that promises a text the cron never sends is worse than no board.
// This module only formats what that function returns.
//
// No react, no supabase imports on purpose. That is what lets these be unit
// tested for real (tests/funnel-sequence-timeline.test.ts).

import { VSL_SEQUENCE } from '../../../../api/lib/vsl-sequence';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * "in 1h 12m" / "in 3 days" / "any minute now".
 *
 * Anything inside the next minute, or already overdue, is "any minute now"
 * rather than a countdown that ticks past zero and starts lying: the cron wakes
 * every five minutes, so a due message goes out on its next pass, not exactly
 * when the clock hits zero.
 *
 * Returns '' for a missing or unparseable target so a caller can render nothing
 * rather than the word "Invalid".
 */
export function countdownLabel(
  target: string | number | Date | null | undefined,
  now: number,
): string {
  if (target === null || target === undefined || target === '') return '';
  const t =
    target instanceof Date ? target.getTime()
    : typeof target === 'number' ? target
    : new Date(target).getTime();
  if (Number.isNaN(t)) return '';

  const diff = t - now;
  if (diff <= MINUTE) return 'any minute now';
  if (diff < HOUR) return `in ${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    const m = Math.floor((diff % HOUR) / MINUTE);
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  // Rounded, not floored: the schedule is written in whole days (24h, 72h,
  // 7 days), and floor turns a 71h59m wait into "in 2 days", which reads as a
  // different plan from the one Hugo signed off.
  const d = Math.max(1, Math.round(diff / DAY));
  return `in ${d} ${d === 1 ? 'day' : 'days'}`;
}

/** The exact moment, London, for a title= tooltip. The visible stamps use the
 *  drawer's own formatDateTime, which is already Europe/London but drops the
 *  year and seconds. */
export function londonStamp(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const s = d.toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Europe/London',
  });
  return `${s} London`;
}

/** The sequence's own wording, so a rule renamed there is renamed here too. */
const SEQUENCE_LABELS: Record<string, string> = Object.fromEntries(
  VSL_SEQUENCE.map((r) => [r.key as string, r.label]),
);

/**
 * The five rules that ran before the 2026-07-27 sequence replaced them. They no
 * longer exist in VSL_SEQUENCE, but they are written into the automation blob of
 * every lead we followed up before that date, and the log has to be able to read
 * its own history.
 */
const LEGACY_RULE_LABELS: Record<string, string> = {
  sent_not_opened: 'Sent, not opened',
  opened_not_watched: 'Opened, not watched',
  watched_no_click: 'Watched, no click',
  checkout_abandoned: 'Checkout abandoned',
};

/** Wording for a rule key in the sent log. Anything unrecognised is prettified
 *  from the key rather than shown as raw snake_case, so a rule added tomorrow
 *  still reads like English in a log written today. */
export function ruleLabel(key: string): string {
  const known = SEQUENCE_LABELS[key] ?? LEGACY_RULE_LABELS[key];
  if (known) return known;
  const words = String(key || '').replace(/_/g, ' ').trim();
  if (!words) return 'Follow-up';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Automation may only text inside these hours, Europe/London.
 *
 * A deliberate mirror of insideQuietHours() in api/lib/vsl-settings.ts, which
 * cannot be imported here: that module opens a service-role supabase client at
 * import time, so pulling it into the browser bundle would throw before the
 * drawer rendered. One comparison, kept character for character.
 *
 * Without it the panel would say "any minute now" at 3am about a message the
 * cron is going to hold until morning.
 */
export function insideQuietHoursLondon(
  quiet: { start: string; end: string },
  now: number | Date,
): boolean {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now instanceof Date ? now : new Date(now));
  return hhmm >= quiet.start && hhmm < quiet.end;
}

/** wk_vsl_pages.automation: what the cron booked, per rule. */
export interface AutomationBook {
  [ruleKey: string]: { count?: number; last_at?: string } | undefined;
}

/** The shape the drawer already loads from wk_vsl_events. */
export interface AutoSmsEventLike {
  type: string;
  created_at: string;
  meta?: { rule?: string; nudge?: number } | null;
}

export interface SentFollowUp {
  key: string;
  label: string;
  at: string;
  /** 1-based: which message of that rule this was. */
  nudge: number;
  /** false = reconstructed from the automation counters, which hold only the
   *  LAST send per rule. Shown as such rather than passed off as the real time. */
  exact: boolean;
}

/**
 * The log, oldest first (newest last, as Hugo asked).
 *
 * Two sources, deliberately. wk_vsl_events carries one row per message with its
 * real timestamp and is the truth; the automation counters only ever remember
 * the last send per rule, so they are used to fill a gap the events cannot
 * cover (a pruned or lost event row) and are labelled inexact when they do.
 */
export function buildSentLog(
  automation: AutomationBook | null | undefined,
  events: AutoSmsEventLike[] | null | undefined,
): SentFollowUp[] {
  const out: SentFollowUp[] = [];
  const seen = new Map<string, number>();

  const asc = (events || [])
    .filter((e) => e.type === 'auto_sms')
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  for (const e of asc) {
    const key = e.meta?.rule || 'unknown';
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.push({ key, label: ruleLabel(key), at: e.created_at, nudge: e.meta?.nudge ?? n, exact: true });
  }

  for (const [key, rec] of Object.entries(automation || {})) {
    const count = rec?.count ?? 0;
    const lastAt = rec?.last_at;
    if (!count || !lastAt) continue;
    if ((seen.get(key) ?? 0) >= count) continue; // the events already tell this story
    out.push({ key, label: ruleLabel(key), at: lastAt, nudge: count, exact: false });
  }

  return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
