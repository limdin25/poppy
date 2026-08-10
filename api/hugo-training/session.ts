// /hugo-training, the owner's copy of Pedro's training page.
//
// Same videos, none of the discipline: nothing is gated, nothing is tracked
// against Pedro, and the answer key is one click away (api/hugo-training/
// questions.ts). It exists so Hugo can review what his caller is being taught
// and tested on.
//
// Gated on HIS PIN ONLY. Pedro's 1176 gets a 401 here, deliberately: if it
// worked, Pedro could read every answer and the timed quiz next door would be
// theatre. See api/lib/training-hugo.ts for the full reasoning.

import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import {
  TRAINING_VIDEOS,
  TRAINING_BUCKET,
  SIGNED_URL_TTL_SEC,
  REQUIRED_VIDEOS,
  OPTIONAL_VIDEOS,
  QUIZ_QUESTION_COUNT,
  QUIZ_SECONDS_PER_QUESTION,
  QUIZ_PASS_PCT,
  WATCHED_PCT,
} from '../lib/training.js';
import { hugoPinOk } from '../lib/training-hugo.js';
import { QUESTION_BANK } from '../lib/training-questions.js';

export const config = { runtime: 'edge' };

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
  if (!hugoPinOk(body.pin)) {
    return Response.json({ error: 'Wrong PIN' }, { status: 401 });
  }

  const videos = await Promise.all(
    TRAINING_VIDEOS.map(async (v) => ({
      key: v.key,
      title: v.title,
      why: v.why,
      source: v.source,
      durationLabel: v.durationLabel,
      durationSec: v.durationSec,
      required: v.required,
      credit: v.credit ?? null,
      youtubeId: v.source === 'youtube' ? v.ref : null,
      url:
        v.source === 'storage'
          ? (await supabaseAdmin.storage
              .from(TRAINING_BUCKET)
              .createSignedUrl(v.ref, SIGNED_URL_TTL_SEC)).data?.signedUrl ?? null
          : null,
    })),
  );

  return Response.json({
    ok: true,
    videos,
    counts: {
      required: REQUIRED_VIDEOS.length,
      optional: OPTIONAL_VIDEOS.length,
      questionsInBank: QUESTION_BANK.length,
    },
    quiz: {
      questionCount: QUIZ_QUESTION_COUNT,
      secondsPerQuestion: QUIZ_SECONDS_PER_QUESTION,
      passPct: QUIZ_PASS_PCT,
      watchedThreshold: WATCHED_PCT,
    },
  });
}
