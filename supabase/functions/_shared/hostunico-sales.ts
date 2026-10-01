import { reportRecipientQuestion } from './hostunico-phone.ts';
import { HOSTUNICO_ANSWERS, hostunicoAnswerCopy } from './hostunico-answer-bank.ts';
export { HOSTUNICO_ANSWERS, hostunicoAnswerCopy } from './hostunico-answer-bank.ts';
// One approved offer for the call room, instant answers and live AI coach.
export const HOSTUNICO_STAGES = ['Availability and authority', 'Offer the report', 'Send and confirm receipt', 'Review the numbers', 'Readiness and next step'];
export { HOSTUNICO_RULES } from './hostunico-rules.ts';

export function hostunicoInstantAnswer(utterance: string, country = 'GB', recipient?: { phone?: string; mobile?: string | null }) {
  // A correction needs its meaning read, not the first keyword matched.
  if (/\b(actually|i mean(?:t)?|rather|sorry|not your|instead)\b/i.test(utterance)) return null;
  // A qualified rejection or double negative needs context, not a stop keyword.
  if (/\bnot interested (?:in|unless|but)\b|\b(?:don.t|do not) (?:stop|remove)\b/i.test(utterance)) return null;
  const stop = HOSTUNICO_ANSWERS.find((item) => item.key === 'stop');
  const matches = HOSTUNICO_ANSWERS.filter((item) => item.match.test(utterance));
  // A specific answer can cover its broad parent topic. Independent questions
  // still go to the conversational coach, which must answer every part.
  const covered = new Set(matches.flatMap((item) => item.supersedes || []));
  const specific = matches.filter((item) => !covered.has(item.key));
  const answer = stop?.match.test(utterance) ? stop : specific.length === 1 ? specific[0] : null;
  // A parent topic in a separate question is not covered by a specific answer.
  // "Cleaning cost, and your management fee?" needs both answers. A generic
  // "how does it work?" can still refer to the specific topic just mentioned.
  if (answer && !['stop', 'access-and-cleaning', 'access-example'].includes(answer.key)) {
    const clauses = utterance.split(/[?;]|\b(?:and|also|but)\b/i).filter((part) => part.trim());
    if (clauses.some((part) => !answer.match.test(part) && matches.some((item) => item.key !== 'service' && answer.supersedes?.includes(item.key) && item.match.test(part)))) return null;
  }
  const reportQuestion = /\bemail\b/i.test(utterance) ? 'What email address should I send the report to?' : reportRecipientQuestion(recipient?.phone, recipient?.mobile);
  return answer ? { key: `hostunico-${answer.key}`, title: answer.title, say: hostunicoAnswerCopy(answer, country), why: 'Approved Hostunico answer. Pause and listen after answering.', nextQuestion: answer.key === 'report' ? reportQuestion : answer.nextQuestion || '' } : null;
}
