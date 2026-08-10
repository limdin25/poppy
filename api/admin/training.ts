// What Hugo sees: how far Pedro has actually got with the training.
//
// Read only, admin only, same gate as every other /api/admin/* route (JWT ->
// admin_users). The trainee side of this data is written by the PIN-gated
// api/pedro-training/* routes; nothing here can change it.
//
// NOT to be confused with api/training/*, which is a completely unrelated
// feature: the Elsie agent knowledge trainer used by AgentEditorPage. That is
// why the trainee routes live under api/pedro-training/ rather than sharing a
// directory with it.

import { supabaseAdmin } from '../../src/integrations/supabase/client.js';
import {
  TRAINING_VIDEOS,
  TRAINEE_KEY,
  WATCHED_PCT,
  QUIZ_PASS_PCT,
  quizUnlocked,
} from '../lib/training.js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const jwt = authHeader.replace('Bearer ', '');
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt);
  if (!user?.email) return new Response('Unauthorized', { status: 401 });

  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('email')
    .eq('email', user.email)
    .single();
  if (!admin) return new Response('Forbidden', { status: 403 });

  const { data: progressRows } = await supabaseAdmin
    .from('training_video_progress')
    .select('video_key, round, watched_sec, duration_sec, pct, play_count, first_seen_at, completed_at, updated_at')
    .eq('trainee_key', TRAINEE_KEY);

  interface ProgressRow {
    video_key: string;
    pct: number | null;
    watched_sec: number | string | null;
    play_count: number | null;
    completed_at: string | null;
    updated_at: string | null;
  }

  const byKey = new Map<string, ProgressRow>(
    ((progressRows ?? []) as unknown as ProgressRow[]).map((r) => [r.video_key, r]),
  );

  const videos = TRAINING_VIDEOS.map((v) => {
    const row = byKey.get(v.key);
    return {
      key: v.key,
      title: v.title,
      durationLabel: v.durationLabel,
      source: v.source,
      required: v.required,
      pct: row?.pct ?? 0,
      watchedSec: Number(row?.watched_sec ?? 0),
      durationSec: v.durationSec,
      playCount: row?.play_count ?? 0,
      completedAt: row?.completed_at ?? null,
      lastSeenAt: row?.updated_at ?? null,
    };
  });

  const pct: Record<string, number> = {};
  for (const v of videos) pct[v.key] = v.pct;

  const { data: attempts } = await supabaseAdmin
    .from('training_quiz_attempts')
    .select('id, round, status, score, total, pct, passed, started_at, submitted_at, duration_sec, results')
    .eq('trainee_key', TRAINEE_KEY)
    .order('started_at', { ascending: false })
    .limit(10);

  return Response.json({
    trainee: TRAINEE_KEY,
    watchedThreshold: WATCHED_PCT,
    passPct: QUIZ_PASS_PCT,
    quizUnlocked: quizUnlocked(pct),
    videos,
    attempts: attempts ?? [],
  });
}
