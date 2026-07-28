// funnelStages — the video funnel's stage rules, in one pure module.
//
// These lived inline in VideoFunnelPage.tsx. The inbox now needs the SAME
// rules to badge a video lead, and a second copy would drift: the
// 'rendering' / 'render_ready' carve-out in particular is subtle enough that
// two implementations WILL disagree, and getting it wrong badges every already
// sent lead as "ready to send" forever.
//
// No React, no Supabase imports on purpose — that is what lets these rules be
// unit-tested for real instead of grepped (see tests/funnel-stages.test.ts).

export interface VslPage {
  id: string;
  slug: string;
  contact_id: string;
  agent_id: string;
  business_name: string;
  owner_first: string | null;
  town: string | null;
  state: string;
  watched_pct: number;
  open_count: number;
  cta_variant: string;
  created_at: string;
  sent_at: string | null;
  first_click_at: string | null;
  click_count: number | null;
  calc_at?: string | null;
  calc_count?: number | null;
  first_opened_at: string | null;
  play_at: string | null;
  watched_at: string | null;
  completed_at: string | null;
  cta_clicked_at: string | null;
  checkout_started_at: string | null;
  paid_at: string | null;
  updated_at: string;
  render_status: 'queued' | 'rendering' | 'ready' | 'failed' | null;
  render_error: string | null;
  render_requested_at: string | null;
  render_started_at: string | null;
  render_done_at: string | null;
  video_url: string | null;
  poster_url: string | null;
  no_website: boolean;
  /** Per-rule follow-up bookkeeping the automation cron writes before it
   *  enqueues each nudge: { rule_key: { count, last_at } }. The board selects
   *  `*`, so it is already on every row the drawer gets. */
  automation?: Record<string, { count?: number; last_at?: string }> | null;
  /** Joined live from wk_contacts — NOT snapshotted onto this row on purpose.
   *  The board exists to make missing owner/website obvious so an agent fills
   *  them in; a snapshot would keep showing the gap after they had. Null when
   *  RLS hides the contact — owner_first is the fallback. */
  wk_contacts?: { owner_name: string | null; website: string | null } | null;
}

// Three VIRTUAL groups, carved out of a stored state rather than stored
// themselves:
//   'rendering' / 'render_ready' — out of 'created', by render_status. The
//                                  review step before anything is sent.
//   'playing'                    — out of 'opened', by play_at. See below.
export const STATES: Array<{ key: string; label: string; color: string }> = [
  { key: 'created', label: 'Created', color: '#9CA3AF' },
  { key: 'rendering', label: 'Rendering 🎬', color: '#94A3B8' },
  { key: 'render_ready', label: 'Ready to send', color: '#64748B' },
  { key: 'sent', label: 'Video sent', color: '#0EA5E9' },
  { key: 'opened', label: 'Opened', color: '#38BDF8' },
  { key: 'playing', label: 'Playing', color: '#14B8A6' },
  { key: 'watched', label: 'Watched', color: '#F59E0B' },
  { key: 'cta_clicked', label: 'Clicked', color: '#F97316' },
  { key: 'checkout_started', label: 'Checkout', color: '#A855F7' },
  { key: 'paid', label: 'Paid 🎉', color: '#16A34A' },
];

/** The minimum a row needs for boardKey — so the inbox can call this with a
 *  short select instead of the whole page row. `play_at` is optional so a
 *  caller that has not selected it degrades to 'opened' rather than failing. */
export type StageShape = Pick<VslPage, 'state' | 'render_status'> & {
  play_at?: string | null;
};

export function boardKey(p: StageShape): string {
  if (p.state === 'created') {
    if (p.render_status === 'queued' || p.render_status === 'rendering') return 'rendering';
    if (p.render_status === 'ready') return 'render_ready';
    return 'created'; // incl. failed — the card wears the error
  }
  /* Pressing play IS movement, and the board has to show it. Without this a
     lead who watched 26% sat in Opened looking identical to one who tapped the
     link and left, so the board read as broken (Hugo 2026-07-27: "if Ignition
     was watched why it under opened").

     Deliberately NOT solved by lowering the watched threshold: someone who
     quit at 26% and someone who sat through 96% are different phone calls, and
     merging them makes Watched useless for choosing who to ring. Playing is
     "started the pitch", Watched stays "got through it". */
  if (p.state === 'opened' && p.play_at) return 'playing';
  return p.state;
}

export function stateMeta(key: string): { label: string; color: string } {
  return STATES.find((s) => s.key === key) ?? { label: key, color: '#9CA3AF' };
}

/**
 * "A human must watch this and text it."
 *
 * NOT `render_status === 'ready'`: render_status never resets after sending, so
 * keying on it alone badges every already sent lead as waiting, forever.
 */
export function isReadyToSend(p: StageShape): boolean {
  return boardKey(p) === 'render_ready';
}

export function ago(ts: string | null): string {
  if (!ts) return '';
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

/** Every stage of one lead's journey, with the exact moment it happened
 *  (Hugo 2026-07-26: "of course all with date and time stamp"). */
export const STAGE_STAMPS: Array<{ key: keyof VslPage; label: string }> = [
  { key: 'sent_at', label: 'Video texted' },
  { key: 'first_click_at', label: 'Tapped the link' },
  { key: 'first_opened_at', label: 'Opened the page' },
  { key: 'play_at', label: 'Started the video' },
  { key: 'watched_at', label: 'Watched (past halfway)' },
  { key: 'completed_at', label: 'Watched to the end' },
  { key: 'cta_clicked_at', label: 'Clicked "Start £1 Trial"' },
  { key: 'checkout_started_at', label: 'Started checkout' },
  { key: 'paid_at', label: 'Paid' },
];

/** The whole life of the page, including the render steps the board never
 *  showed. Hugo 2026-07-27 asked for "date and time when agent click to create
 *  the video" — that is `created_at` / `render_requested_at`. */
export const FULL_TIMELINE: Array<{ key: keyof VslPage; label: string }> = [
  { key: 'created_at', label: 'Page created' },
  { key: 'render_requested_at', label: 'Video requested' },
  { key: 'render_started_at', label: 'Rendering started' },
  { key: 'render_done_at', label: 'Video ready' },
  ...STAGE_STAMPS,
];

/**
 * When this card entered the column it is sitting in — Hugo's "date and time
 * when it moved automatically to any column on the video pipeline".
 *
 * Derived from the funnel's own immutable stamps, not from
 * wk_contacts.stage_moved_at: that holds only the LAST move, so one manual drag
 * would erase the auto-move moment forever.
 */
export function columnEnteredAt(p: VslPage): { key: string; label: string; at: string } {
  const key = boardKey(p);
  const pick = (...vals: Array<string | null | undefined>) =>
    vals.find((v) => !!v) ?? p.updated_at;

  const at =
    key === 'created' ? pick(p.created_at)
    : key === 'rendering' ? pick(p.render_started_at, p.render_requested_at)
    : key === 'render_ready' ? pick(p.render_done_at)
    : key === 'sent' ? pick(p.sent_at)
    : key === 'opened' ? pick(p.first_opened_at)
    : key === 'playing' ? pick(p.play_at)
    : key === 'watched' ? pick(p.watched_at)
    : key === 'cta_clicked' ? pick(p.cta_clicked_at)
    : key === 'checkout_started' ? pick(p.checkout_started_at)
    : key === 'paid' ? pick(p.paid_at)
    : p.updated_at;

  return { key, label: stateMeta(key).label, at };
}

export const EVENT_LABELS: Record<string, string> = {
  link_click: 'Tapped the video link',
  open: 'Opened the page',
  play: 'Started the video',
  progress: 'Watched',
  cta_click: 'Clicked "Start £1 Trial"',
  tier_pick: 'Picked a plan',
  calc: 'Used the value calculator',
  checkout_start: 'Started checkout',
  paid: 'Paid 🎉',
  auto_sms: 'Follow-up text sent',
};

/**
 * What a failed render actually means, in words an agent can act on.
 *
 * The panel used to say "Render failed (their website may not load)" for EVERY
 * failure. On 2026-07-27 that was shown for Clean Blue Water Ltd, whose website
 * was fine: the real cause was that we had no trade for them, so the pipeline
 * refused to invent competitors. Guessing at a cause sends people to fix the
 * wrong thing, so we show the real one.
 *
 * The same lesson, learned again on 2026-07-28: two leads wore "Google didn't
 * return enough real businesses above them" when Google had returned six and
 * eight. The truth was the opposite of what the card said, so the agent had
 * nothing to act on and a retry button that could only fail again.
 */
export function renderErrorText(raw: string | null | undefined): string {
  const e = String(raw || '').trim();
  if (!e) return 'The video failed to render. Try again, or tell Hugo.';
  if (/no trade profile/i.test(e)) {
    return "We don't know this lead's trade, so the video can't honestly name who ranks above them. Set the trade on the lead, then retry.";
  }
  // `real competitors above` is the WORDING OF THE OLD ERROR, kept so rows that
  // failed before 2026-07-28 read correctly instead of keeping the old lie.
  if (/out-reviews everyone|real competitors above/i.test(e)) {
    return 'This lead already has more reviews than almost every business in their town and the towns around it. The video says the ones above them are there because of more reviews, and that would not be true for them, so it was refused rather than faked. Worth a call instead.';
  }
  if (/no real businesses came back/i.test(e)) {
    return 'Google returned no local businesses at all for this search, so there is no search to put on screen. Check the town and the trade on the lead, then retry.';
  }
  if (/missing town/i.test(e)) {
    return 'This lead has no town, and the video builds their Google search from it. Add the town, then retry.';
  }
  if (/website|navigation|timeout|net::|ERR_/i.test(e)) {
    return 'Their website would not load for the recording. Retry, or clear the website on the lead to record the Google search instead.';
  }
  return e;
}

/**
 * Can this failure ever succeed on a retry?
 *
 * Only one cannot: the lead out-reviewing their whole area is a fact about the
 * lead, computed the same way every time, so "Try the video again" reruns an
 * identical sum and fails identically. Offering that button is worse than
 * offering nothing, because it reads as "we just need another go" and an agent
 * will keep pressing it. Everything else is either transient (a deploy, a dead
 * website) or fixable on the lead (no trade, no town), so the button stays.
 */
export function canRetryRender(raw: string | null | undefined): boolean {
  const e = String(raw || '').trim();
  return !/out-reviews everyone|real competitors above/i.test(e);
}
