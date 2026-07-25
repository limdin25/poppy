// Shared helpers for the Social Posting module (FB/IG via Zernio).
// Caption source resolution + posting-schedule day math — used by both the
// queue route and the publishing cron so they stay in lockstep.

export type CaptionMode = 'comment' | 'reply' | 'custom';
export type PostType = 'feed' | 'story';

export interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  reviewer_name: string | null;
  reply_text: string | null;
  review_created_at: string | null;
}

// Preset background kinds are self-contained encoded specs (rendered locally,
// never fetched). Any http(s) background must be one of these allowlisted hosts
// — this blocks SSRF: a client cannot make the server fetch internal/metadata
// URLs (169.254.169.254, localhost, private ranges) via template.background_url.
const PRESET_KINDS = ['solid', 'gradient', 'dots', 'stripes'];
const PRESET_HOSTS = ['images.unsplash.com'];

export function isAllowedBackground(spec: unknown): boolean {
  if (typeof spec !== 'string' || !spec) return false;
  const kind = spec.split(':')[0];
  if (PRESET_KINDS.includes(kind) && !/^https?:/i.test(spec)) return true;
  try {
    const u = new URL(spec);
    if (u.protocol !== 'https:') return false;
    const allowed = new Set<string>(PRESET_HOSTS);
    try { allowed.add(new URL(process.env.SUPABASE_URL!).host); } catch { /* SUPABASE_URL always set in prod */ }
    return allowed.has(u.host);
  } catch {
    return false;
  }
}

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Weekday key (lowercase) for a date in the given IANA timezone. */
export function weekdayKey(date: Date, timezone = 'Europe/London'): Weekday {
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone })
    .format(date)
    .toLowerCase();
  return name as Weekday;
}

/** YYYY-MM-DD for a date in the given timezone (used for "posted today" checks). */
export function localDateKey(date: Date, timezone = 'Europe/London'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date); // en-CA → ISO-like
}

export interface DaySchedule { story: boolean; feed: boolean }
export type ScheduleMap = Record<string, DaySchedule>;

/** Which post types are enabled to publish today for this schedule. */
export function enabledTypesToday(schedule: ScheduleMap | null | undefined, now: Date, timezone = 'Europe/London'): PostType[] {
  const day = schedule?.[weekdayKey(now, timezone)];
  const out: PostType[] = [];
  if (day?.feed) out.push('feed');
  if (day?.story) out.push('story');
  return out;
}

/**
 * The social caption for a review under the chosen source mode.
 * Review Reply mode falls back to the review comment when no reply exists.
 */
export function captionFor(mode: CaptionMode, customCaption: string | null | undefined, review: ReviewRow): string {
  const comment = (review.comment ?? '').trim();
  if (mode === 'custom') return (customCaption ?? '').trim() || comment;
  if (mode === 'reply') return (review.reply_text ?? '').trim() || comment;
  return comment;
}

/** Minimum review text length to be worth turning into a post (mirrors GBP repurposing). */
export const MIN_POST_TEXT = 30;

/** Trim review text to the template's caption-length preference (for the image card). */
export function reviewTextForLength(comment: string | null, length: 'short' | 'medium' | 'long'): string {
  const text = (comment ?? '').trim();
  if (length === 'short') return text.length > 90 ? `${text.slice(0, 87).trimEnd()}…` : text;
  if (length === 'medium') return text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text;
  return text.length > 600 ? `${text.slice(0, 597).trimEnd()}…` : text;
}
