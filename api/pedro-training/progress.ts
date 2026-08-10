// How much of a training video has actually been watched.
//
// The number that matters is `watched_sec`: the sum of the DECODED ranges the
// browser reports through HTMLMediaElement.played, not the position of the
// playhead. That distinction is the whole anti-cheat, and this repo has already
// paid for the lesson once: the VSL funnel counted currentTime and a lead could
// drag the scrub bar to the end and register a full watch (see api/vsl/page.ts,
// "COVERAGE, not playhead"). Seeking ahead adds nothing to played, so skipping
// through a 13 minute video leaves you on a few percent.
//
// Two more guards on top:
//   - The value only ever goes UP. A reload, a second tab, or a hand-crafted
//     POST with a small number cannot lower a real watch, and a big number
//     cannot be made bigger than the video is long.
//   - The claim is capped at the true duration read off the file itself, so a
//     forged duration cannot inflate the percentage.
//
// Nothing here is proof against somebody determined to leave a video playing in
// a background tab, and it is not meant to be. It is meant to make "I watched
// it" mean something more than "I opened the page".

import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import { TRAINEE_KEY, WATCHED_PCT, findTrainingVideo, pinOk, roundOf } from '../lib/training.js';

export const config = { runtime: 'edge' };

interface Body {
  pin?: string;
  video_key?: string;
  round?: number;
  /** Unique seconds decoded, summed from video.played by the page. */
  watched_sec?: number;
  /** The duration the browser reports for the file. */
  duration_sec?: number;
  /** Set on a play event, so Hugo can see 100% in one sitting vs 100% over nine. */
  played?: boolean;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!pinOk(body.pin)) return Response.json({ error: 'Wrong PIN' }, { status: 401 });

  const round = roundOf(body.round);
  const video = findTrainingVideo(String(body.video_key ?? ''), round);
  if (!video) return Response.json({ error: 'Unknown video' }, { status: 400 });

  // The catalogue duration is the authority. A browser-reported duration is
  // only allowed to correct it slightly (different container metadata), never
  // to shrink the video so 30 seconds of playback counts as finished.
  const reported = Number(body.duration_sec);
  const duration =
    Number.isFinite(reported) && reported > video.durationSec * 0.9 && reported < video.durationSec * 1.1
      ? reported
      : video.durationSec;

  const claimed = Number(body.watched_sec);
  const watchedClaim = Number.isFinite(claimed) && claimed > 0 ? Math.min(claimed, duration) : 0;

  const { data: existing } = await supabaseAdmin
    .from('training_video_progress')
    .select('id, watched_sec, play_count, completed_at')
    .eq('trainee_key', TRAINEE_KEY)
    .eq('round', round)
    .eq('video_key', video.key)
    .maybeSingle();

  const previous = Number(existing?.watched_sec ?? 0);
  const watched = Math.max(previous, watchedClaim);
  const pct = duration > 0 ? Math.min(100, Math.round((watched / duration) * 100)) : 0;
  const nowIso = new Date().toISOString();
  const completedAt =
    existing?.completed_at ?? (pct >= WATCHED_PCT ? nowIso : null);

  if (existing) {
    await supabaseAdmin
      .from('training_video_progress')
      .update({
        watched_sec: watched,
        duration_sec: duration,
        pct,
        play_count: (existing.play_count ?? 0) + (body.played ? 1 : 0),
        completed_at: completedAt,
        updated_at: nowIso,
      })
      .eq('id', existing.id);
  } else {
    await supabaseAdmin.from('training_video_progress').insert({
      trainee_key: TRAINEE_KEY,
      round,
      video_key: video.key,
      watched_sec: watched,
      duration_sec: duration,
      pct,
      play_count: body.played ? 1 : 0,
      completed_at: completedAt,
      updated_at: nowIso,
    });
  }

  return Response.json({ ok: true, video_key: video.key, pct, watched_sec: watched });
}
