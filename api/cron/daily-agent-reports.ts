// Daily agent reports — 17:30 UK, every day.
//
// Hugo 2026-07-24: "every day at 5:30pm it gives the daily reports, they write
// there on the leaderboard so they can read, and there's a history they can
// always go back and see. Also email me the report."
//
// For each competing agent: pull today's calls + live transcripts, compute the
// stats deterministically (never let the model count), then have Claude write a
// short coaching report from the actual conversations.
//
// Each agent reads ONLY their own report (Hugo 2026-07-24, reversing an earlier
// "both see both" — conduct criticism read in front of a colleague gets
// defended rather than acted on, and it wasn't a fair contest while our own mic
// fault was suppressing one agent's numbers). The leaderboard TABLE stays public
// — that's the competition.
//
// The report stays fully candid. Conduct and compliance items are additionally
// extracted into `flags` and headline Hugo's email, so a swear word or a
// misleading claim about reviews can't sit unnoticed in paragraph four.
//
// Node runtime, not edge: two Claude calls with adaptive thinking can run well
// past the edge budget.

import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../src/integrations/resend/client.js';

export const config = { maxDuration: 300 };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const MODEL = 'claude-opus-4-8';
/** Per agent, per day. Plenty for a coaching card; keeps the job bounded. */
const MAX_TOKENS = 8000;
/** Cap transcripts sent to the model so one heavy day can't blow up the bill. */
const MAX_CONVERSATIONS = 40;
const MAX_CHARS_PER_CONVERSATION = 2600;

const VOICEMAIL = new RegExp(
  [
    'leave (your|a) (message|name)', 'after the tone', 'unable to (take|get)',
    "can'?t (take|get)", 'cannot (take|get)', 'voicemail', 'not available',
    'please record', 'record your (name|message)', 'answer ?phone',
    'messaging service', 'try again later', 'been forwarded',
    "person you'?re? (are )?(calling|trying)", 'get back to you',
    'currently unavailable', "you'?re through to", 'thank you for calling',
    'press one', 'press 1', 'finished your message', "i'?ll see if this person",
    "sorry we can'?t",
  ].join('|'),
  'i',
);

interface Line { speaker: string; body: string | null }
interface CallRow {
  id: string;
  started_at: string | null;
  duration_sec: number | null;
  status: string;
  disposition: string | null;
  company: string | null;
  /** 'property_call' when the dialer room was the Houses one. NULL on plumber
   *  calls and on property calls made before the room stamped it. */
  script_key: string | null;
  lines: Line[];
}

/** Today's date in UK time as YYYY-MM-DD (the cron fires at 17:30 UK). */
function ukToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** UTC bounds for a UK calendar day. */
function ukDayBounds(dateKey: string): { since: string; until: string } {
  // Probe midday UTC to read the day's UK offset without a tz library.
  const probe = new Date(`${dateKey}T12:00:00Z`);
  const uk = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hour12: false,
  }).format(probe);
  const offsetHours = Number(uk) - 12; // 0 in GMT, 1 in BST
  const start = new Date(`${dateKey}T00:00:00Z`);
  start.setUTCHours(start.getUTCHours() - offsetHours);
  const end = new Date(start.getTime() + 86_400_000);
  return { since: start.toISOString(), until: end.toISOString() };
}

const text = (c: CallRow, who?: string) =>
  (c.lines ?? [])
    .filter((l) => !who || l.speaker === who)
    .map((l) => (l.body ?? '').trim())
    .join(' ');

const agentWords = (c: CallRow) => text(c, 'agent').split(/\s+/).filter(Boolean).length;
const isVoicemail = (c: CallRow) => VOICEMAIL.test(text(c, 'caller'));

function computeStats(calls: CallRow[]) {
  const connected = calls.filter((c) => c.status === 'completed');
  const voicemail = calls.filter((c) => c.lines?.length && isVoicemail(c));
  const conversations = calls.filter(
    (c) => c.lines?.length && agentWords(c) > 0 && !isVoicemail(c),
  );
  const real = conversations.filter((c) => (c.duration_sec ?? 0) >= 60);
  // Human picked up, agent said nothing at all — the mic-fault signature.
  const deadAir = calls.filter(
    (c) =>
      c.lines?.length &&
      agentWords(c) === 0 &&
      !isVoicemail(c) &&
      text(c, 'caller').split(/\s+/).filter(Boolean).length >= 2,
  );
  const outcome = (name: string) =>
    calls.filter((c) => (c.disposition ?? '').toLowerCase() === name).length;
  const talkSec = calls.reduce((s, c) => s + (c.duration_sec ?? 0), 0);
  const convWords = conversations.reduce((s, c) => s + agentWords(c), 0);
  const callerWords = conversations.reduce(
    (s, c) => s + text(c, 'caller').split(/\s+/).filter(Boolean).length,
    0,
  );
  const fillers = (text({ lines: conversations.flatMap((c) => c.lines) } as CallRow, 'agent')
    .match(/\b(uh|um)\b/gi) ?? []).length;

  return {
    dials: calls.length,
    connected: connected.length,
    voicemail: voicemail.length,
    conversations: conversations.length,
    real_conversations: real.length,
    dead_air: deadAir.length,
    interested: outcome('interested'),
    booked: outcome('booked'),
    nurturing: outcome('nurturing'),
    not_interested: outcome('not interested'),
    talk_minutes: Math.round(talkSec / 60),
    longest_call_sec: calls.reduce((m, c) => Math.max(m, c.duration_sec ?? 0), 0),
    talk_ratio: callerWords > 0 ? Number((convWords / callerWords).toFixed(2)) : null,
    filler_per_100_words: convWords > 0 ? Number(((fillers * 100) / convWords).toFixed(1)) : null,
  };
}

/** The six script steps, counted in code so the report grades the same way
 *  every day and the model never has to tally.
 *
 *  Hugo 2026-07-27: "make sure daily feedback reports all those things as well,
 *  what needs to improve together with what we already tell them."
 *
 *  These run over ASR text, so they are close but not perfect. The model sees
 *  the transcripts too and is told to believe those over the counter when the
 *  two disagree.
 */
const SAYS_WHO_I_AM = /my name is|it'?s \w+ (from|with|here)|i'?m \w+ from|from hey ?els?ie|hey ?els?ie|from l\.? ?c\b/i;
const SAYS_RECORDING = /record(ed|ing) for|being recorded|call'?s recorded|calls? (is|are) recorded/i;
const SAYS_HOOK = /new to the area|only got .{0,12}reviews|only have .{0,12}reviews/i;
// Keeps the retired "90 second" wording so days before 2026-07-27 still grade
// the same way. The video is 2:35; it was called 90 seconds until Hugo renamed
// it, and agents will keep saying the old words for a while yet.
const SAYS_OFFER = /90[- ]second|ninety second|2[- ]minute|two minute|audit/i;
const SAYS_CLOSE = /will you watch|you'?ll watch it|watch it\?/i;
/** A question asking for their number. "I'll send it to this number" is fine
 *  and must not match — we dialled their mobile, we already have it. */
const ASKS_FOR_NUMBER = /(best|right|correct|good) number|what'?s your (mobile|number)|which number|number to (text|reach) you|number for a text/i;
const READS_OUT_TIERS = /£ ?(99|179|279)|\b(99|179|279) (a|per) month/i;
/** What the prospect says AFTER the offer. Refusal is checked first, because
 *  "yeah, no, I'm all right" and "yeah I'm not interested" both open with a
 *  yes and are both a no. */
const LEAD_REFUSED = /\bnot interested\b|\bno thank|\bi'?m (ok|all ?right|good|fine|busy)\b|don'?t need|no,? ?no\b|call (me |us )?back|tomorrow|another time|too busy|take me off/i;
const LEAD_AGREED = /\b(yes|yeah|yep|sure|go on|please do|send it|send me|send that|ping it|fire it|ok(ay)?)\b/i;

export function scriptCheck(calls: CallRow[]) {
  const convs = calls.filter((c) => c.lines?.length && agentWords(c) > 0 && !isVoicemail(c));
  const agentLines = (c: CallRow) =>
    (c.lines ?? []).filter((l) => l.speaker === 'agent').map((l) => (l.body ?? '').trim());
  const any = (c: CallRow, re: RegExp) => agentLines(c).some((b) => re.test(b));
  const firstIdx = (c: CallRow, re: RegExp) => agentLines(c).findIndex((b) => re.test(b));
  const n = (f: (c: CallRow) => boolean) => convs.filter(f).length;

  return {
    conversations_graded: convs.length,
    // Step 1. Two halves, and the ORDER between them is the whole point: the
    // name earns the right to say the recording line, not the other way round.
    said_who_they_are: n((c) => any(c, SAYS_WHO_I_AM)),
    said_recording_notice: n((c) => any(c, SAYS_RECORDING)),
    name_before_recording: n((c) => {
      const a = firstIdx(c, SAYS_WHO_I_AM);
      const b = firstIdx(c, SAYS_RECORDING);
      return a !== -1 && (b === -1 || a <= b);
    }),
    // Steps 2 to 4.
    reached_hook: n((c) => any(c, SAYS_HOOK)),
    reached_offer: n((c) => any(c, SAYS_OFFER)),
    // Asking is not the same as being told yes, and conflating the two invents
    // a loss that never happened. On 2026-07-27 the report told an agent that
    // "21 asks turned into only 7 videos, that is your money walking out the
    // door" — in fact 5 of those 21 said yes and all 5 got a video. The gap was
    // 16 people saying no, which is a different problem with a different fix.
    offer_agreed: convs.filter((c) => {
      const lines = c.lines ?? [];
      const at = lines.findIndex((l) => l.speaker === 'agent' && SAYS_OFFER.test(l.body ?? ''));
      if (at === -1) return false;
      return lines.slice(at + 1).some((l) => {
        const b = (l.body ?? '').trim();
        return l.speaker === 'caller' && !LEAD_REFUSED.test(b) && LEAD_AGREED.test(b);
      });
    }).length,
    used_close: n((c) => any(c, SAYS_CLOSE)),
    // Rule breaks. Both should be zero.
    asked_for_their_number: n((c) => any(c, ASKS_FOR_NUMBER)),
    read_out_monthly_tiers: n((c) => any(c, READS_OUT_TIERS)),
  };
}

/** Dialling pace and dead time. A perfect script at 49 dials loses to a rough
 *  one at 177, so the report has to see both. Gaps are measured between the end
 *  of one call and the start of the next; a lunch break shows up here as one
 *  long gap, which is exactly what we want the agent to see. */
export function paceStats(calls: CallRow[]) {
  const t = calls
    .filter((c) => c.started_at)
    .map((c) => ({
      start: new Date(c.started_at as string).getTime(),
      end: new Date(c.started_at as string).getTime() + (c.duration_sec ?? 0) * 1000,
    }))
    .sort((a, b) => a.start - b.start);
  if (t.length === 0) {
    return { dials: 0, minutes_on_calls: 0, longest_gap_minutes: 0, gaps_over_10_min: 0, idle_minutes: 0, dials_per_hour: null as number | null };
  }
  const gaps: number[] = [];
  for (let i = 1; i < t.length; i += 1) gaps.push(Math.max(0, (t[i].start - t[i - 1].end) / 60_000));
  const spanMin = (t[t.length - 1].end - t[0].start) / 60_000;
  const onCalls = t.reduce((s, x) => s + (x.end - x.start) / 60_000, 0);
  return {
    dials: calls.length,
    minutes_on_calls: Math.round(onCalls),
    longest_gap_minutes: Math.round(Math.max(0, ...gaps)),
    gaps_over_10_min: gaps.filter((g) => g > 10).length,
    idle_minutes: Math.round(gaps.reduce((s, g) => s + g, 0)),
    dials_per_hour: spanMin > 0 ? Number((calls.length / (spanMin / 60)).toFixed(1)) : null,
  };
}

export interface VslPageRow {
  created_at: string | null;
  sent_at: string | null;
  render_status: string | null;
  first_opened_at: string | null;
  watched_at: string | null;
}

/** The scoreboard. Everything else on this report is a means to this end.
 *
 *  Hugo 2026-07-27: "we need videos sent on the grade as well, and
 *  conversations". Dials and script steps are process; a video landing on a
 *  plumber's phone is the only thing that pays, so it leads the grade.
 *
 *  A render that failed or is still going is NOT held against the agent: they
 *  did their job on the call, the box let them down.
 */
export function videoStats(pages: VslPageRow[], since: string, until: string) {
  const inDay = (t: string | null) => !!t && t >= since && t < until;
  const made = pages.filter((p) => inDay(p.created_at));
  const sent = pages.filter((p) => inDay(p.sent_at));
  return {
    videos_made: made.length,
    videos_sent: sent.length,
    videos_still_rendering: made.filter((p) => p.render_status === 'queued' || p.render_status === 'rendering').length,
    videos_render_failed: made.filter((p) => p.render_status === 'failed').length,
    videos_ready_not_sent: made.filter((p) => p.render_status === 'ready' && !p.sent_at).length,
    videos_opened: sent.filter((p) => p.first_opened_at).length,
    videos_watched: sent.filter((p) => p.watched_at).length,
  };
}

// ---------------------------------------------------------------------------
// The PROPERTY business. Hugo, 2026-08-10: "the Google business is dead ...
// now we are selling, we are making offers on properties. That's what we are
// doing now." The first property calling day was graded by this cron against
// the HeyElsie reviews script and scored zero, a report about a business the
// agent is not in. A day with property_call-stamped calls is graded against
// the property script instead; a sales day is graded exactly as before.
// ---------------------------------------------------------------------------

/** True when this agent's day was the property business. The 'property_call'
 *  stamp comes from the dialer room; calls made from a mis-landed room carry
 *  NULL, so one stamped call marks the whole day rather than requiring all. */
export function isPropertyDay(calls: CallRow[]): boolean {
  return calls.some((c) => c.script_key === 'property_call');
}

/** Rough text of an HTML script, good enough for a model to read as THE
 *  SCRIPT. Headings kept, styles/notes markup dropped. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<h2[^>]*>/gi, '\n\n## ')
    .replace(/<h3[^>]*>/gi, '\n\n### ')
    .replace(/<(p|div|li|tr|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The property script, read live: the DB copy when an admin has saved one in
 *  the dialer (wk_property_call_script.html), else the bundled default the
 *  script pane falls back to. Same rule as the screen, so the report grades
 *  the words Pedro was actually shown. */
async function loadPropertyScript(): Promise<string> {
  const { data } = await supabase
    .from('wk_property_call_script')
    .select('html')
    .eq('id', 1)
    .maybeSingle();
  let html = (data?.html as string | null) ?? '';
  if (!html) {
    try {
      html = readFileSync(
        join(process.cwd(), 'src', 'core', 'content', 'property-call-script.html'),
        'utf8',
      );
    } catch {
      // Deployed without the file: the step counters still grade the day.
      html = '';
    }
  }
  return htmlToText(html);
}

// Detected from ASR text, so wide on purpose: the transcriber writes "Ugo at
// Unio" for "Hugo at Unico" and the counts must not punish the transcriber.
const P_AVAILABILITY = /still (available|on the market|for sale|up for sale|got (it|that one))|is (it|that one|this one) (still )?available/i;
const P_INTRO = /(work|working) with .{0,30}(director|hugo|ugo)|director,? (hugo|ugo)|at uni?c?o\b|from uni?c?o\b|with uni?c?o\b|we buy in the area/i;
const P_CASH = /\bcash\b/i;
const P_ASKS_NAME = /who am i (speaking|talking)|who'?s (this|that)(,? sorry)?|what'?s your name|catch your name|sorry,? your name|by the way,? who/i;
const P_OCCUPANCY = /vacant|tenant|tenanted|anybody (in|living)|somebody (in|living)|empty|occupied|lived in/i;
const P_CONDITION = /condition|needs? (work|doing|much)|ready to move|refurb|modernis|liveable|livable|state of it|roof|damp|boiler|electrics/i;
const P_INTEREST = /(much|any) interest|any offers|offers (so far|on it)|fall(en|s)? through|fell through/i;
const P_MOTIVE = /why (are )?they('?re)? selling|why'?s it (for sale|up|on)|reason .{0,25}sell|in a hurry|motivated/i;
const P_TIME_ON_MARKET = /how long('?s| has| is)? it been|been on (the market|with you)|price (come down|came down|dropped|reduced)|any reductions|reduced at all/i;
const P_TENURE = /freehold|leasehold/i;
/** Money in ASR text: "£62,000", "62k", "62 grand", "sixty two thousand". */
const P_MONEY = /£ ?\d|\b\d{2,3}[.,]?\d{0,3} ?(k\b|grand|thousand)|\b(fifty|sixty|seventy|eighty|ninety|hundred)([- ]\w+)? (thousand|grand)/i;
/** The offer WITHOUT offering: "if we were to offer around X, am I in the
 *  ballpark". Also credited when a number is floated with offer language. */
const P_FLOATS_FIGURE = /if we (were|was) to (offer|come in|go in)|in the ball ?park|million miles (off|away)|silly offer/i;
const P_FLOAT_WORDS = /offer|stretch to|could (probably )?do|start(ing)? (at|around)|come in (at|around)|go in (at|around)/i;
const P_ASKS_THEIR_FIGURE = /what (would|do you (think|reckon))[^.?!]{0,45}(take|accept|get it (done|over)|land|sell)|what sort of (figure|number|price)|what('?s| is) the (figure|number)[^.?!]{0,25}(done|line)|where[^.?!]{0,30}they'?d land|would (actually|honestly) (take|accept)/i;
const P_CALLBACK = /ring you back|call (you )?back|speak to you (then|soon|tomorrow|monday|tuesday|wednesday|thursday|friday)|when'?s (good|best|a good time)|best time to (catch|ring|call|reach)|later (today|in the week)|tomorrow morning|give you a (ring|call|bell) (back )?(tomorrow|later|next week|in a few weeks)/i;
// Rule breaks. The deflections the script TEACHES must not count as breaks:
// "nothing I've said today is a formal offer" contains "formal offer", and
// "let me check Hugo's diary" is the correct viewing dodge.
const P_FORMAL_OFFER = /\b(i'?m|we'?re|we are|i am) offering\b|formal offer|official offer|put (an|the|our) offer in\b|(i'?d|we'?d|i would|we would) like to offer|offer (is|stands) (final|binding)|we('?ll| will) take it\b/i;
const P_FORMAL_OFFER_DEFLECTION = /nothing i('?ve| have) said|not (a |the )?(formal|binding)|isn'?t (a |the )?(formal|binding)|no formal offer|find out if we'?re in the right area/i;
const P_BOOKS_VIEWING = /\b(book|arrange|schedule|set up)[^.?!]{0,20}viewing|book (you|us|me) in\b|viewing (for|at) (today|tomorrow|\d)/i;
const P_VIEWING_DEFLECTION = /check (hugo|ugo)'?s? diary|(hugo|ugo|director)[^.?!]{0,30}(diary|arrange|be there|book)|come back to you|what (have you got|times are) free/i;
const P_SOURCER_TALK = /\bsourc(er|ers|ing)\b|done a course|on a course|training course|my mentor|list of investors/i;

/** The property steps, counted in code so the report grades the same way
 *  every day and the model never has to tally. Same contract as scriptCheck():
 *  live conversations only, ASR-close-not-exact, transcripts win on a clash. */
export function propertyScriptCheck(calls: CallRow[]) {
  const convs = calls.filter((c) => c.lines?.length && agentWords(c) > 0 && !isVoicemail(c));
  const agentLines = (c: CallRow) =>
    (c.lines ?? []).filter((l) => l.speaker === 'agent').map((l) => (l.body ?? '').trim());
  const any = (c: CallRow, re: RegExp) => agentLines(c).some((b) => re.test(b));
  const n = (f: (c: CallRow) => boolean) => convs.filter(f).length;

  const floated = (c: CallRow) =>
    agentLines(c).some((b) => P_FLOATS_FIGURE.test(b) || (P_MONEY.test(b) && P_FLOAT_WORDS.test(b)));

  return {
    conversations_graded: convs.length,
    // The opener and the intro.
    asked_availability: n((c) => any(c, P_AVAILABILITY)),
    said_who_we_are: n((c) => any(c, P_INTRO)),
    said_cash: n((c) => any(c, P_CASH)),
    asked_their_name: n((c) => any(c, P_ASKS_NAME)),
    // The checklist, one number per fact family.
    asked_occupancy: n((c) => any(c, P_OCCUPANCY)),
    asked_condition: n((c) => any(c, P_CONDITION)),
    asked_interest: n((c) => any(c, P_INTEREST)),
    asked_why_selling: n((c) => any(c, P_MOTIVE)),
    asked_time_on_market: n((c) => any(c, P_TIME_ON_MARKET)),
    asked_tenure: n((c) => any(c, P_TENURE)),
    // The money. Floating a figure and asking for theirs are different skills
    // and different numbers, exactly like reached_offer vs offer_agreed.
    floated_a_figure: n(floated),
    asked_them_for_a_figure: n((c) => any(c, P_ASKS_THEIR_FIGURE)),
    // A branch NAMING money back is the score of the call. Counted only after
    // the agent opened the money conversation, so "it's on at 150" in the
    // availability chat does not inflate it.
    lead_named_figure: convs.filter((c) => {
      const lines = c.lines ?? [];
      const at = lines.findIndex(
        (l) => l.speaker === 'agent'
          && (P_FLOATS_FIGURE.test(l.body ?? '') || P_ASKS_THEIR_FIGURE.test(l.body ?? '')
            || (P_MONEY.test(l.body ?? '') && P_FLOAT_WORDS.test(l.body ?? ''))),
      );
      if (at === -1) return false;
      return lines.slice(at + 1).some((l) => l.speaker === 'caller' && P_MONEY.test(l.body ?? ''));
    }).length,
    agreed_callback_time: n((c) => any(c, P_CALLBACK)),
    // Rule breaks. All should be zero.
    made_formal_offer: n((c) =>
      agentLines(c).some((b) => P_FORMAL_OFFER.test(b) && !P_FORMAL_OFFER_DEFLECTION.test(b))),
    booked_a_viewing: n((c) =>
      agentLines(c).some((b) => P_BOOKS_VIEWING.test(b) && !P_VIEWING_DEFLECTION.test(b))),
    sourcer_or_course_talk: n((c) => any(c, P_SOURCER_TALK)),
  };
}

/** Which outcome buttons were actually pressed, by name. The property pipeline
 *  has its own columns, so this is a map rather than the four sales fields. */
export function dispositionCounts(calls: CallRow[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of calls) {
    const d = (c.disposition ?? 'none pressed').toLowerCase();
    m[d] = (m[d] ?? 0) + 1;
  }
  return m;
}

interface HousesTabStats {
  houses_outcomes_logged: number;
  houses_outcomes: Record<string, number>;
  figures_reported: string[];
}

/** What went through the Houses tab (api/crm/property-outcome.ts): the
 *  qualified / figure_obtained / callback log with the figures the branch
 *  gave. Zero while calls exist means the tab is not being used, which the
 *  report is told to coach rather than guess around. */
async function housesTabStats(agentId: string, since: string, until: string): Promise<HousesTabStats> {
  const { data } = await supabase
    .from('brrr_property_calls')
    .select('qualification')
    .eq('channel', 'human')
    .eq('human_agent_id', agentId)
    .gte('updated_at', since)
    .lt('updated_at', until);
  const rows = (data ?? []) as Array<{ qualification: Record<string, unknown> | null }>;
  const outcomes: Record<string, number> = {};
  const figures: string[] = [];
  for (const r of rows) {
    const q = r.qualification ?? {};
    const o = String(q.outcome ?? 'unknown');
    outcomes[o] = (outcomes[o] ?? 0) + 1;
    const fig = q.best_price_indicated;
    if (typeof fig === 'string' && fig.trim()) figures.push(fig.trim());
    else if (typeof fig === 'number') figures.push(String(fig));
  }
  return { houses_outcomes_logged: rows.length, houses_outcomes: outcomes, figures_reported: figures };
}

const PROPERTY_SYSTEM = `You write the end-of-day coaching report for a UK property deal-sourcing caller. They ring estate agents about specific listed properties on behalf of a cash buyer: the company is Unico, the director is Hugo, and the agent's job on every call is to confirm the property is available, work a 16-question fact checklist, then run the money conversation themselves: float an opening figure WITHOUT making a formal offer, go quiet, get the branch to name a figure back, push back once with a comparable sale, and climb their ladder one rung at a time. "Let me put that to Hugo" is a lever used late, never an opener. They must NEVER make a formal or binding offer, NEVER book a viewing (the director arranges those), never quote completion timescales, and never reveal or confirm their walk-away ceiling.

The agent reads this report themselves. Write it to be read by the person it is about.

Be direct and complete. Your job is to tell them everything that would make them better tomorrow, not to be gentle. Do not soften, omit, or generalise a problem to spare feelings. At the same time you are a coach, not a disciplinarian: give the fix, not a telling-off.

Non-negotiable: you MUST report these explicitly if they appear anywhere in the transcripts:
- Swearing or crude language by the agent. Quote it verbatim, name the agency and call_id, and say plainly that it is not acceptable on a business call.
- Rudeness, arguing, talking over people, or pressuring a branch that has clearly said no.
- A formal or binding offer, or agreeing a price as if it were final. Only the director can offer.
- Booking or promising a viewing, or committing the director to a time.
- Inventing facts: funds, completion timescales, valuations, or company details. The company line is Unico (full name Ulinc Unico Group Limited) and anything beyond the approved details is the director's to share.
- Saying or confirming the walk-away ceiling out loud.
Never leave one of these out because the day went well otherwise.

Ground every point in what actually happened. Quote the agent's own words, and cite the agency name so they can find the call. Never invent a quote. The statistics are given to you and are correct. Never recompute them or contradict them.

The transcripts come from imperfect speech recognition and it MANGLES PROPER NOUNS: "Hugo" arrives as "Ugo", "Unico" as "Unio" or "Nico". Treat those spellings as the transcriber's fault, never the agent's pronunciation, and never coach anyone off a mangled name alone.

You are given THE SCRIPT the agent is supposed to follow, and a step-by-step count of how often they actually reached each part of it. Grade them against that script every single day, even on a good day. This is the standing coaching, and it does not get dropped because the day went well.

Write in British English, plain language, second person ("you"). Never write a long dash (em or en dash) or curly quotes; use a comma, a colon, brackets or a new sentence instead. That is a standing company rule for everything the software writes. Markdown, no title heading, roughly 300-450 words, in this order:

**Today**: two or three sentences on how the day actually went. Cover pace as well as quality: dials, time actually on the phone, any long gap with no calls.
**What worked**: up to three specific things, each with a quote or an agency name.
**The grade**: the day as one funnel, on its own lines: dials, conversations, availability confirmed, money conversations opened, figures obtained from the branch, callbacks agreed with a time. Then say plainly which step is losing the most. A figure out of the branch's mouth is the score that matters; a polite day of chat that never reaches the money is not a good day. If outcomes were not logged in the Houses tab, say so: the figures are the reason the calls happen and they must be written down where the director can see them.
**Script check**: go through the steps in order with the number for each: the availability opener, the intro (name, Unico, the word cash), their name taken, the fact checklist, the floated figure, asking THEM for a figure, the callback time, then the rule breaks (formal offer, booked viewing, sourcer/course talk), which should all be zero. Where a step is being missed, quote the words used instead. Praise the steps they are hitting; do not only list failures.
**Fix tomorrow**: every genuine problem you found, most important first, each with the concrete words or action to use instead. Include the non-negotiables above here if they occurred.
**Tomorrow's one thing**: a single sentence naming the one change that would make the biggest difference.

After the report, and only if one or more of the non-negotiables above actually occurred, append this exact delimiter on its own line:

---FLAGS---

followed by a JSON array, one object per item, and nothing else:
[{"type":"swearing|rudeness|pressure|formal_offer|booked_viewing|invented_fact|said_ceiling","quote":"their exact words","company":"agency name","call_id":"the call_id","why":"one sentence on why it matters"}]

Emit the delimiter only when there is at least one item. Never emit an empty array. The flags duplicate what you already wrote in the report; they are an index for the business owner, not a replacement.`;

async function writePropertyReport(
  agentName: string,
  dateKey: string,
  stats: ReturnType<typeof computeStats>,
  transcripts: string,
  script: string,
  adherence: ReturnType<typeof propertyScriptCheck>,
  pace: ReturnType<typeof paceStats>,
  dispositions: Record<string, number>,
  houses: HousesTabStats,
): Promise<string> {
  const prompt = `Agent: ${agentName}
Date: ${dateKey}
Business: property deal sourcing, ringing estate agents about listed properties for a cash buyer. This agent does NOT sell anything and has nothing to do with the retired Google-reviews product; if a transcript shows them pitching reviews or videos, that is them reading the wrong script and it belongs under Fix tomorrow.

STATISTICS (authoritative, do not recompute):
${JSON.stringify(stats, null, 2)}

Notes on the stats:
- "dead_air" = a human answered but the agent's audio never reached them. This is a KNOWN SYSTEM FAULT, not the agent's fault. If it is above zero, say so explicitly and reassure them it is not counted against them.
- "conversations" excludes voicemail. "real_conversations" are those lasting 60s or more.
- "talk_ratio" is agent words per lead word. Above ~1.8 means they are talking over people. On this script LISTENING is the job: the checklist answers and the branch's figure are the product.
- "interested" / "booked" here are the generic CRM buttons, not the property outcomes. The outcome buttons pressed are listed next.

OUTCOME BUTTONS PRESSED (authoritative):
${JSON.stringify(dispositions, null, 2)}

HOUSES TAB, property outcomes logged (authoritative):
${JSON.stringify(houses, null, 2)}

Notes on the Houses tab:
- This is where a property call's real outcome lives: qualified / figure obtained / callback / not qualified, plus the figure the branch indicated, written down for the director.
- If "houses_outcomes_logged" is 0 while conversations happened, the day's figures exist only in the agent's head. Say so plainly under Fix tomorrow: every conversation ends with an outcome picked in the Houses tab and the figure typed in, before the next dial.

DIALLING PACE (authoritative):
${JSON.stringify(pace, null, 2)}

Notes on pace:
- "idle_minutes" is the total time between calls. One long gap is a lunch break and is theirs to take; say so rather than treating it as slacking. Several long gaps, or a "longest_gap_minutes" running into hours, is the day leaking away and should be named plainly.

THE SCRIPT THEY ARE MEANT TO FOLLOW (property call):
${script || '(no script on file)'}

SCRIPT STEPS REACHED, out of ${adherence.conversations_graded} live conversations:
${JSON.stringify(adherence, null, 2)}

Notes on the script counts:
- These are detected from the transcript text, which comes from imperfect speech recognition. They are close, not exact. Where a count disagrees with what you can plainly read in the transcripts, believe the transcripts and say what you actually saw.
- "floated_a_figure" is the offer-without-offering ("if we were to offer around X, am I in the ballpark"). "asked_them_for_a_figure" is the other half of the money conversation. "lead_named_figure" is the score: a number out of the branch's mouth.
- "made_formal_offer", "booked_a_viewing" and "sourcer_or_course_talk" are rule breaks and should all be zero. The script's own deflection lines ("nothing I've said today is a formal offer", "let me check Hugo's diary") are correct play and are already excluded from those counts.

TRANSCRIPTS OF TODAY'S LIVE CONVERSATIONS (voicemails excluded):
${transcripts || '(no live conversations today)'}`;

  return callClaude(PROPERTY_SYSTEM, prompt);
}

/** Transcripts of real conversations only — voicemails carry no coaching signal. */
function transcriptBlock(calls: CallRow[]): string {
  return calls
    .filter((c) => c.lines?.length && agentWords(c) > 0 && !isVoicemail(c))
    .sort((a, b) => (b.duration_sec ?? 0) - (a.duration_sec ?? 0))
    .slice(0, MAX_CONVERSATIONS)
    .map((c) => {
      const head = `### ${c.company ?? 'Unknown'} — ${c.duration_sec ?? 0}s — outcome: ${c.disposition ?? 'none'} — call_id: ${c.id}`;
      const body = (c.lines ?? [])
        .map((l) => `${l.speaker === 'agent' ? 'AGENT' : 'LEAD '}: ${(l.body ?? '').trim()}`)
        .join('\n')
        .slice(0, MAX_CHARS_PER_CONVERSATION);
      return `${head}\n${body}`;
    })
    .join('\n\n');
}

const SYSTEM = `You write the end-of-day coaching report for a UK outbound sales agent selling a Google-reviews service to plumbers.

The agent reads this report themselves, and so does the other agent on the team — write it to be read by the person it is about.

Be direct and complete. Your job is to tell them everything that would make them better tomorrow, not to be gentle. Do not soften, omit, or generalise a problem to spare feelings. At the same time you are a coach, not a disciplinarian: give the fix, not a telling-off.

Non-negotiable: you MUST report these explicitly if they appear anywhere in the transcripts:
- Swearing or crude language by the agent. Quote it verbatim, name the company and call_id, and say plainly that it is not acceptable on a customer call.
- Rudeness, arguing with a prospect, talking over them, or pressuring someone who has clearly said no.
- Anything misleading about price, what is free, or what the product does.
- Getting the prospect's or company's name wrong.
Never leave one of these out because the day went well otherwise.

Ground every point in what actually happened. Quote the agent's own words, and cite the company name so they can find the call. Never invent a quote. The statistics are given to you and are correct — never recompute or contradict them.

You are given THE SCRIPT the agent is supposed to follow, and a step-by-step count of how often they actually reached each part of it. Grade them against that script every single day, even on a good day. This is the standing coaching, and it does not get dropped because the day went well or because you found something more interesting to write about.

Write in British English, plain language, second person ("you"). Never write a long dash (em or en dash) or curly quotes; use a comma, a colon, brackets or a new sentence instead. That is a standing company rule for everything the software writes. Markdown, no title heading, roughly 300-450 words, in this order:

**Today**: two or three sentences on how the day actually went. Cover pace as well as quality: dials, time actually on the phone, and any long gap with no calls. A perfect script at 49 dials loses to a rough one at 177, so say which of the two is holding them back.
**What worked**: up to three specific things, each with a quote or a company name.
**The grade**: the day as one funnel, on its own lines: dials, conversations, offers made, offers agreed, videos made, videos sent. Then say plainly which step is losing the most and what that costs. Videos sent is the score that matters; a day of perfect calls with no videos sent is not a good day, and a rough day with videos sent beats it. If a render failed or is still going, say so and make clear it is not held against them.
**Script check** — go through the six steps in order and give the number for each: opener (name and HeyElsie BEFORE the recording line), hook, offer, the close, and the two rule breaks (asking for their number, reading out monthly prices). One line per step, the count, then a word on whether that is good or not. Where a step is being missed, quote the words they used instead. Praise the steps they are hitting; do not only list failures.
**Fix tomorrow**: every genuine problem you found, most important first, each with the concrete words or action to use instead. Include the non-negotiables above here if they occurred.
**Tomorrow's one thing**: a single sentence naming the one change that would make the biggest difference.

After the report, and only if one or more of the non-negotiables above actually occurred, append this exact delimiter on its own line:

---FLAGS---

followed by a JSON array, one object per item, and nothing else:
[{"type":"swearing|rudeness|pressure|misleading|wrong_name","quote":"their exact words","company":"company name","call_id":"the call_id","why":"one sentence on why it matters"}]

Emit the delimiter only when there is at least one item. Never emit an empty array. The flags duplicate what you already wrote in the report; they are an index for the business owner, not a replacement.`;

export interface ConductFlag {
  type: string;
  quote: string;
  company: string;
  call_id: string;
  why: string;
}

/** Split the model's output into the agent-facing report and the owner-facing
 *  conduct index. A malformed or missing FLAGS block must never cost us the
 *  report — fall back to the whole text with no flags. */
export function splitReport(raw: string): { body: string; flags: ConductFlag[] } {
  const idx = raw.indexOf('---FLAGS---');
  if (idx === -1) return { body: raw.trim(), flags: [] };
  const body = raw.slice(0, idx).trim();
  const tail = raw.slice(idx + '---FLAGS---'.length).trim();
  const start = tail.indexOf('[');
  const end = tail.lastIndexOf(']');
  if (start === -1 || end <= start) return { body, flags: [] };
  try {
    const parsed = JSON.parse(tail.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return { body, flags: [] };
    return {
      body,
      flags: parsed.filter(
        (f): f is ConductFlag =>
          !!f && typeof f === 'object' && typeof (f as ConductFlag).quote === 'string',
      ),
    };
  } catch {
    return { body, flags: [] };
  }
}

async function writeReport(
  agentName: string,
  dateKey: string,
  stats: ReturnType<typeof computeStats>,
  transcripts: string,
  script: string,
  adherence: ReturnType<typeof scriptCheck>,
  pace: ReturnType<typeof paceStats>,
  videos: ReturnType<typeof videoStats>,
): Promise<string> {
  const prompt = `Agent: ${agentName}
Date: ${dateKey}

STATISTICS (authoritative — do not recompute):
${JSON.stringify(stats, null, 2)}

Notes on the stats:
- "dead_air" = a human answered but the agent's audio never reached them. This is a KNOWN SYSTEM FAULT, not the agent's fault. If it is above zero, say so explicitly and reassure them it is not counted against them.
- "conversations" excludes voicemail. "real_conversations" are those lasting 60s or more.
- "talk_ratio" is agent words per lead word. Above ~1.8 means they are talking over the prospect.

VIDEOS (authoritative — this is the scoreboard):
${JSON.stringify(videos, null, 2)}

Notes on videos:
- "videos_sent" is the number that counts. Everything else on this report exists to move it.
- The whole day's funnel is: dials -> conversations -> offers ("can I send it to you?") -> agreed -> videos made -> videos sent. Name the step where most is lost.
- "reached_offer" is how many times they ASKED. "offer_agreed" is how many said yes. They are not the same number and you must never treat them as one. Losing people between asking and agreeing is prospects saying no, which is a persuasion problem. Losing people between agreeing and a video is a video that never got made, which is a completely different and much more serious problem. Do not claim a yes was lost unless you can see that yes in a transcript with no video behind it.
- "videos_render_failed" and "videos_still_rendering" are OUR system, not the agent. Never criticise them for those; mention them so the agent knows the video did not land and can follow up.
- "videos_ready_not_sent" IS theirs: the video is built and sitting there waiting to be texted.

DIALLING PACE (authoritative):
${JSON.stringify(pace, null, 2)}

Notes on pace:
- "idle_minutes" is the total time between calls. One long gap is a lunch break and is theirs to take; say so rather than treating it as slacking. Several long gaps, or a "longest_gap_minutes" running into hours, is the day leaking away and should be named plainly.

THE SCRIPT THEY ARE MEANT TO FOLLOW:
${script || '(no script on file)'}

SCRIPT STEPS REACHED, out of ${adherence.conversations_graded} live conversations:
${JSON.stringify(adherence, null, 2)}

Notes on the script counts:
- These are detected from the transcript text, which comes from imperfect speech recognition. They are close, not exact. Where a count disagrees with what you can plainly read in the transcripts, believe the transcripts and say what you actually saw.
- "name_before_recording" is the one that matters most in the opener. Saying the recording notice without first saying who you are and that you are from HeyElsie makes the call sound like a scam, and prospects react to it.
- "asked_for_their_number" and "read_out_monthly_tiers" are rule breaks and should both be zero. We dial their mobile, so we already have their number; asking for it makes us sound like we bought a list.

TRANSCRIPTS OF TODAY'S LIVE CONVERSATIONS (voicemails excluded):
${transcripts || '(no live conversations today)'}`;

  return callClaude(SYSTEM, prompt);
}

/** One place for the model call, shared by the sales and property reports. */
async function callClaude(system: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
  };
  if (data.stop_reason === 'refusal') throw new Error('model refused');
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
    .trim();
}

// Node runtime handler shape (req, res) — NOT the edge Request/Response API.
// The edge signature compiles fine but throws `req.headers.get is not a
// function` at runtime on Node.
export default async function handler(
  req: {
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
  },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): Promise<void> {
  const rawAuth = req.headers['authorization'];
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // ?date=YYYY-MM-DD re-runs a past day (backfill / manual retry).
  const rawDate = req.query?.date;
  const dateKey = (Array.isArray(rawDate) ? rawDate[0] : rawDate) || ukToday(new Date());
  const { since, until } = ukDayBounds(dateKey);

  // Roster: same rule as the leaderboard — a CRM agent or an account with a
  // limits row, minus anyone an admin has un-ticked.
  const { data: limits } = await supabase
    .from('wk_voice_agent_limits')
    .select('agent_id, show_on_leaderboard');
  const hidden = new Set(
    (limits ?? []).filter((l) => l.show_on_leaderboard === false).map((l) => l.agent_id),
  );
  const limitIds = (limits ?? []).map((l) => l.agent_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, email, workspace_role')
    .or([`workspace_role.eq.agent`, `id.in.(${limitIds.join(',') || '00000000-0000-0000-0000-000000000000'})`].join(','));

  const roster = (profiles ?? []).filter((p) => !hidden.has(p.id));

  // The script the report grades against. Read live rather than hardcoded, so
  // an edit in the CRM changes tomorrow's coaching with no deploy.
  const { data: scriptRow } = await supabase
    .from('wk_call_scripts')
    .select('body_md')
    .eq('is_default', true)
    .maybeSingle();
  const script = (scriptRow?.body_md as string | undefined) ?? '';

  const written: Array<{
    name: string;
    body: string;
    stats: ReturnType<typeof computeStats>
      & ReturnType<typeof paceStats>
      & ReturnType<typeof videoStats>
      & { script_check: ReturnType<typeof scriptCheck> };
    flags: ConductFlag[];
  }> = [];

  const writtenProperty: Array<{
    name: string;
    body: string;
    stats: ReturnType<typeof computeStats>
      & ReturnType<typeof paceStats>
      & HousesTabStats
      & {
        kind: 'property';
        dispositions: Record<string, number>;
        script_check: ReturnType<typeof propertyScriptCheck>;
      };
    flags: ConductFlag[];
  }> = [];
  // Loaded once, and only on a day that actually has a property agent.
  let propertyScript: Promise<string> | null = null;

  for (const agent of roster) {
    const name = (agent.name || agent.email || 'Agent') as string;
    const { data: calls } = await supabase
      .from('wk_calls')
      .select('id, started_at, duration_sec, status, disposition_column_id, contact_id, script_key')
      .eq('agent_id', agent.id)
      .gte('started_at', since)
      .lt('started_at', until);

    if (!calls || calls.length === 0) continue; // no calls, no report

    // Hydrate transcripts, dispositions and company names for the day.
    const ids = calls.map((c) => c.id);
    const [{ data: lines }, { data: cols }, { data: contacts }] = await Promise.all([
      supabase.from('wk_live_transcripts').select('call_id, speaker, body, ts').in('call_id', ids).order('ts'),
      supabase.from('wk_pipeline_columns').select('id, name'),
      supabase.from('wk_contacts').select('id, name').in('id', calls.map((c) => c.contact_id).filter(Boolean) as string[]),
    ]);
    const byCall = new Map<string, Line[]>();
    for (const l of lines ?? []) {
      const arr = byCall.get(l.call_id) ?? [];
      arr.push({ speaker: l.speaker, body: l.body });
      byCall.set(l.call_id, arr);
    }
    const colName = new Map((cols ?? []).map((c) => [c.id, c.name as string]));
    const contactName = new Map((contacts ?? []).map((c) => [c.id, c.name as string]));

    const rows: CallRow[] = calls.map((c) => ({
      id: c.id,
      started_at: c.started_at,
      duration_sec: c.duration_sec,
      status: c.status,
      disposition: c.disposition_column_id ? colName.get(c.disposition_column_id) ?? null : null,
      company: c.contact_id ? contactName.get(c.contact_id) ?? null : null,
      script_key: (c as { script_key?: string | null }).script_key ?? null,
      lines: byCall.get(c.id) ?? [],
    }));

    // A property day is graded against the property business, full stop.
    // Grading Pedro's estate-agent calls against the dead Google-reviews
    // script produced a report that scored his best day zero (2026-08-10).
    if (isPropertyDay(rows)) {
      const [script, houses] = await Promise.all([
        propertyScript ?? (propertyScript = loadPropertyScript()),
        housesTabStats(agent.id, since, until),
      ]);
      const dispositions = dispositionCounts(rows);
      const adherence = propertyScriptCheck(rows);
      const stats = {
        kind: 'property' as const,
        ...computeStats(rows),
        ...paceStats(rows),
        ...houses,
        dispositions,
        script_check: adherence,
      };
      let raw: string;
      try {
        raw = await writePropertyReport(
          name, dateKey, computeStats(rows), transcriptBlock(rows),
          script, adherence, paceStats(rows), dispositions, houses,
        );
      } catch (e) {
        console.error(`[daily-report] ${name} (property) failed:`, e);
        continue;
      }
      if (!raw) continue;
      const { body, flags } = splitReport(raw);
      if (!body) continue;
      const { error } = await supabase.from('wk_agent_daily_reports').upsert(
        { agent_id: agent.id, report_date: dateKey, stats, body_md: body, flags, model: MODEL, updated_at: new Date().toISOString() },
        { onConflict: 'agent_id,report_date' },
      );
      if (error) console.error(`[daily-report] upsert failed for ${name}:`, error.message);
      else writtenProperty.push({ name, body, stats, flags });
      continue;
    }

    // Videos are fetched on their own window rather than joined to the day's
    // calls: a video made today off yesterday's call still counts as today's
    // work, and a video SENT today counts today even if it was made yesterday.
    const { data: pages } = await supabase
      .from('wk_vsl_pages')
      .select('created_at, sent_at, render_status, first_opened_at, watched_at')
      .eq('agent_id', agent.id)
      .or(`and(created_at.gte.${since},created_at.lt.${until}),and(sent_at.gte.${since},sent_at.lt.${until})`);
    const videos = videoStats((pages ?? []) as VslPageRow[], since, until);

    const stats = {
      ...computeStats(rows), ...paceStats(rows), ...videos, script_check: scriptCheck(rows),
    };
    let raw: string;
    try {
      raw = await writeReport(
        name, dateKey, computeStats(rows), transcriptBlock(rows),
        script, scriptCheck(rows), paceStats(rows), videos,
      );
    } catch (e) {
      console.error(`[daily-report] ${name} failed:`, e);
      continue;
    }
    if (!raw) continue;
    const { body, flags } = splitReport(raw);
    if (!body) continue;

    const { error } = await supabase.from('wk_agent_daily_reports').upsert(
      { agent_id: agent.id, report_date: dateKey, stats, body_md: body, flags, model: MODEL, updated_at: new Date().toISOString() },
      { onConflict: 'agent_id,report_date' },
    );
    if (error) console.error(`[daily-report] upsert failed for ${name}:`, error.message);
    else written.push({ name, body, stats, flags });
  }

  // Email Hugo the lot.
  const to = process.env.DAILY_REPORT_EMAIL || 'hugodesouzax@gmail.com';
  if (written.length + writtenProperty.length > 0) {
    const esc = (s: string) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
    const flagged: Array<{ name: string; flags: ConductFlag[] }> = [
      ...writtenProperty.map((w) => ({ name: w.name, flags: w.flags })),
      ...written.map((w) => ({ name: w.name, flags: w.flags })),
    ].filter((w) => w.flags.length > 0);

    // Conduct + compliance first. This is the part that must never be missed.
    const alerts = flagged.length
      ? `<div style="border:1px solid #FCA5A5;background:#FEF2F2;border-radius:12px;padding:16px;margin-bottom:20px">
          <h3 style="margin:0 0 10px;color:#B91C1C">Needs your attention</h3>
          ${flagged
            .map(
              (w) => `<div style="margin-bottom:12px">
                <div style="font-weight:600;font-size:14px">${esc(w.name)}</div>
                ${w.flags
                  .map(
                    (f) => `<div style="font-size:13px;line-height:1.5;margin-top:6px">
                      <span style="display:inline-block;background:#B91C1C;color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;text-transform:uppercase">${esc(f.type)}</span>
                      <span style="color:#6B7280"> ${esc(f.company)}</span><br>
                      &ldquo;${esc(f.quote)}&rdquo;<br>
                      <span style="color:#6B7280">${esc(f.why)}</span>
                      ${f.call_id ? `<br><a href="${appUrl}/admin/crm/calls/${esc(f.call_id)}" style="color:#B91C1C;font-size:12px">Listen to the call &rarr;</a>` : ''}
                    </div>`,
                  )
                  .join('')}
              </div>`,
            )
            .join('')}
        </div>`
      : '';

    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;color:#1A1A1A">
      <h2 style="margin:0 0 4px">Daily agent reports — ${dateKey}</h2>
      <p style="color:#6B7280;margin:0 0 20px;font-size:14px">Each agent sees only their own on the leaderboard. You see all of them.</p>
      ${alerts}
      ${writtenProperty
        .map(
          (r) => `<div style="border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:16px">
            <h3 style="margin:0 0 8px">${esc(r.name)} <span style="color:#6B7280;font-weight:400;font-size:13px">· property</span></h3>
            <p style="font-size:14px;margin:0 0 6px">
              <strong style="font-size:20px">${r.stats.script_check.lead_named_figure}</strong> figures out of branches
              <span style="color:#6B7280">from ${r.stats.conversations} conversations and ${r.stats.dials} dials</span>${
                r.stats.houses_outcomes_logged === 0 && r.stats.conversations > 0
                  ? ` <span style="color:#B45309">· nothing logged in the Houses tab</span>`
                  : ''
              }
            </p>
            <p style="color:#6B7280;font-size:13px;margin:0 0 12px">
              ${r.stats.script_check.floated_a_figure} figures floated · ${r.stats.script_check.asked_them_for_a_figure} asked for theirs · ${r.stats.script_check.agreed_callback_time} callbacks with a time · ${r.stats.talk_minutes} min talking · ${r.stats.idle_minutes} min idle
            </p>
            <p style="color:#6B7280;font-size:12px;margin:0 0 12px">
              Script, out of ${r.stats.script_check.conversations_graded}:
              availability ${r.stats.script_check.asked_availability} ·
              intro ${r.stats.script_check.said_who_we_are} ·
              cash ${r.stats.script_check.said_cash} ·
              floated ${r.stats.script_check.floated_a_figure} ·
              asked them ${r.stats.script_check.asked_them_for_a_figure}${
                r.stats.script_check.made_formal_offer > 0
                  ? ` · <span style="color:#B91C1C">formal offer ${r.stats.script_check.made_formal_offer}</span>`
                  : ''
              }${
                r.stats.script_check.booked_a_viewing > 0
                  ? ` · <span style="color:#B91C1C">booked viewing ${r.stats.script_check.booked_a_viewing}</span>`
                  : ''
              }${
                r.stats.script_check.sourcer_or_course_talk > 0
                  ? ` · <span style="color:#B91C1C">sourcer/course talk ${r.stats.script_check.sourcer_or_course_talk}</span>`
                  : ''
              }
            </p>
            <div style="font-size:14px;line-height:1.55;white-space:pre-wrap">${r.body
              .replace(/&/g, '&amp;').replace(/</g, '&lt;')
              .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>
          </div>`,
        )
        .join('')}
      ${written
        .map(
          (r) => `<div style="border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:16px">
            <h3 style="margin:0 0 8px">${r.name}</h3>
            <p style="font-size:14px;margin:0 0 6px">
              <strong style="font-size:20px">${r.stats.videos_sent}</strong> videos sent
              <span style="color:#6B7280">from ${r.stats.conversations} conversations and ${r.stats.dials} dials</span>${
                r.stats.videos_ready_not_sent > 0
                  ? ` <span style="color:#B45309">· ${r.stats.videos_ready_not_sent} built and not sent</span>`
                  : ''
              }${
                r.stats.videos_render_failed + r.stats.videos_still_rendering > 0
                  ? ` <span style="color:#6B7280">· ${r.stats.videos_render_failed + r.stats.videos_still_rendering} stuck our end</span>`
                  : ''
              }
            </p>
            <p style="color:#6B7280;font-size:13px;margin:0 0 12px">
              ${r.stats.script_check.reached_offer} offers made · ${r.stats.interested + r.stats.booked} interested/booked · ${r.stats.talk_minutes} min talking · ${r.stats.idle_minutes} min idle
            </p>
            <p style="color:#6B7280;font-size:12px;margin:0 0 12px">
              Script, out of ${r.stats.script_check.conversations_graded}:
              opener ${r.stats.script_check.name_before_recording} ·
              hook ${r.stats.script_check.reached_hook} ·
              offer ${r.stats.script_check.reached_offer} ·
              close ${r.stats.script_check.used_close}${
                r.stats.script_check.asked_for_their_number > 0
                  ? ` · <span style="color:#B91C1C">asked for a number ${r.stats.script_check.asked_for_their_number}</span>`
                  : ''
              }${
                r.stats.script_check.read_out_monthly_tiers > 0
                  ? ` · <span style="color:#B91C1C">read out tiers ${r.stats.script_check.read_out_monthly_tiers}</span>`
                  : ''
              }
            </p>
            <div style="font-size:14px;line-height:1.55;white-space:pre-wrap">${r.body
              .replace(/&/g, '&amp;').replace(/</g, '&lt;')
              .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>
          </div>`,
        )
        .join('')}
      <p style="font-size:12px;color:#9CA3AF">app.heyelsie.com/admin/crm/leaderboard</p>
    </div>`;
    try {
      await sendEmail(to, `Daily agent reports — ${dateKey}`, html);
    } catch (e) {
      console.error('[daily-report] email failed:', e);
    }
  }

  res.status(200).json({
    ok: true,
    date: dateKey,
    reports: [...writtenProperty.map((w) => `${w.name} (property)`), ...written.map((w) => w.name)],
  });
}
