import { reportRecipientQuestion } from './hostunico-phone.ts';
import { HOSTUNICO_ANSWERS, HOSTUNICO_SOFT_OBJECTION_KEYS, hostunicoAnswerCopy } from './hostunico-answer-bank.ts';
export { HOSTUNICO_ANSWERS, hostunicoAnswerCopy } from './hostunico-answer-bank.ts';
// One approved offer for the call room, instant answers and live AI coach.
export const HOSTUNICO_STAGES = ['Advert availability', 'Offer the report', 'Send and confirm receipt', 'Review the numbers', 'Readiness and next step'];
export { HOSTUNICO_RULES } from './hostunico-rules.ts';

// A second clear refusal is accepted warmly and the door left open.
export const HOSTUNICO_ACCEPT_NO = "No problem at all, I'll leave it there. Thanks for your time, and if anything changes you're welcome to call me back.";
const SOFT_OBJECTIONS = HOSTUNICO_ANSWERS.filter((item) => HOSTUNICO_SOFT_OBJECTION_KEYS.includes(item.key));
/** Did the caller already turn us down softly earlier in this call? */
export function hostunicoEarlierRefusal(history: readonly string[] = []) {
  return history.some((line) => !/\bnot interested (?:in|unless|but)\b/i.test(line) && SOFT_OBJECTIONS.some((item) => item.match.test(line)));
}

/** history: the caller's earlier lines on this call, oldest first, without the current one. */
export function hostunicoInstantAnswer(utterance: string, country = 'GB', recipient?: { phone?: string; mobile?: string | null }, history: readonly string[] = []) {
  // A property fact is not a request to explain the matching keyword.
  if (!/\?/.test(utterance) && /^(?:yes[, ]+)?(?:it(?:'s| is)|the (?:flat|property|studio|apartment) is) (?:already )?(?:furnished|empty|available|ready|a studio|one bed)\b/i.test(utterance)) return null;
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
  // Permission to explain needs the current report and conversation. A static
  // service answer would skip the property's earnings and asking-rent hook.
  if (answer && ['service', 'report'].includes(answer.key)) return null;
  if (answer && HOSTUNICO_SOFT_OBJECTION_KEYS.includes(answer.key) && hostunicoEarlierRefusal(history)) {
    return { key: 'hostunico-accept-no', title: 'Second no, accept it', say: HOSTUNICO_ACCEPT_NO, why: 'They said no twice. Accept it warmly and end the call politely.', nextQuestion: '' };
  }
  const reportQuestion = /\bemail\b/i.test(utterance) ? 'What email address should I send the report to?' : reportRecipientQuestion(recipient?.phone, recipient?.mobile);
  return answer ? { key: `hostunico-${answer.key}`, title: answer.title, say: hostunicoAnswerCopy(answer, country), why: 'Approved Hostunico answer. Pause and listen after answering.', nextQuestion: answer.key === 'report' ? reportQuestion : answer.nextQuestion || '' } : null;
}
