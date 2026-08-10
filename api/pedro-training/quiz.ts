// The timed test at the end of /pedro-training.
//
// Two actions on one route:
//
//   start  - checks the three required videos are watched, draws a random
//            subset of the bank, shuffles the options, writes the whole served
//            set to training_quiz_attempts, and returns it with every correct
//            answer stripped out.
//   submit - grades that stored set and writes the result.
//
// The answers never leave the server. api/lib/training-questions.ts is imported
// by this route and by nothing under src/, so it is not in the client bundle
// and there is nothing to read out of devtools. Grading against the row we
// stored (rather than against what the client sends back) also means a rebuilt
// payload cannot change which answer was right.
//
// The defence against looking answers up mid-test is deliberately simple, which
// is what Hugo asked for: 30 seconds a question, one question at a time, no way
// back, and a different order every attempt. There is no lockdown browser here
// and there should not be.

import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import {
  TRAINEE_KEY,
  QUIZ_QUESTION_COUNT,
  QUIZ_SECONDS_PER_QUESTION,
  QUIZ_PASS_PCT,
  REQUIRED_VIDEOS,
  WATCHED_PCT,
  quizUnlocked,
  pinOk,
} from '../lib/training.js';
import {
  QUESTION_BANK,
  QUESTION_BY_ID,
  shortAnswerCorrect,
} from '../lib/training-questions.js';

export const config = { runtime: 'edge' };

/** One question as it was served: which bank question, and (for multiple
 *  choice) the order the options were shown in. `correct` is the index in THAT
 *  shuffled order, so grading needs no second lookup. */
interface ServedQuestion {
  id: string;
  kind: 'mc' | 'short';
  options?: string[];
  correct?: number;
}

interface Body {
  pin?: string;
  action?: string;
  attempt_id?: string;
  /** submit only. One entry per served question, in the served order. `null`
   *  means it ran out of time or he left it blank. */
  answers?: Array<number | string | null>;
  duration_sec?: number;
}

function shuffle<T>(input: T[]): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

  if (body.action === 'start') return start();
  if (body.action === 'submit') return submit(body);
  return Response.json({ error: 'action must be start or submit' }, { status: 400 });
}

async function start(): Promise<Response> {
  // The gate is enforced here, not only in the UI, or the quiz would be one
  // fetch away from being taken without watching anything.
  const { data: rows } = await supabaseAdmin
    .from('training_video_progress')
    .select('video_key, pct')
    .eq('trainee_key', TRAINEE_KEY);

  const pct: Record<string, number> = {};
  for (const r of (rows ?? []) as Array<{ video_key: string; pct: number | null }>) {
    pct[r.video_key] = r.pct ?? 0;
  }
  if (!quizUnlocked(pct)) {
    const missing = REQUIRED_VIDEOS
      .filter((v) => (pct[v.key] ?? 0) < WATCHED_PCT)
      .map((v) => v.title);
    return Response.json(
      { error: `Watch all ${REQUIRED_VIDEOS.length} required videos first`, missing },
      { status: 403 },
    );
  }

  const picked = shuffle(QUESTION_BANK).slice(0, Math.min(QUIZ_QUESTION_COUNT, QUESTION_BANK.length));

  const served: ServedQuestion[] = [];
  const forClient: Array<{ kind: string; prompt: string; options?: string[] }> = [];

  for (const q of picked) {
    if (q.kind === 'mc') {
      const opts = q.options ?? [];
      // options[0] is the correct one in the bank. Shuffle, then remember where
      // it landed for THIS attempt.
      const correctText = opts[0];
      const shuffled = shuffle(opts);
      served.push({ id: q.id, kind: 'mc', options: shuffled, correct: shuffled.indexOf(correctText) });
      forClient.push({ kind: 'mc', prompt: q.prompt, options: shuffled });
    } else {
      served.push({ id: q.id, kind: 'short' });
      forClient.push({ kind: 'short', prompt: q.prompt });
    }
  }

  const { data: attempt, error } = await supabaseAdmin
    .from('training_quiz_attempts')
    .insert({ trainee_key: TRAINEE_KEY, status: 'in_progress', served })
    .select('id')
    .single();
  if (error || !attempt) {
    return Response.json({ error: error?.message ?? 'could not start' }, { status: 500 });
  }

  return Response.json({
    ok: true,
    attempt_id: attempt.id,
    secondsPerQuestion: QUIZ_SECONDS_PER_QUESTION,
    passPct: QUIZ_PASS_PCT,
    questions: forClient,
  });
}

async function submit(body: Body): Promise<Response> {
  const attemptId = String(body.attempt_id ?? '').trim();
  if (!attemptId) return Response.json({ error: 'attempt_id required' }, { status: 400 });

  const { data: attempt } = await supabaseAdmin
    .from('training_quiz_attempts')
    .select('id, status, served, started_at')
    .eq('id', attemptId)
    .eq('trainee_key', TRAINEE_KEY)
    .maybeSingle();
  if (!attempt) return Response.json({ error: 'attempt not found' }, { status: 404 });
  if (attempt.status === 'submitted') {
    return Response.json({ error: 'that attempt is already submitted' }, { status: 409 });
  }

  const served = (attempt.served ?? []) as ServedQuestion[];
  const answers = Array.isArray(body.answers) ? body.answers : [];

  const results = served.map((s, i) => {
    const q = QUESTION_BY_ID[s.id];
    const given = answers[i] ?? null;
    let correct = false;
    let givenLabel = '';

    if (s.kind === 'mc') {
      const idx = typeof given === 'number' ? given : -1;
      correct = idx >= 0 && idx === s.correct;
      givenLabel = idx >= 0 ? (s.options?.[idx] ?? '') : '';
    } else {
      const text = typeof given === 'string' ? given : '';
      correct = !!q && shortAnswerCorrect(q, text);
      givenLabel = text;
    }

    return {
      id: s.id,
      prompt: q?.prompt ?? '',
      kind: s.kind,
      given: givenLabel,
      answered: given !== null && givenLabel !== '',
      correct,
      correctAnswer:
        s.kind === 'mc'
          ? (s.options?.[s.correct ?? 0] ?? '')
          : (q?.accept?.[0] ?? ''),
      explanation: q?.explanation ?? '',
    };
  });

  const total = results.length;
  const score = results.filter((r) => r.correct).length;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const passed = pct >= QUIZ_PASS_PCT;
  const nowIso = new Date().toISOString();
  const durationSec = Number.isFinite(Number(body.duration_sec))
    ? Math.max(0, Math.round(Number(body.duration_sec)))
    : Math.round((Date.parse(nowIso) - Date.parse(attempt.started_at)) / 1000);

  await supabaseAdmin
    .from('training_quiz_attempts')
    .update({
      status: 'submitted',
      results,
      score,
      total,
      pct,
      passed,
      submitted_at: nowIso,
      duration_sec: durationSec,
      updated_at: nowIso,
    })
    .eq('id', attemptId);

  return Response.json({ ok: true, score, total, pct, passed, results });
}
