import { describe, expect, it } from 'vitest';
import { hostunicoInstantAnswer } from '../supabase/functions/_shared/hostunico-sales';
import { hostunicoJevAnswer, hostunicoJevRequest } from '../supabase/functions/_shared/hostunico-jev';
import { HOSTUNICO_COACH_PROMPT } from '../supabase/functions/_shared/hostunico-coach';
import { hostunicoReportRecipient } from '../supabase/functions/_shared/hostunico-report-pitch';

describe('company answers approved by Hugo on 1 October', () => {
  it.each(['What is your company name?', 'Which company are you with?', 'Who do you work for?', 'What is the company called?', 'Who is this?'])('answers %s with the brand, without legal details', (question) => {
    expect(hostunicoInstantAnswer(question)?.say).toBe("I'm with Hostunico.");
  });
  it.each(['What is your registered company name?', 'What is the legal name?', 'What company name are you registered under?'])('gives the registered name for %s', (question) => {
    const answer = hostunicoInstantAnswer(question);
    expect(answer?.say).toBe('The registered company is ULINC UNICO GROUP LTD.');
    expect(answer?.say).not.toContain('11197856');
  });
  it('only gives the company number when asked for registration verification', () => {
    expect(hostunicoInstantAnswer('What is your company number?')?.say).toContain('11197856');
    expect(hostunicoInstantAnswer('Can I find you on Companies House?')?.say).toContain('11197856');
  });
  it.each(['What is your office address?', 'Where are you based?', 'Where is your office?'])('gives the registered address for %s', (question) => {
    expect(hostunicoInstantAnswer(question)?.say).toBe('Our registered address is 483 Green Lanes, London, England, N13 4BS.');
  });
  it.each(['Can I visit your office?', 'Are you open to the public?', 'Could I drop by the office?', 'Can we meet at your office?', 'Can I come to Green Lanes?', 'Can I meet you at your office?'])('answers %s without inviting a visit', (question) => {
    expect(hostunicoInstantAnswer(question)?.say).toBe("We're not open to the public. We operate remotely, with the on-site work happening at the properties.");
  });
  it('keeps office visits separate from property visits and compound questions', () => {
    expect(hostunicoInstantAnswer('Are you coming to the property?')?.key).toBe('hostunico-property-visit');
    expect(hostunicoInstantAnswer('What is your company name and your address?')).toBeNull();
    expect(hostunicoInstantAnswer('What is your address and can I visit your office?')).toBeNull();
    expect(hostunicoInstantAnswer('What is your office address and can I visit you there?')).toBeNull();
    expect(hostunicoInstantAnswer('Actually, I mean your registered company name')).toBeNull();
  });
  it('makes the same short answers available to Jev and the contextual coach', () => {
    const criteria = hostunicoJevRequest('Can I visit your office?', []).questions.approved_answer.criteria;
    for (const key of ['identity', 'company-registration', 'company-number', 'company-office-visits']) {
      expect(criteria).toHaveProperty(key);
      const result = hostunicoJevAnswer({ answers: { approved_answer: { type: 'choice', choice: key, confidence: 0.99, probabilities: { [key]: 0.99 } } } });
      expect(result).toContain('SAY:');
      expect(result).not.toMatch(/[\u2013\u2014\u2018\u2019\u2026]/);
    }
    expect(HOSTUNICO_COACH_PROMPT).toContain('Use Hostunico for ordinary company-name questions');
    expect(HOSTUNICO_COACH_PROMPT).toContain("We're not open to the public");
  });
  it('retains the current-mobile, alternative-mobile and email branches', () => {
    expect(hostunicoReportRecipient('+447700900123')).toBe('Perfect. Can I text it to this number?');
    expect(hostunicoReportRecipient('+442079460000')).toBe('Perfect. What mobile number can I text the report to? Or would you prefer email?');
    expect(hostunicoReportRecipient('+442079460000', '+447700900456')).toContain('mobile ending 0456');
  });
});
