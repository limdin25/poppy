// The knowledge checkpoint that stops the dialer every few calls.
//
// Hugo 2026-08-12: "bake in an agent knowledge checkpoint every N dials,
// locking the workflow until they answer correctly. Amazing, to make him more
// knowledgeable."
//
// It reuses the question bank the /pedro-training test already grades against
// (api/lib/training-questions.ts), so there is exactly one set of right answers
// in this codebase and a change to the script updates both surfaces at once.
//
// THE ANSWERS NEVER LEAVE THE SERVER. Nothing under src/ imports the bank, so
// it is not in the browser bundle. `draw` returns the question with the options
// shuffled and no correct index; `grade` takes the TEXT the agent picked and
// checks it here. That means no state to store between the two calls, and
// nothing in devtools to read.
//
// Multiple choice only. This fires mid-shift between two dials, so it has to be
// answerable in fifteen seconds; the long short-answer questions stay on the
// training page where there is time to think.

import { createClient } from '@supabase/supabase-js';
import { QUESTION_BANK, QUESTION_BY_ID } from '../lib/training-questions.js';
import { topicsForMistakes, TOPICS } from '../lib/knowledge-topics.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** How many checkpoints later a wrong answer comes back. Hugo 2026-08-12:
 *  "make wrong answers come back after 10 rounds until he gets them right."
 *  Ten is far enough that he cannot parrot the answer he just read, and near
 *  enough that it lands the same day. */
export const REPEAT_AFTER_ROUNDS = 10;

/** The gap grows when he keeps getting one wrong: 10, then 20, then 30, capped.
 *  A question he fails repeatedly should be coming BACK at him, not drifting
 *  away, and a cap stops one bad topic hogging every checkpoint for a week. */
const MAX_WRONG_GAP = 30;

/** Getting it right on a comeback does NOT retire the question. It schedules one
 *  confirmation this many rounds later, and only answering THAT correctly
 *  closes it. Right once, ten minutes after being shown the answer, is not
 *  knowing it. */
export const CONFIRM_AFTER_ROUNDS = 30;

/** How many calls between checkpoints. Hugo asked for "every six, seven
 *  dialogs"; the client owns the counting, this is the number it reads so both
 *  ends cannot disagree. */
export const CHECKPOINT_EVERY = 7;

interface Body {
  action?: 'draw' | 'grade' | 'flag';
  /** Who is answering. The CRM user id when there is one. */
  agentKey?: string;
  /** grade only. */
  id?: string;
  /** grade only: the exact text of the option the agent pressed. */
  answer?: string;
  /** draw only: ids already asked this shift, so the same one does not come
   *  round twice in an afternoon. */
  exclude?: string[];
  /** flag only: what the AI review said went wrong on a real call, and which
   *  call it was. */
  mistakes?: string;
  callId?: string;
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
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 });
  }

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const agentKey = (body.agentKey ?? '').trim() || 'unknown';

  /** Which checkpoint this is for this agent: one row per answer, so the count
   *  IS the round. No counter to drift out of step with the history. */
  const roundsSoFar = async (): Promise<number> => {
    const { count } = await supabase
      .from('wk_knowledge_checks')
      .select('id', { count: 'exact', head: true })
      .eq('agent_key', agentKey);
    return count ?? 0;
  };

  // The AI review of a real call says what he got wrong. Those topics go into
  // the same owed queue as a failed checkpoint, due immediately, so the very
  // next checkpoint asks about HIS mistake instead of a random topic.
  if (body.action === 'flag') {
    const topics = topicsForMistakes(body.mistakes ?? '');
    if (topics.length === 0) return json({ queued: 0 });
    const round = await roundsSoFar();
    let queued = 0;
    for (const t of topics) {
      // One question per topic, the first that is not already owed. Three
      // questions about the same mistake is a punishment, not a lesson.
      const id = t.questionIds.find((qid) => QUESTION_BY_ID[qid]?.options?.length);
      if (!id) continue;
      const { error } = await supabase.from('wk_knowledge_checks').insert({
        agent_key: agentKey,
        question_id: id,
        correct: false,
        round,
        // Due now. He made this mistake twenty minutes ago.
        due_round: round,
        origin: 'call_review',
        call_id: body.callId ?? null,
      });
      // The unique index on (agent_key, call_id, question_id) makes a second
      // insert for the same call a no-op rather than a duplicate. The review
      // card can safely fire twice.
      if (!error) queued += 1;
    }
    return json({ queued });
  }

  if (body.action === 'grade') {
    const q = QUESTION_BY_ID[body.id ?? ''];
    if (!q || !q.options?.length) return json({ error: 'unknown question' }, 400);
    // options[0] is the correct one in the bank; the client only ever saw a
    // shuffled copy, so comparing the text is enough and leaks nothing.
    const correct = (body.answer ?? '').trim() === q.options[0].trim();

    // THE SCHEDULE. This is the whole strategy, and it is four lines of rules:
    //
    //   wrong          -> comes back at 10, then 20, then 30. Failing it pulls
    //                     it TOWARDS him, it does not let it drift away.
    //   right, but owed -> not retired. One confirmation 30 rounds later.
    //   right on the confirmation -> retired for good.
    //   right, never owed -> nothing scheduled. He knows it.
    //
    // Best effort: a failed write must never stop him answering and dialling.
    let nextIn: number | null = null;
    let confirming = false;
    try {
      const now = new Date().toISOString();
      const round = (await roundsSoFar()) + 1;

      // What is currently owed on this question, and how many times he has
      // already got it wrong.
      const { data: history } = await supabase
        .from('wk_knowledge_checks')
        .select('id, correct, resolved_at')
        .eq('agent_key', agentKey)
        .eq('question_id', q.id);
      const rows = history ?? [];
      const owed = rows.filter((r) => !r.resolved_at);
      const wrongsBefore = rows.filter((r) => r.correct === false).length;
      // An owed row that he got RIGHT is a confirmation falling due.
      confirming = owed.length > 0 && owed.every((r) => r.correct === true);

      if (!correct) {
        nextIn = Math.min(REPEAT_AFTER_ROUNDS * (wrongsBefore + 1), MAX_WRONG_GAP);
      } else if (owed.length > 0 && !confirming) {
        nextIn = CONFIRM_AFTER_ROUNDS;
      }

      // Everything previously owed on this question is settled by this answer:
      // either it is closed (right) or it is replaced by the new, later row
      // (wrong). Two open rows for one question would ask it twice.
      if (owed.length > 0) {
        await supabase
          .from('wk_knowledge_checks')
          .update({ resolved_at: now })
          .eq('agent_key', agentKey)
          .eq('question_id', q.id)
          .is('resolved_at', null);
      }

      await supabase.from('wk_knowledge_checks').insert({
        agent_key: agentKey,
        question_id: q.id,
        correct,
        round,
        due_round: nextIn === null ? null : round + nextIn,
        origin: 'checkpoint',
      });
    } catch {
      // The marking above is what he sees. The history is a nice-to-have.
    }

    return json({
      correct,
      explanation: q.explanation,
      right: q.options[0],
      /** Rounds until it comes back. Null when it is retired. */
      repeatAfter: nextIn,
      /** True when he has just answered a confirmation correctly, which is the
       *  moment a question is actually learned rather than remembered. */
      retired: correct && confirming,
    });
  }

  // A question he has already got wrong, if enough rounds have passed, beats a
  // random one. Oldest debt first, so nothing sits owed for ever.
  try {
    const round = await roundsSoFar();
    // Anything still owed and now due: a wrong answer coming back, a
    // confirmation falling due, or a mistake the AI review flagged on a real
    // call. Oldest debt first, so nothing sits owed for ever.
    const { data: owed } = await supabase
      .from('wk_knowledge_checks')
      .select('question_id, due_round, origin, correct')
      .eq('agent_key', agentKey)
      .is('resolved_at', null)
      .not('due_round', 'is', null)
      .lte('due_round', round)
      .order('due_round', { ascending: true })
      .limit(1);
    const row = owed?.[0];
    const again = row?.question_id ? QUESTION_BY_ID[row.question_id as string] : undefined;
    if (again?.options?.length) {
      const fromCall = row?.origin === 'call_review';
      const topic = fromCall
        ? TOPICS.find((t) => t.questionIds.includes(again.id))
        : undefined;
      return json({
        id: again.id,
        prompt: again.prompt,
        options: shuffle(again.options),
        source: again.source,
        every: CHECKPOINT_EVERY,
        // The screen says so out loud. Being told WHY this question is in front
        // of him is most of what makes it stick.
        repeat: true,
        fromCall,
        // "They gave you a number on that call and it nearly got away."
        because: topic?.because ?? null,
        // A confirmation, rather than a question he got wrong.
        confirming: row?.correct === true,
      });
    }
  } catch {
    // No history, or the table is unreachable: fall through to a fresh one.
  }

  const exclude = new Set(body.exclude ?? []);
  const pool = QUESTION_BANK.filter(
    (q) => q.kind === 'mc' && (q.options?.length ?? 0) > 1 && !exclude.has(q.id),
  );
  // Everything has been asked this shift: start the rotation again rather than
  // letting the checkpoint quietly stop working.
  const source = pool.length > 0
    ? pool
    : QUESTION_BANK.filter((q) => q.kind === 'mc' && (q.options?.length ?? 0) > 1);
  if (source.length === 0) return json({ error: 'no questions' }, 500);

  const q = source[Math.floor(Math.random() * source.length)];
  return json({
    id: q.id,
    prompt: q.prompt,
    options: shuffle(q.options!),
    source: q.source,
    every: CHECKPOINT_EVERY,
  });
}
