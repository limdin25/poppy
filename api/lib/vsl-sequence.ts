// The follow-up sequence: which message a lead is owed, and when.
//
// PURE ON PURPOSE. No supabase, no react, no env. The five-minute cron
// (api/cron/vsl-automation.ts) and the funnel drawer both read the schedule from
// here. A second copy would drift, and a board that promises a text the cron
// never sends is worse than no board at all.
//
// Hugo's sequence, 2026-07-27. Every delay is measured from the anchor stamp for
// that step, not from the previous message:
//
//   A  sent, never opened          2h, 24h, 72h   (from sent_at)
//   B  opened, never played        2h, 24h        (from first_opened_at)
//   C  played, under 50%           4h             (from play_at)
//   D  watched 50%+                2h             (from watched_at)
//   E  watched 90%+                30m            (from watched_at)
//   F  watched it all              30m            (from completed_at) carries {url}
//   G  watched it all, no trial    24h            (from completed_at)
//   H  tapped the button, no checkout  2h         (from cta_clicked_at)
//   I  checkout started, not paid  30m, 24h       (from checkout_started_at)
//   J  dead for 7 days             the goodbye    (from their last engagement)
//
// Each message is its own rule rather than a repeat of one rule, because the
// gaps inside a step are not uniform (2h then 22h then 48h) and the copy
// escalates. `max_sends` / `repeat_hours` are still honoured, so an admin can
// turn any one of them into a repeater without a deploy.
//
// NEVER MENTION TRACKING. No "I saw you watched", no "I noticed you opened".
// We know an unsettling amount about what the lead did on that page; the
// messages must read like a person following up, because that is the only
// version of this that is welcome. tests/vsl-sequence.test.ts enforces it.

/** One configurable message. Shape unchanged from the original five rules, so
 *  the admin templates page and the settings drawer keep working. */
export interface VslRule {
  enabled: boolean;
  delay_minutes: number;   // wait this long after the anchor stamp
  template: string;        // {first} {business} {url} {agent}
  max_sends: number;       // total sends for this rule per page (1 = one shot)
  repeat_hours: number;    // gap between send 1..N when max_sends > 1
}

export type VslRuleKey =
  | 'dormant_7d'
  | 'sent_not_opened_2h'
  | 'sent_not_opened_24h'
  | 'sent_not_opened_72h'
  | 'opened_not_played_2h'
  | 'opened_not_played_24h'
  | 'played_under_50_4h'
  | 'watched_50_2h'
  | 'watched_90_30m'
  | 'watched_100_30m'
  | 'watched_100_no_trial_24h'
  | 'cta_no_checkout_2h'
  | 'checkout_abandoned_30m'
  | 'checkout_abandoned_24h'
  | 'paid_welcome';

export type VslRules = Record<VslRuleKey, VslRule>;

/** The only page columns the schedule reads. Structurally satisfied by a
 *  wk_vsl_pages row and by src/features/crm/lib/funnelStages.VslPage, so both
 *  callers pass what they already have.
 *
 *  Position comes from the `*_at` stamps, NEVER from `state`: state is
 *  forward-only and collapses, so a paid lead is not "in" opened and a lead who
 *  came back for a second watch is not demoted. */
export interface SequencePage {
  sent_at: string | null;
  first_opened_at: string | null;
  play_at: string | null;
  watched_at: string | null;
  completed_at: string | null;
  cta_clicked_at: string | null;
  checkout_started_at: string | null;
  paid_at: string | null;
  watched_pct: number | null;
  /** They moved the ROI calculator. The strongest pre-purchase signal we get. */
  calc_at?: string | null;
  /** Newest wk_vsl_events row for this page, supplied by the caller. The `*_at`
   *  columns are all FIRST-touch (wk_vsl_advance coalesces them), so without
   *  this a lead who re-opens their page every single day still looks silent
   *  and gets the goodbye message an hour after their latest visit. */
  last_event_at?: string | null;
  /** wk_vsl_pages.automation, i.e. { ruleKey: { count, last_at } }. */
  automation?: Record<string, { count?: number; last_at?: string } | undefined> | null;
}

export interface SequenceContext {
  /** settings.rules. Passed in rather than imported so this module stays free
   *  of the supabase-backed settings loader. */
  rules: VslRules;
  now: Date;
  /** Most recent INBOUND message from this lead, any channel. A reply stops the
   *  sales sequence permanently. */
  lastInboundAt?: string | null;
  /** This lead has paid through a door that does not stamp the page (the
   *  mid-call closer, or /subscribe). Treated exactly like paid_at. */
  paidElsewhere?: boolean;
  /** settings.enabled. */
  enabled?: boolean;
  /** settings.agent_disabled includes this page's agent. */
  agentDisabled?: boolean;
  /** insideQuietHours(settings, now). Passed in because the check needs Intl and
   *  the settings blob; the schedule itself stays pure. */
  insideQuietHours?: boolean;
}

export interface SequenceStep {
  key: VslRuleKey;
  /** Human wording for the drawer. */
  label: string;
  /** 1-based: which send of that rule this is. */
  nudge: number;
  /** ISO. When it fires (in the past for a step that is due now). */
  at: string;
  /** The unfilled template. Callers run fillTemplate() themselves. */
  template: string;
}

export type SequenceReason =
  | 'due'          // `due` is set, send it
  | 'waiting'      // nothing due yet, `next` says when
  | 'cooldown'     // one text per lead per 24h, already spent
  | 'quiet_hours'  // due, but we do not text people at 3am
  | 'replied'      // they wrote back, permanent stop
  | 'paid'         // sales sequence over, welcome already sent
  | 'closed'       // the goodbye has gone out
  | 'capped'       // six follow-ups is the ceiling
  | 'no_rule'      // nothing in the table matches this lead
  | 'disabled'     // funnel off, or this agent opted out
  | 'not_sent' | 'pre_epoch';    // the video has not gone out yet

export interface SequenceVerdict {
  /** Send this now. Null means send nothing. */
  due: SequenceStep | null;
  /** The next message that will become due, with the moment it fires. Null when
   *  the sequence is over or nothing can ever match. */
  next: SequenceStep | null;
  reason: SequenceReason;
  /** One sentence, safe to print in the UI. */
  detail: string;
}

/** One text per lead per rolling 24 hours, across every rule. */
export const SEQUENCE_MIN_GAP_HOURS = 24;

/**
 * The sequence does not exist for anything sent before this moment.
 *
 * The 2026-07-27 rules use NEW keys (sent_not_opened_2h and friends). The pages
 * already out there carry the OLD keys, so their book looks empty to every new
 * rule, while `sent_at` is immutable. Without this line, the first cron run
 * after deploy walks every lead ever sent, decides the 2h opener is overdue by
 * weeks, and texts the entire back catalogue "just wanted to make sure you
 * received the personalised video I made for your business" about a video from
 * last month. Then does it again the next day, and the next. Neither cap stops
 * it: both are per-page counters that the rename reset to zero.
 *
 * A lead we have already been talking to under the old schedule does not get
 * re-opened under the new one. They get nothing, which is the only honest
 * option, because we cannot reconstruct what they were already sent.
 *
 * Set to the start of 2026-07-27 (UTC) because that is the line that matters
 * here: five pages had ever been sent, four of them that morning with an empty
 * book, and one the evening before that was already mid old-schedule. Today's
 * calls get the new sequence; yesterday's lead does not restart.
 */
export const SEQUENCE_EPOCH = '2026-07-27T00:00:00.000Z';
/** Six sales follow-ups per lead, ever. paid_welcome does not count. */
export const SEQUENCE_MAX_SALES_SENDS = 6;

const MIN = 60_000;
const HOUR = 3_600_000;

/**
 * Funnel depth. The number is the whole point of this file.
 *
 * Two independent jobs:
 *
 *  1. PRIORITY. Several steps can be due in the same minute and the 24h cap
 *     means only one may send. Deepest wins. A lead who watched the whole video
 *     qualifies for `watched_50` and `watched_90` as well as `watched_100`, and
 *     only `watched_100` carries the £1 link. A naive first-match loop sends the
 *     weakest of the three and burns the day's budget doing it.
 *
 *  2. NO BACKSLIDING. A step may only fire if it is at least as deep as where
 *     the lead already is (see funnelDepth) and at least as deep as the deepest
 *     step already sent. Without it, the day after "here is the link again" a
 *     lead would get "thanks for taking the time to watch".
 *
 * `closing` is not a funnel position, it is the goodbye, so dormant_7d is
 * exempt from the floor. It sits at 0 because when it collides with anything
 * else, the anything else wins: closing a file is what we do when there is
 * nothing left to say.
 */
export const DEPTH = {
  closing: 0,
  sent: 1,
  opened: 2,
  played: 3,
  watched_50: 4,
  watched_90: 5,
  // F ("here's the £1 link") and G ("still no trial") are the SAME funnel
  // position, so they share a depth. Two things follow, and both are load
  // bearing:
  //   - equal depth means sending F does not raise the floor above G, so G can
  //     still fire its 24h check-in afterwards. Giving F a deeper slot killed G
  //     outright.
  //   - a collision is broken by declaration order instead, and F is declared
  //     LAST of the pair so the reversed priority list reaches it first. F is
  //     the only template carrying {url} and the ask; G must never take the
  //     day's one allowed text from it.
  watched_100: 6,
  cta: 8,
  checkout: 9,
} as const;

interface SequenceRuleDef {
  key: VslRuleKey;
  depth: number;
  label: string;
  /** Did the thing this rule talks about actually happen? "Not further along"
   *  is NOT checked here. That is the depth floor's job, in one place. */
  when(p: SequencePage): boolean;
  /** The stamp its delay counts from. */
  anchor(p: SequencePage): string | null;
  /** Terminal goodbye: exempt from the depth floor, and nothing follows it. */
  final?: boolean;
  /** Fires only after payment, and only ever this one. */
  welcome?: boolean;
}

const pct = (p: SequencePage): number => p.watched_pct ?? 0;
const first = (...vals: Array<string | null | undefined>): string | null =>
  vals.find((v) => !!v) ?? null;

/** They reached the end. `completed_at` is the honest signal (the video fired
 *  `ended`); the pct fallback exists because coverage of a seek-heavy watch can
 *  reach 100 without the ended event ever landing. */
const finished = (p: SequencePage): boolean => !!p.completed_at || pct(p) >= 100;

/** The last thing the LEAD did. Our own follow-ups deliberately do not count:
 *  "no engagement at all for 7 days" is about them, not about us. */
function lastEngagementAt(p: SequencePage): string | null {
  const stamps = [
    p.sent_at, p.first_opened_at, p.play_at, p.watched_at, p.completed_at,
    p.cta_clicked_at, p.checkout_started_at,
    // Repeat visits live here, not in the stamps above. Every one of those is
    // written once via coalesce(), so a lead on their eighth visit has the same
    // first_opened_at as a lead on their first.
    p.calc_at ?? null, p.last_event_at ?? null,
  ].filter(Boolean) as string[];
  if (!stamps.length) return null;
  return stamps.reduce((a, b) => (new Date(b).getTime() > new Date(a).getTime() ? b : a));
}

/**
 * How far into the funnel this lead actually is, from their own stamps.
 * The floor under every rule: nothing shallower than this may fire.
 */
export function funnelDepth(p: SequencePage): number {
  if (p.checkout_started_at) return DEPTH.checkout;
  if (p.cta_clicked_at) return DEPTH.cta;
  if (finished(p)) return DEPTH.watched_100;
  if (pct(p) >= 90) return DEPTH.watched_90;
  if (pct(p) >= 50 || p.watched_at) return DEPTH.watched_50;
  if (p.play_at) return DEPTH.played;
  if (p.first_opened_at) return DEPTH.opened;
  return DEPTH.sent;
}

/**
 * The table, ordered SHALLOW to DEEP. That order is load-bearing twice over:
 * `SEQUENCE_BY_PRIORITY` reverses it to decide who wins a collision, and
 * `depth` is compared against `funnelDepth` to stop a lead sliding backwards.
 *
 * dormant_7d is first because it is the lowest-priority message, not because it
 * is the first one sent.
 */
export const VSL_SEQUENCE: SequenceRuleDef[] = [
  {
    key: 'dormant_7d', depth: DEPTH.closing, final: true,
    label: 'Closing the file',
    when: () => true,
    anchor: (p) => lastEngagementAt(p),
  },
  {
    key: 'sent_not_opened_2h', depth: DEPTH.sent,
    label: 'Video sent, not opened',
    when: (p) => !!p.sent_at,
    anchor: (p) => p.sent_at,
  },
  {
    key: 'sent_not_opened_24h', depth: DEPTH.sent,
    label: 'Still not opened',
    when: (p) => !!p.sent_at,
    anchor: (p) => p.sent_at,
  },
  {
    key: 'sent_not_opened_72h', depth: DEPTH.sent,
    label: 'Last word on the video',
    when: (p) => !!p.sent_at,
    anchor: (p) => p.sent_at,
  },
  {
    key: 'opened_not_played_2h', depth: DEPTH.opened,
    label: 'Opened, not played',
    when: (p) => !!p.first_opened_at,
    anchor: (p) => p.first_opened_at,
  },
  {
    key: 'opened_not_played_24h', depth: DEPTH.opened,
    label: 'Opened, still not played',
    when: (p) => !!p.first_opened_at,
    anchor: (p) => p.first_opened_at,
  },
  {
    key: 'played_under_50_4h', depth: DEPTH.played,
    label: 'Stopped early in the video',
    when: (p) => !!p.play_at && pct(p) < 50,
    anchor: (p) => p.play_at,
  },
  {
    key: 'watched_50_2h', depth: DEPTH.watched_50,
    label: 'Watched past halfway',
    when: (p) => pct(p) >= 50 || !!p.watched_at,
    // There is no stamp for the 50% crossing other than watched_at, and no stamp
    // at all for 90%, so both bands hang off it.
    anchor: (p) => first(p.watched_at, p.play_at),
  },
  {
    key: 'watched_90_30m', depth: DEPTH.watched_90,
    label: 'Watched nearly all of it',
    when: (p) => pct(p) >= 90,
    anchor: (p) => first(p.watched_at, p.play_at),
  },
  {
    key: 'watched_100_no_trial_24h', depth: DEPTH.watched_100,
    label: 'Watched it all, no trial',
    when: (p) => finished(p) && !p.cta_clicked_at && !p.checkout_started_at,
    anchor: (p) => first(p.completed_at, p.watched_at, p.play_at),
  },
  {
    key: 'watched_100_30m', depth: DEPTH.watched_100,
    label: 'Watched it all, here is the link',
    when: (p) => finished(p),
    anchor: (p) => first(p.completed_at, p.watched_at, p.play_at),
  },
  {
    key: 'cta_no_checkout_2h', depth: DEPTH.cta,
    label: 'Tapped the button, no checkout',
    when: (p) => !!p.cta_clicked_at,
    anchor: (p) => p.cta_clicked_at,
  },
  {
    key: 'checkout_abandoned_30m', depth: DEPTH.checkout,
    label: 'Checkout not finished',
    when: (p) => !!p.checkout_started_at,
    anchor: (p) => p.checkout_started_at,
  },
  {
    key: 'checkout_abandoned_24h', depth: DEPTH.checkout,
    label: 'Checkout still not finished',
    when: (p) => !!p.checkout_started_at,
    anchor: (p) => p.checkout_started_at,
  },
  {
    key: 'paid_welcome', depth: DEPTH.checkout, welcome: true,
    label: 'Welcome message',
    when: (p) => !!p.paid_at,
    anchor: (p) => p.paid_at,
  },
];

/** Every sales key, shallow to deep. What the 6-send cap counts. */
export const SALES_RULE_KEYS: VslRuleKey[] =
  VSL_SEQUENCE.filter((r) => !r.welcome).map((r) => r.key);

/** Every key in table order, for anything that needs to iterate the settings. */
export const VSL_RULE_KEYS: VslRuleKey[] = VSL_SEQUENCE.map((r) => r.key);

/** Collision order: DEEPEST FIRST. This is the ordering the whole file exists
 *  for, so it gets its own export and its own test. */
export const SEQUENCE_BY_PRIORITY: SequenceRuleDef[] =
  VSL_SEQUENCE.filter((r) => !r.welcome).slice().reverse();

const WELCOME_RULE = VSL_SEQUENCE.find((r) => r.welcome)!;

const DETAIL: Record<SequenceReason, string> = {
  pre_epoch: 'Sent before the follow-up sequence existed, so it is not enrolled.',
  due: 'Ready to send.',
  waiting: 'Nothing due yet.',
  cooldown: 'A follow-up already went out in the last 24 hours.',
  quiet_hours: 'Holding until quiet hours are over.',
  replied: 'They replied, so the follow-ups have stopped.',
  paid: 'They paid, so the sales follow-ups have stopped.',
  closed: 'The final message has gone out.',
  capped: `They have had the maximum of ${SEQUENCE_MAX_SALES_SENDS} follow-ups.`,
  no_rule: 'Nothing in the sequence matches this lead right now.',
  disabled: 'Automation is switched off for this lead.',
  not_sent: 'The video has not been sent yet.',
};

const verdict = (
  reason: SequenceReason,
  due: SequenceStep | null = null,
  next: SequenceStep | null = null,
  detail?: string,
): SequenceVerdict => ({ due, next, reason, detail: detail ?? DETAIL[reason] });

interface Candidate {
  def: SequenceRuleDef;
  rule: VslRule;
  count: number;
  /** When the rule itself says it is due. */
  rawAt: number;
  /** rawAt held back by the one-per-24h cap. */
  fireAt: number;
}

const toStep = (c: Candidate, at: number): SequenceStep => ({
  key: c.def.key,
  label: c.def.label,
  nudge: c.count + 1,
  at: new Date(at).toISOString(),
  template: c.rule.template,
});

function bookOf(p: SequencePage, key: VslRuleKey): { count: number; last_at?: string } {
  const rec = (p.automation || {})[key] || {};
  return { count: rec.count || 0, last_at: rec.last_at };
}

/**
 * What this lead is owed and when.
 *
 * Pure: same page + same settings + same `now` always gives the same answer, so
 * the drawer can show exactly what the cron is about to do.
 */
export function nextSequenceStep(page: SequencePage, ctx: SequenceContext): SequenceVerdict {
  const now = ctx.now.getTime();
  const rules = ctx.rules;

  if (ctx.enabled === false || ctx.agentDisabled) return verdict('disabled');
  if (!page.sent_at) return verdict('not_sent');

  // Anything sent before the sequence existed is out of scope, permanently.
  // See SEQUENCE_EPOCH: without this the first run texts the back catalogue.
  if (new Date(page.sent_at).getTime() < Date.parse(SEQUENCE_EPOCH)) {
    return verdict('pre_epoch');
  }

  // ---- paid: the sales sequence is over, only the welcome may fire ----------
  // Checked BEFORE the reply stop on purpose: someone who texted back and then
  // paid must still be welcomed. Silence after taking their money is the one
  // message we can never get away with.
  // paid_at is only written when the Stripe session carried vsl_page_id, which
  // is the button on their own video page. A lead closed mid-call through
  // "Send subscribe link", or one who pays via /subscribe, is just as paid and
  // must not keep getting "your £1 trial is still available". The caller
  // resolves that from wk_contacts.business_id and passes it in.
  if (page.paid_at || ctx.paidElsewhere) {
    const rule = rules[WELCOME_RULE.key];
    const { count, last_at } = bookOf(page, WELCOME_RULE.key);
    if (!rule?.enabled || count >= rule.max_sends) return verdict('paid');
    const anchor = count === 0 ? WELCOME_RULE.anchor(page) : last_at;
    if (!anchor) return verdict('paid');
    const wait = count === 0 ? rule.delay_minutes * MIN : rule.repeat_hours * HOUR;
    const at = new Date(anchor).getTime() + wait;
    const c: Candidate = { def: WELCOME_RULE, rule, count, rawAt: at, fireAt: at };
    // The welcome ignores the 24h cap and the 6-send ceiling. It is not a
    // follow-up, it is the receipt.
    if (at > now) return verdict('waiting', null, toStep(c, at));
    if (ctx.insideQuietHours === false) return verdict('quiet_hours', null, toStep(c, at));
    return verdict('due', toStep(c, at), null);
  }

  // ---- permanent stops -----------------------------------------------------
  if (ctx.lastInboundAt && new Date(ctx.lastInboundAt).getTime() > new Date(page.sent_at).getTime()) {
    return verdict('replied');
  }
  if (bookOf(page, 'dormant_7d').count > 0) return verdict('closed');

  // Counted over EVERY key in the book, not just the current ones. A lead
  // half-way through the old five-rule sequence has already had those texts,
  // and the ceiling is about what landed on their phone, not about which
  // version of the schedule sent it.
  const salesSent = Object.entries(page.automation || {})
    .filter(([k]) => k !== WELCOME_RULE.key)
    .reduce((n, [, rec]) => n + (rec?.count || 0), 0);
  if (salesSent >= SEQUENCE_MAX_SALES_SENDS) return verdict('capped');

  // ---- the one-per-24h cap -------------------------------------------------
  // Measured from OUR OWN book (wk_vsl_pages.automation), not from the last
  // outbound row in wk_sms_messages. The video send is itself an outbound row,
  // so keying on that would push the first nudge from 2h to 24h and quietly
  // delete the step Hugo asked for. The book is also written before the job is
  // enqueued, so it holds even when the worker is backed up.
  let cooldownUntil = 0;
  for (const rec of Object.values(page.automation || {})) {
    // Every key, including retired ones: the lead's phone does not care which
    // rule sent yesterday's text.
    if (rec?.last_at) {
      cooldownUntil = Math.max(cooldownUntil, new Date(rec.last_at).getTime() + SEQUENCE_MIN_GAP_HOURS * HOUR);
    }
  }

  // ---- candidates ----------------------------------------------------------
  const floor = Math.max(funnelDepth(page), ...SALES_RULE_KEYS
    .filter((k) => bookOf(page, k).count > 0)
    .map((k) => VSL_SEQUENCE.find((r) => r.key === k)!.depth)
    .concat([0]));

  const candidates: Candidate[] = [];
  for (const def of SEQUENCE_BY_PRIORITY) {
    const rule = rules[def.key];
    if (!rule?.enabled) continue;
    // The goodbye is not a funnel position, so the floor does not apply to it.
    if (!def.final && def.depth < floor) continue;
    if (!def.when(page)) continue;
    const { count, last_at } = bookOf(page, def.key);
    if (count >= rule.max_sends) continue;
    const anchor = count === 0 ? def.anchor(page) : last_at;
    if (!anchor) continue;
    const wait = count === 0 ? rule.delay_minutes * MIN : rule.repeat_hours * HOUR;
    const rawAt = new Date(anchor).getTime() + wait;
    if (!Number.isFinite(rawAt)) continue;
    candidates.push({ def, rule, count, rawAt, fireAt: Math.max(rawAt, cooldownUntil) });
  }

  if (!candidates.length) return verdict('no_rule');

  // Deepest first, then the earliest-written message of that step, so a step
  // whose messages all came due at once still reads in the order it was written.
  const byPriority = candidates.slice().sort((a, b) =>
    (b.def.depth - a.def.depth) || (a.rule.delay_minutes - b.rule.delay_minutes));
  // Soonest first, for "what happens next".
  const byTime = candidates.slice().sort((a, b) =>
    (a.fireAt - b.fireAt) || (b.def.depth - a.def.depth));

  const dueNow = byPriority.filter((c) => c.fireAt <= now);

  if (!dueNow.length) {
    const upcoming = byTime[0];
    const held = byPriority.some((c) => c.rawAt <= now);
    // Something WOULD have gone out; the 24h cap is the only thing stopping it.
    return verdict(held ? 'cooldown' : 'waiting', null, toStep(upcoming, upcoming.fireAt));
  }

  const due = dueNow[0];
  // After this send the cap holds everything else for a day, so report the next
  // one at the honest time rather than at the time its own rule says.
  const after = byTime.find((c) => c.def.key !== due.def.key);
  const nextStep = after
    ? toStep(after, Math.max(after.rawAt, now + SEQUENCE_MIN_GAP_HOURS * HOUR))
    : null;

  if (ctx.insideQuietHours === false) {
    return verdict('quiet_hours', null, toStep(due, due.fireAt));
  }
  return verdict('due', toStep(due, due.fireAt), nextStep);
}

// ---------------------------------------------------------------------------
// The copy. Hugo's own words, 2026-07-27, used as written.
//
// Two deliberate departures, both forced by house rules:
//  - the smileys he put on the first and the "what did you think" message are
//    gone. A smiley is not in the GSM 03.38 table, so one character flips the
//    whole text to UCS-2 and the segment size drops from 160 to 70. That is a
//    doubled bill on every send, forever, for an emoji (see sms-charset.ts).
//  - the £1 link sits on its own line instead of trailing the sentence. It
//    lands on a phone, and a link buried mid-paragraph is a link nobody taps.
//
// Only the £1 message carries {url}. The rest arrive in the same thread as the
// original video text, so "the video" and "here" already point at it, and a
// link in every message reads as a campaign, not as a person.
// ---------------------------------------------------------------------------

export const DEFAULT_VSL_RULES: VslRules = {
  // A. Sent, never opened: 2h, 24h, 72h.
  sent_not_opened_2h: {
    enabled: true, delay_minutes: 120, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, just wanted to make sure you received the personalised video I made for your business. Let me know what you think",
  },
  sent_not_opened_24h: {
    enabled: true, delay_minutes: 1440, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, just checking you didn't miss my video. It's only about 90 seconds and shows a few things I spotted on your Google profile.",
  },
  sent_not_opened_72h: {
    enabled: true, delay_minutes: 4320, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, I'll leave the video here in case you get a chance to watch it later. If you have any questions, just reply to this message.",
  },

  // B. Opened, never played: 2h, 24h.
  opened_not_played_2h: {
    enabled: true, delay_minutes: 120, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, just wondering if you had a chance to watch the personalised video yet. I'd love to hear what you think.",
  },
  opened_not_played_24h: {
    enabled: true, delay_minutes: 1440, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, whenever you have 90 seconds, have a quick look at the video. I think you'll find it interesting.",
  },

  // C. Played, stopped under halfway: 4h.
  played_under_50_4h: {
    enabled: true, delay_minutes: 240, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, I'd love to know what you think so far. If you have any questions, just reply here.",
  },

  // D. Watched past halfway: 2h.
  watched_50_2h: {
    enabled: true, delay_minutes: 120, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, thanks for taking the time to watch the video. Let me know if anything wasn't clear or if you have any questions.",
  },

  // E. Watched nearly all of it: 30m.
  watched_90_30m: {
    enabled: true, delay_minutes: 30, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, what did you think? Happy to answer any questions if there's anything you'd like to know.",
  },

  // F. Watched it all: 30m. The ask, and the only message carrying the link.
  watched_100_30m: {
    enabled: true, delay_minutes: 30, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, if you'd like us to get everything set up for you, you can start today for just £1.\n\nHere's the link again:\n{url}",
  },

  // G. Watched it all and still no trial: 24h.
  watched_100_no_trial_24h: {
    enabled: true, delay_minutes: 1440, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, just checking in. If you're still interested, we'd love to help you get more Google reviews. Let me know if you have any questions.",
  },

  // H. Tapped the button but never reached checkout: 2h.
  cta_no_checkout_2h: {
    enabled: true, delay_minutes: 120, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, I just wanted to see if you had any questions before getting started. Happy to help.",
  },

  // I. Checkout started, not paid: 30m, then 24h.
  checkout_abandoned_30m: {
    enabled: true, delay_minutes: 30, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, it looks like you were getting started. If you had any questions or ran into any issues, just reply here and I'll help.",
  },
  checkout_abandoned_24h: {
    enabled: true, delay_minutes: 1440, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, just following up in case you still wanted to get started. Your £1 trial is still available whenever you're ready.",
  },

  // J. Nothing at all for 7 days: the goodbye.
  dormant_7d: {
    enabled: true, delay_minutes: 10080, max_sends: 1, repeat_hours: 24,
    template: "Hi {first}, I'll close your file for now. If you ever decide you'd like help getting more Google reviews, just reply to this message and we'll be happy to help.",
  },

  // K. Unchanged, by instruction.
  paid_welcome: {
    enabled: true, delay_minutes: 1, max_sends: 1, repeat_hours: 24,
    template: "Welcome aboard {first}! We're setting {business} up now and your reviews will start rolling shortly.\n\nAny questions, just message me here any time.",
  },
};
