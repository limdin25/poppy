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

import { QUESTION_BANK, QUESTION_BY_ID } from '../lib/training-questions.js';

export const config = { runtime: 'edge' };

/** How many calls between checkpoints. Hugo asked for "every six, seven
 *  dialogs"; the client owns the counting, this is the number it reads so both
 *  ends cannot disagree. */
export const CHECKPOINT_EVERY = 7;

interface Body {
  action?: 'draw' | 'grade';
  /** grade only. */
  id?: string;
  /** grade only: the exact text of the option the agent pressed. */
  answer?: string;
  /** draw only: ids already asked this shift, so the same one does not come
   *  round twice in an afternoon. */
  exclude?: string[];
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

  if (body.action === 'grade') {
    const q = QUESTION_BY_ID[body.id ?? ''];
    if (!q || !q.options?.length) return json({ error: 'unknown question' }, 400);
    // options[0] is the correct one in the bank; the client only ever saw a
    // shuffled copy, so comparing the text is enough and leaks nothing.
    const correct = (body.answer ?? '').trim() === q.options[0].trim();
    return json({ correct, explanation: q.explanation, right: q.options[0] });
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
