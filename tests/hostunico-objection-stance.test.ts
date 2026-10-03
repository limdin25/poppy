import { describe, expect, it } from 'vitest';
import { hostunicoInstantAnswer } from '../supabase/functions/_shared/hostunico-sales';
import { HOSTUNICO_COACH_PROMPT, HOSTUNICO_COACH_CORE_PROMPT } from '../supabase/functions/_shared/hostunico-coach';
import { HOSTUNICO_RULES } from '../supabase/functions/_shared/hostunico-rules';
import { HOSTUNICO_MARKET_FEE_LINE } from '../supabase/functions/_shared/hostunico-pricing';
import { hostunicoCoachRequest, hostunicoRelevantAnswers, HOSTUNICO_COACH_MAX_TOKENS } from '../supabase/functions/_shared/hostunico-coach-request';
import { hostunicoJevRequest } from '../supabase/functions/_shared/hostunico-jev';

// Pedro and Hugo, 3 Oct 2026: the coach accepted every "not interested". The
// first soft refusal is now a moment to reframe and offer the free report; the
// second is accepted warmly; a do-not-call request is always respected at once.

const LONG_DASH = /[‒-―‘’“”…]/;
const SOFT = [
  'Not interested',
  'No thanks',
  'We are happy as we are',
  'I already have a manager',
  'That is too expensive',
  'I need to think about it',
  'I do it myself',
  'I prefer a long-term tenant',
  'Not now, maybe later',
];

describe('first soft refusal gets a rebuttal, not an acceptance', () => {
  it.each(SOFT)('%s', (line) => {
    const answer = hostunicoInstantAnswer(line, 'GB', undefined, []);
    expect(answer).not.toBeNull();
    expect(answer!.key).not.toBe('hostunico-stop');
    expect(answer!.key).not.toBe('hostunico-accept-no');
    expect(answer!.say).not.toMatch(/I will record that|so we don.t keep following up|leave it for now/i);
    expect(`${answer!.say} ${answer!.nextQuestion}`).toMatch(/report|numbers|compare|send/i);
    expect(answer!.nextQuestion).toMatch(/\?$/);
    expect(`${answer!.say} ${answer!.nextQuestion}`).not.toMatch(LONG_DASH);
  });
});

describe('second refusal is accepted gracefully', () => {
  it.each(SOFT)('%s after an earlier no', (line) => {
    const answer = hostunicoInstantAnswer(line, 'GB', undefined, ['No thanks, not for me']);
    expect(answer?.key).toBe('hostunico-accept-no');
    expect(answer?.nextQuestion).toBe('');
    expect(answer?.say).toMatch(/leave it there/i);
  });
  it('an earlier question is not an earlier refusal', () => {
    expect(hostunicoInstantAnswer('Not interested', 'GB', undefined, ['How much do you charge?'])?.key).toBe('hostunico-soft-no');
  });
});

describe('a do-not-call request is always respected immediately', () => {
  it.each(['Stop calling me', 'Please remove my number', 'Do not call me again', 'Leave me alone', 'Take me off your list', 'I have a legal reason, stop ringing'])('%s', (line) => {
    expect(hostunicoInstantAnswer(line, 'GB', undefined, [])?.key).toBe('hostunico-stop');
    expect(hostunicoInstantAnswer(line)?.nextQuestion).toBe('');
  });
  it('even mixed with a soft objection', () => {
    expect(hostunicoInstantAnswer('Not interested, stop calling me')?.key).toBe('hostunico-stop');
  });
  it('a qualified not interested still goes to the contextual coach', () => {
    expect(hostunicoInstantAnswer('I am not interested in a tenant. Tell me about Airbnb.')).toBeNull();
    expect(hostunicoInstantAnswer('Not interested unless it beats the rent')).toBeNull();
  });
});

describe('price objections use the market comparison', () => {
  it('pins the wording in one place', () => {
    expect(HOSTUNICO_MARKET_FEE_LINE).toBe('Most managers charge somewhere between 15 and 20 percent, ours is 9 percent plus VAT.');
  });
  it.each(['That is too expensive', 'Your fee is too high', 'Not interested, your fee is too much', 'I already have a manager'])('%s', (line) => {
    expect(hostunicoInstantAnswer(line)?.say).toContain(HOSTUNICO_MARKET_FEE_LINE);
  });
  it('the rules and the live coach prompt carry it and the new stance', () => {
    for (const prompt of [HOSTUNICO_RULES, HOSTUNICO_COACH_PROMPT, HOSTUNICO_COACH_CORE_PROMPT]) {
      expect(prompt).toContain(HOSTUNICO_MARKET_FEE_LINE);
      expect(prompt).not.toContain('accept a no');
      expect(prompt).toContain('first soft refusal');
      expect(prompt).toContain('second clear refusal');
      expect(prompt).toMatch(/do-not-call/i);
      expect(prompt).not.toMatch(LONG_DASH);
    }
  });
  it('keeps the existing price rules intact', () => {
    expect(hostunicoInstantAnswer('How much is it?', 'GB')?.say).toContain('£29');
    expect(hostunicoInstantAnswer('How much is it?', 'US')?.say).toContain('$29');
    expect(HOSTUNICO_RULES).toContain('No onboarding fee');
    expect(HOSTUNICO_RULES).toContain('Never promise guaranteed rent');
  });
});

describe('the fast coach request', () => {
  it('sends only the relevant prepared answers after a static cacheable prefix', () => {
    const body = hostunicoCoachRequest({ model: 'gpt-5.4-mini', userMsg: '{}', latestCaller: 'Who is the cleaner and what about parties?' });
    expect(body.messages[0].content).toBe(HOSTUNICO_COACH_CORE_PROMPT);
    expect(body.messages[1].content).toContain('OBJECTION PLAYBOOK');
    expect(body.messages[2].content).toContain('Who actually cleans');
    expect(body.messages[2].content).toContain('parties');
    expect(body.messages[2].content).not.toContain('AirCover');
    expect(body.max_completion_tokens).toBe(HOSTUNICO_COACH_MAX_TOKENS);
    expect(HOSTUNICO_COACH_MAX_TOKENS).toBeLessThanOrEqual(120);
    expect(body.reasoning_effort).toBe('none');
    expect(HOSTUNICO_COACH_CORE_PROMPT.length).toBeLessThan(HOSTUNICO_COACH_PROMPT.length * 0.7);
  });
  it('caps the relevant answers', () => {
    expect(hostunicoRelevantAnswers('cleaning parties linen furniture photos insurance repairs emergency utilities').length).toBeLessThanOrEqual(6);
  });
  it('Jev never picks a soft objection, because it cannot see whether this is the second no', () => {
    const keys = Object.keys(hostunicoJevRequest('x', []).questions.approved_answer.criteria);
    for (const key of ['soft-no', 'too-expensive', 'existing-manager', 'self-manage', 'long-term', 'think-about-it', 'not-now']) expect(keys).not.toContain(key);
    expect(keys).toContain('stop');
  });
});
