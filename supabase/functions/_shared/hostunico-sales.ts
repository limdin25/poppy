import { hostunicoPriceCopy } from './hostunico-pricing.ts';
// One approved offer for the call room, instant answers and live AI coach.
export const HOSTUNICO_STAGES = ['Availability and authority', 'Offer the report', 'Send and confirm receipt', 'Review the numbers', 'Readiness and next step'];
export { HOSTUNICO_RULES } from './hostunico-rules.ts';

export const HOSTUNICO_ANSWERS = [
  { key: 'price', title: 'The price', match: /\b(your fee|fees?|what.*cost|commission|percentage|nine percent|9%|vat|how much (?:is it|do you charge|does it cost))\b/i, say: hostunicoPriceCopy() },
  { key: 'guarantee', title: 'Estimates, not promises', match: /\b(guarantee|guaranteed|fixed rent|certain|definitely more)\b/i, say: 'The report is an estimate, not guaranteed income. We can go through its assumptions and costs together before you decide.' },
  { key: 'account', title: 'Their Airbnb account', match: /\b(whose account|my account|own account|airbnb account|keep.*account)\b/i, say: 'It stays in your Airbnb account. We start with Airbnb and help with the management setup, then look at other platforms.' },
  { key: 'cleaning', title: 'Who handles cleaning', match: /\b(cleaner|cleaning|laundry|supplies)\b/i, say: 'Elsie and our operations team coordinate the cleaning and review the photos. The actual cleaning cost is separate from our management fee.' },
  { key: 'permission', title: 'Check permission', match: /\b(lease|mortgage|council|licen[cs]e|permission|90 nights|28 nights)\b/i, say: 'We need to check the local rules and your property permissions before agreeing a launch. I can confirm the details with Hugo.' },
  { key: 'notenant', title: 'Explain why we called', match: /\b(are you.*tenant|looking to rent|company let|rent it yourself)\b/i, say: 'I am calling from Hostunico about property management. We help owners run short stays through Airbnb. Would a report comparing the estimated earnings with your current rent be useful?' },
  { key: 'stop', title: 'Respect their decision', match: /\b(stop calling|do not call|don.t call|remove.*number|not interested)\b/i, say: 'Understood, thank you for letting me know. I will record that so we do not keep following up.' },
  { key: 'report', title: 'Check the report status', match: /\b(send.*report|send.*details|text me|send.*text|send.*email)\b/i, say: 'Of course. I can send you a browser link to the report.' },
] as const;

export function hostunicoInstantAnswer(utterance: string, country = 'GB') {
  const stop = HOSTUNICO_ANSWERS.find((item) => item.key === 'stop');
  const answer = stop?.match.test(utterance) ? stop : HOSTUNICO_ANSWERS.find((item) => item.match.test(utterance));
  return answer ? { key: `hostunico-${answer.key}`, title: answer.title, say: answer.key === 'price' ? hostunicoPriceCopy(country) : answer.say, why: 'Approved Hostunico answer. Pause and listen after answering.', nextQuestion: answer.key === 'stop' || answer.say.endsWith('?') ? '' : answer.key === 'report' ? 'What mobile number or email should I use?' : 'What would you like to know before we go further?' } : null;
}
