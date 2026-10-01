import { describe, expect, it } from 'vitest';
import { HOSTUNICO_ANSWERS, hostunicoAnswerCopy } from '../supabase/functions/_shared/hostunico-answer-bank';
import { hostunicoInstantAnswer } from '../supabase/functions/_shared/hostunico-sales';
import { hostunicoJevAnswer, hostunicoJevRequest } from '../supabase/functions/_shared/hostunico-jev';
import { HOSTUNICO_COACH_PROMPT } from '../supabase/functions/_shared/hostunico-coach';
import { HOSTUNICO_SPOKEN_ANSWERS } from '../supabase/functions/_shared/hostunico-spoken-answers';

describe('prepared Hostunico conversations', () => {
  it('has a spoken version of every factual answer without putting both software currencies into a call', () => {
    const fixed = HOSTUNICO_ANSWERS.filter((a) => !['price', 'software'].includes(a.key));
    expect(Object.keys(HOSTUNICO_SPOKEN_ANSWERS).sort()).toEqual(fixed.map((a) => a.key).sort());
    for (const country of ['GB', 'US']) {
      for (const answer of HOSTUNICO_ANSWERS) {
        const spoken = hostunicoAnswerCopy(answer, country);
        expect(spoken).not.toMatch(/[\u2013\u2014\u2018\u2019\u2026]|hello@unicohost\.com|for UK leads|for US leads/);
        expect(spoken).not.toContain(country === 'GB' ? '$29' : '£29');
      }
    }
  });

  it('gives Hugo\'s corrected contact and property location, and keeps Airbnb protection precise', () => {
    expect(hostunicoInstantAnswer('What is your email address?')?.say).toContain('hello@hostunico.com');
    expect(hostunicoInstantAnswer('How do I make a complaint?')?.say).toContain('hello@hostunico.com');
    expect(hostunicoInstantAnswer('Where are your properties?')?.say).toBe('Our properties are in Manchester and Liverpool.');
    const cover = hostunicoInstantAnswer('What about Airbnb insurance?')?.say;
    expect(cover).toContain('up to US$3 million');
    expect(cover).toContain('US$1 million');
    expect(cover).toContain('terms and exclusions');
    expect(HOSTUNICO_COACH_PROMPT).not.toContain('hello@unicohost.com');
  });

  it.each([
    ['How much is it?', 'price'],
    ['What is the monthly subscription?', 'software'],
    ['What about VAT?', 'vat'],
    ['Is that gross or net?', 'fee-basis'],
    ['Is there a joining fee?', 'onboarding-fee'],
    ['Can I get a discount?', 'discount'],
    ['That is too expensive', 'too-expensive'],
    ['Are there hidden costs?', 'hidden-costs'],
    ['Is this just AI?', 'human-team'],
    ['I manage it myself', 'self-manage'],
    ['I already have a manager', 'existing-manager'],
    ['I prefer a long-term tenant', 'long-term'],
    ['I need to think about it', 'think-about-it'],
    ['Not now, maybe later', 'not-now'],
    ['Why Airbnb?', 'why-airbnb'],
    ['What about quiet months?', 'seasonality'],
    ['What kind of guests?', 'guest-types'],
    ['What about parties?', 'parties'],
    ['Tell me about AirCover', 'damage'],
    ['What about my own insurance?', 'property-insurance'],
    ['Who handles guest messages?', 'guest-comms'],
    ['Do I need a key safe?', 'access'],
    ['Who handles repairs?', 'maintenance'],
    ['What happens in an emergency?', 'emergency'],
    ['Do I need professional photos?', 'photos'],
    ['What about furniture?', 'furnishing'],
    ['Who handles linen?', 'linen'],
    ['Who pays the bills?', 'utilities'],
    ['Can I stay there myself?', 'personal-use'],
    ['How can I see my bookings?', 'portal'],
    ['When do I get paid?', 'payout-timing'],
    ['What is a co-host?', 'cohost'],
    ['What about Booking.com?', 'other-platforms'],
    ['What are the next steps?', 'onboarding'],
    ['How soon can it go live?', 'launch-time'],
    ['Can I see the contract?', 'agreement'],
    ['Is there a cooling-off period?', 'cooling-off'],
    ['Am I locked in?', 'ending-service'],
    ['What happens to existing bookings?', 'existing-bookings'],
    ['Where do the numbers come from?', 'report-method'],
    ['Is that net profit?', 'net-income'],
    ['Do I need a PDF?', 'report-format'],
    ['I am not the owner', 'not-owner'],
    ['It is already let', 'already-let'],
    ['It is only a room', 'unsuitable-room'],
    ['Can I see references?', 'references'],
    ['How do I make a complaint?', 'complaint'],
    ['Can you give tax advice?', 'legal-advice'],
  ])('answers %s with the appropriate prepared response', (utterance, key) => {
    expect(hostunicoInstantAnswer(utterance)?.key).toBe(`hostunico-${key}`);
  });

  it('keeps every approved answer available to Jev with the same wording and tailored question', () => {
    expect(HOSTUNICO_ANSWERS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(HOSTUNICO_ANSWERS.map((a) => a.key)).size).toBe(HOSTUNICO_ANSWERS.length);
    for (const country of ['GB', 'US']) {
      const criteria = hostunicoJevRequest('A question', [], country).questions.approved_answer.criteria;
      for (const answer of HOSTUNICO_ANSWERS.filter((a) => !['report', 'service'].includes(a.key))) {
        const payload = { answers: { approved_answer: { type: 'choice', choice: answer.key, confidence: 0.99, probabilities: { [answer.key]: 0.99 } } } };
        expect(criteria).toHaveProperty(answer.key);
        expect(hostunicoJevAnswer(payload, country)).toBe(`SAY: ${hostunicoAnswerCopy(answer, country)}\nASK: ${answer.nextQuestion || ''}`);
      }
    }
  });

  it('keeps prices local in both fee answers, with detailed VAT only when asked', () => {
    for (const question of ['How much is it?', 'What is the monthly subscription?']) {
      expect(hostunicoInstantAnswer(question, 'GB')?.say).toContain('£29');
      expect(hostunicoInstantAnswer(question, 'US')?.say).toContain('$29');
      expect(hostunicoInstantAnswer(question, 'US')?.say).not.toContain('£29');
      expect(hostunicoInstantAnswer(question)?.say).not.toMatch(/20%|registration|pending|billing/i);
    }
    expect(hostunicoInstantAnswer('What about VAT?')?.say).toContain('20% of our management fee');
    expect(hostunicoInstantAnswer('I need to think about it')?.nextQuestion).toContain('clarify');
    expect(hostunicoInstantAnswer('Not interested')?.nextQuestion).toBe('');
  });

  it('leaves corrections, mixed questions and unsupported facts to the conversational coach', () => {
    for (const question of [
      'Your fees, actually I meant your address',
      'I am not interested in a tenant. Tell me about Airbnb.',
      "Don't stop calling, I want to discuss it",
      'No, not your prices. I meant when I get paid.',
      'What are your fees and who handles cleaning?',
      'Do I need linen and property photos?',
      'How much can my property make?',
      'Your local manager is called John, right?',
      'It is available from the fifteenth',
    ]) expect(hostunicoInstantAnswer(question)).toBeNull();
    expect(HOSTUNICO_COACH_PROMPT).toContain('Dynamic property facts and the current transcript take priority');
    expect(HOSTUNICO_COACH_PROMPT).toContain('Explain VAT only if they ask about it');
    for (const answer of HOSTUNICO_ANSWERS) {
      expect(answer.say).not.toMatch(/VAT registration|current billing|10\.8(?:0)?\s*%|[\u2013\u2014\u2018\u2019\u2026]/i);
    }
  });
});
