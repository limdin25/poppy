// Hugo's practice run of the quiz. Same questions, no timer, no video gate.
//
// A near twin of api/pedro-training/quiz.ts, with three differences and no
// others:
//
//   1. Gated on Hugo's PIN, not Pedro's.
//   2. No video gate. He never has to watch anything to reach it.
//   3. Attempts are filed under trainee_key 'hugo', so a practice run can never
//      be mistaken for one of Pedro's real scores in the admin view.
//
// It is a separate file rather than a flag on Pedro's route on purpose. Pedro's
// route is the one holding the "you cannot start until you have watched them"
// rule, and a bypass flag on it is exactly the sort of thing that gets passed
// by accident later.

import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import { QUIZ_QUESTION_COUNT, QUIZ_PASS_PCT } from '../lib/training.js';
import { HUGO_TRAINEE_KEY, hugoPinOk } from '../lib/training-hugo.js';
import {
  QUESTION_BANK,
  QUESTION_BY_ID,
  shortAnswerCorrect,
} from '../lib/training-questions.js';

export const config = { runtime: 'edge' };

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
  if (!hugoPinOk(body.pin)) return Response.json({ error: 'Wrong PIN' }, { status: 401 });

  if (body.action === 'start') return start();
  if (body.action === 'submit') return submit(body);
  return Response.json({ error: 'action must be start or submit' }, { status: 400 });
}

async function start(): Promise<Response> {
  const picked = shuffle(QUESTION_BANK).slice(
    0,
    Math.min(QUIZ_QUESTION_COUNT, QUESTION_BANK.length),
  );

  const served: ServedQuestion[] = [];
  const forClient: Array<{ kind: string; prompt: string; options?: string[] }> = [];

  for (const q of picked) {
    if (q.kind === 'mc') {
      const opts = q.options ?? [];
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
    .insert({ trainee_key: HUGO_TRAINEE_KEY, status: 'in_progress', served })
    .select('id')
    .single();
  if (error || !attempt) {
    return Response.json({ error: error?.message ?? 'could not start' }, { status: 500 });
  }

  return Response.json({
    ok: true,
    attempt_id: attempt.id,
    // Zero means the page shows no countdown and never auto-advances.
    secondsPerQuestion: 0,
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
    .eq('trainee_key', HUGO_TRAINEE_KEY)
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
        s.kind === 'mc' ? (s.options?.[s.correct ?? 0] ?? '') : (q?.accept?.[0] ?? ''),
      explanation: q?.explanation ?? '',
    };
  });

  const total = results.length;
  const score = results.filter((r) => r.correct).length;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const passed = pct >= QUIZ_PASS_PCT;
  const nowIso = new Date().toISOString();

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
      duration_sec: Number.isFinite(Number(body.duration_sec))
        ? Math.max(0, Math.round(Number(body.duration_sec)))
        : null,
      updated_at: nowIso,
    })
    .eq('id', attemptId);

  return Response.json({ ok: true, score, total, pct, passed, results });
}
