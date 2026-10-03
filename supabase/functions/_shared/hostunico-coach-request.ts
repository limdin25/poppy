// The live coach's model request, shared by the edge function and the
// latency harness (scripts/hostunico-coach-latency.ts) so what is measured is
// what runs. Pedro, 3 Oct 2026: the suggestion was still typing when the owner
// had finished. Three things keep it fast:
//   1. A static prefix (core rules, then the objection playbook) so provider
//      prompt caching reuses it turn after turn.
//   2. Only the prepared answers relevant to this turn, not the whole bank,
//      which on its own was about half of a 49 KB prompt.
//   3. A short output budget: two short sentences and an optional question.

import { HOSTUNICO_COACH_CORE_PROMPT } from './hostunico-coach.ts';
import { HOSTUNICO_ANSWERS, hostunicoAnswerCopy } from './hostunico-answer-bank.ts';
import { HOSTUNICO_OBJECTION_PLAYBOOK } from './hostunico-objections.ts';

export const HOSTUNICO_COACH_MAX_TOKENS = 120;
export const HOSTUNICO_COACH_CACHE_KEY = 'hostunico-coach-v2';
const REASONING_MODEL = /^(gpt-5|o[1-9])/i;
const MAX_RELEVANT = 6;

/** Prepared answers whose topic appears in the latest caller words or the turn before. */
export function hostunicoRelevantAnswers(latestCaller: string, transcript: { speaker: string; body: string }[] = [], country = 'GB') {
  const callerTurns = transcript.filter((line) => line.speaker !== 'agent').slice(-2).map((line) => line.body);
  const texts = [latestCaller, ...callerTurns.reverse()];
  const picked = new Map<string, string>();
  for (const text of texts) {
    for (const answer of HOSTUNICO_ANSWERS) {
      if (picked.size >= MAX_RELEVANT) break;
      if (!picked.has(answer.key) && answer.match.test(text)) picked.set(answer.key, `${answer.title}: ${hostunicoAnswerCopy(answer, country)}${answer.nextQuestion ? ` Useful question: ${answer.nextQuestion}` : ''}`);
    }
  }
  return [...picked.values()];
}

export function hostunicoCoachRequest(args: { model: string; userMsg: string; latestCaller: string; transcript?: { speaker: string; body: string }[]; country?: string }) {
  const relevant = hostunicoRelevantAnswers(args.latestCaller, args.transcript, args.country);
  return {
    model: args.model,
    temperature: 0.3,
    max_completion_tokens: HOSTUNICO_COACH_MAX_TOKENS,
    ...(REASONING_MODEL.test(args.model) ? { reasoning_effort: 'none' } : {}),
    stream: true,
    prompt_cache_key: HOSTUNICO_COACH_CACHE_KEY,
    messages: [
      { role: 'system' as const, content: HOSTUNICO_COACH_CORE_PROMPT },
      { role: 'system' as const, content: HOSTUNICO_OBJECTION_PLAYBOOK },
      { role: 'system' as const, content: relevant.length ? `Prepared answers relevant to this turn:\n${relevant.join('\n')}` : 'No prepared answer matches this turn. Answer from the rules and the transcript.' },
      { role: 'user' as const, content: args.userMsg },
    ],
  };
}
