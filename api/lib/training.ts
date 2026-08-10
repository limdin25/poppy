// The /pedro-training page: what it plays, who it is for, and how it is gated.
//
// Shared on purpose. The React page imports this without an extension, the
// Vercel functions import it as "./training.js" (node16 resolution), and both
// therefore agree on the video keys, the durations and the pass mark. A second
// copy of this list is how a page ends up asking for a file that is not there.
//
// WHAT IS NOT IN HERE: the quiz questions. They live in
// api/lib/training-questions.ts, which NOTHING under src/ imports, so the
// answers are never shipped to the browser. Grading happens on the server.

/**
 * The PIN on the door. Not a secret and not treated as one: it is the same
 * low-security gate /script and /blueprint already use, it is in the client
 * bundle by design, and it exists to keep the page out of the hands of somebody
 * who stumbles on the URL, not to keep out an attacker. Nothing behind it can
 * change any data that matters, and the videos are served as short-lived signed
 * URLs rather than public files.
 */
export const TRAINING_PIN = '1176';

/** One row per trainee. Progress and quiz attempts are keyed on this, because
 *  the page is PIN-gated rather than logged in, so there is no session to read
 *  an identity from. */
export const TRAINEE_KEY = 'pedro';

/** The private Supabase bucket the mp4s live in. Never public: these are three
 *  lessons out of a paid course, re-hosted for one contractor. */
export const TRAINING_BUCKET = 'training-videos';

/** How long a video URL stays valid. Long enough to watch a 13 minute video and
 *  re-watch it, short enough that a copied link is useless tomorrow. */
export const SIGNED_URL_TTL_SEC = 4 * 60 * 60;

/** A video is "watched" at this much unique coverage. Not 100%: the last
 *  fraction of an mp4 is often an outro that never fires a timeupdate, and
 *  failing somebody for that would be a bug, not discipline. */
export const WATCHED_PCT = 95;

/** Questions served per attempt, drawn at random from the bank. */
export const QUIZ_QUESTION_COUNT = 20;

/** Seconds per question. Hugo: short enough that there is no time to look an
 *  answer up somewhere else. */
export const QUIZ_SECONDS_PER_QUESTION = 30;

/** Score needed to pass, as a percentage. */
export const QUIZ_PASS_PCT = 70;

/**
 * Where a video comes from, and therefore how it plays and how it is tracked.
 *
 *  'storage' - an mp4 we downloaded once and put in the private bucket, served
 *              as a signed URL. Used for the paid-course lessons, because
 *              hotlinking somebody else's CDN would break the day it rotates.
 *  'youtube' - EMBEDDED through the YouTube IFrame Player API. Never
 *              downloaded and never re-hosted: embedding is the way YouTube
 *              content is meant to be used, and re-uploading it is not ours to
 *              do. Watch tracking comes from the player API instead of the
 *              <video> element, with the same rules applied.
 */
export type TrainingVideoSource = 'storage' | 'youtube';

export interface TrainingVideo {
  /** Stable id. Also the DB key for progress, so it must never change once a
   *  video has been watched or the watch history is orphaned. */
  key: string;
  title: string;
  /** One line: why he is watching this one. */
  why: string;
  source: TrainingVideoSource;
  /** storage: the object name inside the bucket. youtube: the video id. */
  ref: string;
  /** Runtime. Shown before he presses play, and the authority the server uses
   *  when it works out a percentage, so a forged duration cannot inflate it. */
  durationLabel: string;
  durationSec: number;
  /** Required videos gate the quiz. Optional ones never do. */
  required: boolean;
  /** Shown under the title. Useful when the presenter is not the course. */
  credit?: string;
}

/**
 * THE VIDEO LIST. This is the whole configuration.
 *
 * Adding a video is one entry here and nothing else: the page, the gate, the
 * admin view and the progress table all read this array. Set `required: true`
 * and it joins the gate; `required: false` and it is a bonus that can never
 * hold the test up.
 *
 * Sources: the Fontaine Brothers deal sourcing course (Module 8 Marketing,
 * Module 12 The FULL Process), downloaded once at 360p into the private bucket,
 * plus two YouTube videos which are embedded and never copied.
 *
 * ORDER MATTERS on screen but not to the gate, so a new required video slots in
 * wherever it reads best without disturbing anybody's existing progress: the
 * rows are keyed on `key`, so what has already been watched stays watched.
 */
export const TRAINING_VIDEOS: TrainingVideo[] = [
  {
    key: 'estate-agents',
    title: 'Estate Agents',
    why: 'Why the agent on the other end of the phone is the best source of houses you will ever have, how to introduce yourself so they take you seriously, and why the money is in ringing them back rather than in the first call.',
    source: 'storage',
    ref: 'estate-agents.mp4',
    durationLabel: '12m 51s',
    durationSec: 772,
    required: true,
  },
  {
    key: 'offer-without-offering',
    title: 'Offer Without Offering',
    why: 'The exact technique the money section of your script is built on. Four minutes, one word change, and it is the difference between a branch that takes your calls and a branch that stops picking up.',
    source: 'storage',
    ref: 'offer-without-offering.mp4',
    durationLabel: '4m 01s',
    durationSec: 241,
    required: true,
  },
  {
    key: 'live-agent-call-harvey',
    title: 'Live Agent Call With Harvey',
    why: 'A real recorded cold call to an estate agent, doing exactly your job, followed by a line by line breakdown of why every sentence was said. Listen for the name swap, the viewing objection and the callback time.',
    source: 'storage',
    ref: 'live-agent-call-harvey.mp4',
    durationLabel: '9m 55s',
    durationSec: 595,
    required: true,
  },
  {
    key: 'live-call-vincent',
    title: 'Live BRRR Deal: how to talk to estate agents on the phone',
    why: 'A second live call, different person, same job as yours. Three branches in seven minutes: nobody answers, it is already sold, and one that turns into a real conversation. Watch what he does when the first two go nowhere.',
    source: 'youtube',
    ref: '9CCqIEp5CvI',
    durationLabel: '7m 35s',
    durationSec: 455,
    required: true,
    credit: 'Vincent Hovorka',
  },
  {
    key: 'bonus-sourcing',
    title: 'Bonus: what the job actually is',
    why: 'Under two minutes. The whole role in one lesson: ring agents, build relationships, call them every week, chase the ones that are still sitting there. Worth watching, but it does not hold up the test.',
    source: 'storage',
    ref: 'bonus-sourcing.mp4',
    durationLabel: '1m 52s',
    durationSec: 112,
    required: false,
  },
  {
    key: 'bonus-brrr-explained',
    title: 'Bonus: what the buyer is actually trying to do',
    why: 'Background, not script. What buy, refurbish, rent, refinance means and why the purchase price matters so much. Watch it so that when an agent goes off script you understand what you are actually asking for.',
    source: 'youtube',
    ref: '2ro3oOjQATI',
    durationLabel: '8m 09s',
    durationSec: 489,
    required: false,
    credit: 'Samuel Leeds',
  },
];

export const REQUIRED_VIDEOS = TRAINING_VIDEOS.filter((v) => v.required);
export const OPTIONAL_VIDEOS = TRAINING_VIDEOS.filter((v) => !v.required);

export function findTrainingVideo(key: string): TrainingVideo | undefined {
  return TRAINING_VIDEOS.find((v) => v.key === key);
}

/** True when every REQUIRED video has been watched. Optional ones are ignored
 *  on purpose, so adding one can never re-lock a quiz somebody already
 *  unlocked. Adding a REQUIRED one does re-lock it, which is the point, and it
 *  leaves every finished video finished. */
export function quizUnlocked(pct: Record<string, number>): boolean {
  return REQUIRED_VIDEOS.every((v) => (pct[v.key] ?? 0) >= WATCHED_PCT);
}

/** Constant-time-ish PIN comparison. Pedro's PIN is public (it is in the client
 *  bundle so the gate can render), so this is tidiness rather than defence.
 *  Hugo's PIN is a different matter and lives in api/lib/training-hugo.ts,
 *  server side only, because it opens the answer key. */
export function pinOk(supplied: unknown): boolean {
  return pinMatches(supplied, TRAINING_PIN);
}

/** Shared by both gates. Length is not hidden, which is fine: both PINs are
 *  four digits and everybody knows it. */
export function pinMatches(supplied: unknown, expected: string): boolean {
  const s = typeof supplied === 'string' ? supplied.trim() : '';
  if (s.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
