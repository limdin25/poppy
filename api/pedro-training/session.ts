// /pedro-training, the way in.
//
// This directory is NOT api/training/, which is the Elsie agent knowledge
// trainer and has nothing to do with any of this. Two unrelated features called
// training; keeping them in separate directories is the only thing stopping a
// future tidy-up from treating them as one.
//
// One POST with the PIN and the page gets back everything it needs: a signed URL
// per video, how much of each has been watched, and whether the quiz is open.
//
// Why the videos are not just <video src="https://storage.googleapis.com/...">:
// those files sit on the course provider's CDN. Hotlinking them puts Pedro's
// page at the mercy of somebody else's access control and rotation, and it is
// their bandwidth. They are downloaded once and served from a PRIVATE Supabase
// bucket, as URLs that expire in four hours, so a link pasted into a group chat
// is dead by teatime.
//
// The PIN is checked here as well as in the browser. The client gate is what
// Pedro sees; this is what stops the API being an open endpoint that anyone can
// read watch data out of.

import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import {
  TRAINING_VIDEOS,
  TRAINING_BUCKET,
  SIGNED_URL_TTL_SEC,
  TRAINEE_KEY,
  WATCHED_PCT,
  QUIZ_QUESTION_COUNT,
  QUIZ_SECONDS_PER_QUESTION,
  QUIZ_PASS_PCT,
  quizUnlocked,
  pinOk,
} from '../lib/training.js';

export const config = { runtime: 'edge' };

interface ProgressRow {
  video_key: string;
  watched_sec: number | string | null;
  duration_sec: number | string | null;
  pct: number | null;
  play_count: number | null;
  completed_at: string | null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: { pin?: string };
  try {
    body = (await req.json()) as { pin?: string };
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!pinOk(body.pin)) {
    return Response.json({ error: 'Wrong PIN' }, { status: 401 });
  }

  const { data: rows } = await supabaseAdmin
    .from('training_video_progress')
    .select('video_key, watched_sec, duration_sec, pct, play_count, completed_at')
    .eq('trainee_key', TRAINEE_KEY);

  const byKey = new Map<string, ProgressRow>(
    ((rows ?? []) as ProgressRow[]).map((r) => [r.video_key, r]),
  );

  const videos = await Promise.all(
    TRAINING_VIDEOS.map(async (v) => {
      // Only the bucket files need a URL minting. A YouTube video is embedded
      // by id through the player API, so there is nothing to sign and nothing
      // of ours being served.
      const signedUrl =
        v.source === 'storage'
          ? (await supabaseAdmin.storage
              .from(TRAINING_BUCKET)
              .createSignedUrl(v.ref, SIGNED_URL_TTL_SEC)).data?.signedUrl ?? null
          : null;
      const row = byKey.get(v.key);
      return {
        key: v.key,
        title: v.title,
        why: v.why,
        source: v.source,
        durationLabel: v.durationLabel,
        durationSec: v.durationSec,
        required: v.required,
        credit: v.credit ?? null,
        url: signedUrl,
        youtubeId: v.source === 'youtube' ? v.ref : null,
        pct: row?.pct ?? 0,
        watchedSec: Number(row?.watched_sec ?? 0),
        completed: !!row?.completed_at,
      };
    }),
  );

  const pct: Record<string, number> = {};
  for (const v of videos) pct[v.key] = v.pct;

  // The most recent finished attempt, so the page can show his last score
  // without another round trip.
  const { data: attempts } = await supabaseAdmin
    .from('training_quiz_attempts')
    .select('id, score, total, pct, passed, submitted_at')
    .eq('trainee_key', TRAINEE_KEY)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
    .limit(1);

  return Response.json({
    ok: true,
    videos,
    quiz: {
      unlocked: quizUnlocked(pct),
      watchedThreshold: WATCHED_PCT,
      questionCount: QUIZ_QUESTION_COUNT,
      secondsPerQuestion: QUIZ_SECONDS_PER_QUESTION,
      passPct: QUIZ_PASS_PCT,
      lastAttempt: attempts?.[0] ?? null,
    },
  });
}
