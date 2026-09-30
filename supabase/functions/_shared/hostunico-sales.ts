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
  const answer = stop?.match.test(utterance) ? stop : matches.length === 1 ? matches[0] : null;
  const reportQuestion = /\bemail\b/i.test(utterance) ? 'What email address should I send the report to?' : reportRecipientQuestion(recipient?.phone, recipient?.mobile);
  return answer ? { key: `hostunico-${answer.key}`, title: answer.title, say: hostunicoAnswerCopy(answer, country), why: 'Approved Hostunico answer. Pause and listen after answering.', nextQuestion: answer.key === 'report' ? reportQuestion : answer.nextQuestion || '' } : null;
}
