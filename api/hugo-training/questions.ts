// THE ANSWER KEY. The whole question bank, with the right answer and the
// explanation for every one, for Hugo to read top to bottom.
//
// This is the one endpoint in the training system that must never be reachable
// by the person being tested, so it is worth being blunt about what protects
// it:
//
//   1. It is gated on HUGO'S PIN and nothing else. Pedro's 1176 returns 401
//      here. tests/training-answer-key.test.ts asserts that in both directions.
//   2. Hugo's PIN is never shipped to a browser. api/lib/training-hugo.ts is
//      server-only and the same test fails the build if anything under src/
//      imports it.
//   3. The bank itself (api/lib/training-questions.ts) is imported by this file
//      and by api/pedro-training/quiz.ts, neither of which is bundled. Pedro's
//      page receives questions with the answers already stripped out.
//
// Lose any one of those three and the timed quiz next door stops meaning
// anything, because the answers become readable by the person sitting it.

import {
  QUESTION_BANK,
  type TrainingQuestion,
} from '../lib/training-questions.js';
import { hugoPinOk } from '../lib/training-hugo.js';

export const config = { runtime: 'edge' };

/** How the bank is grouped on the page, in reading order. */
const SOURCE_LABELS: Record<string, string> = {
  'estate-agents': 'Video 1: Estate Agents',
  'offer-without-offering': 'Video 2: Offer Without Offering',
  'live-agent-call-harvey': 'Video 3: Live Agent Call With Harvey',
  'live-call-vincent': 'Video 4: Live BRRR Deal (Vincent Hovorka)',
  script: 'The call script',
  objections: 'The objections',
};

const SOURCE_ORDER = [
  'estate-agents',
  'offer-without-offering',
  'live-agent-call-harvey',
  'live-call-vincent',
  'script',
  'objections',
];

function answerOf(q: TrainingQuestion): string {
  // In the bank, options[0] is always the correct one. The randomised shuffle
  // only happens when an attempt is served, so here it is simply the first.
  if (q.kind === 'mc') return q.options?.[0] ?? '';
  return (q.accept ?? []).join('  /  ');
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
  if (!hugoPinOk(body.pin)) {
    return Response.json({ error: 'Wrong PIN' }, { status: 401 });
  }

  const groups = SOURCE_ORDER.map((source) => ({
    source,
    label: SOURCE_LABELS[source] ?? source,
    questions: QUESTION_BANK.filter((q) => q.source === source).map((q) => ({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      answer: answerOf(q),
      /** The wrong ones, so Hugo can see what Pedro is choosing between. */
      distractors: q.kind === 'mc' ? (q.options ?? []).slice(1) : [],
      explanation: q.explanation,
    })),
  })).filter((g) => g.questions.length > 0);

  return Response.json({
    ok: true,
    total: QUESTION_BANK.length,
    groups,
  });
}
