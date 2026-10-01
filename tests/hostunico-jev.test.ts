import { describe, expect, it, vi } from 'vitest';
import { hostunicoJevAnswer, hostunicoJevRequest, raceHostunicoCoach, selectHostunicoJevAnswer } from '../supabase/functions/_shared/hostunico-jev';
import { HOSTUNICO_COACH_PROMPT } from '../supabase/functions/_shared/hostunico-coach';
import { hostunicoInstantAnswer } from '../supabase/functions/_shared/hostunico-sales';

const choice = (key: string, confidence = 0.98, probability = 0.99) => ({ answers: { approved_answer: { type: 'choice', choice: key, confidence, probabilities: { [key]: probability } } } });
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

describe('Hostunico company knowledge', () => {
  it('gives the published legal identity, registered address and contact without inventing a local office', () => {
    expect(hostunicoInstantAnswer('What is your company number?')?.say).toContain('11197856');
    expect(hostunicoInstantAnswer('What is your company name?')?.say).toBe("I'm with Hostunico.");
    expect(hostunicoInstantAnswer('What is your registered company name?')?.say).toBe('The registered company is ULINC UNICO GROUP LTD.');
    expect(hostunicoInstantAnswer('Where are you based?')?.say).toBe('Our registered address is 483 Green Lanes, London, England, N13 4BS.');
    expect(hostunicoInstantAnswer('What is your email address?')?.say).toContain('hello@hostunico.com');
    expect(hostunicoInstantAnswer('What is your website?')?.say).toContain('hostunico.com');
    expect(hostunicoInstantAnswer('How long have you been doing this?')?.say).toContain('200 properties over four years');
    expect(hostunicoInstantAnswer('Who is your night manager in Leeds?')).toBeNull();
    expect(HOSTUNICO_COACH_PROMPT).toContain('not 200 currently managed homes');
    expect(HOSTUNICO_COACH_PROMPT).toContain('483 Green Lanes');
  });
  it('does not let an old fee keyword override the caller correcting their question', () => {
    expect(hostunicoInstantAnswer('Your fee, actually I mean your company address?')).toBeNull();
    expect(hostunicoInstantAnswer('What are your fees and your company address?')).toBeNull();
  });
});

describe('Jev only selects approved words', () => {
  it('uses the documented request contract and leaves unmatched or compound requests to OpenAI', () => {
    const request = hostunicoJevRequest('Where is the business based?', [], 'US');
    expect(request.model).toBe('jev-1.13.0');
    expect(request.questions.approved_answer.type).toBe('choice');
    expect(request.questions.approved_answer.criteria.none).toContain('No single');
    expect(JSON.stringify(request)).toContain('$29');
    expect(JSON.stringify(request)).not.toContain('£29');
    expect(hostunicoJevAnswer(choice('company-address'))).toContain('registered address is 483 Green Lanes');
    expect(hostunicoJevAnswer(choice('price'), 'US')).toContain('$29');
  });
  it('rejects no-match, low confidence, low probability, invented text and malformed answers', () => {
    for (const value of [null, {}, [], choice('none'), choice('invented answer'), choice('report'), choice('price', 0.7), choice('price', 0.95, 0.5), choice('price', NaN), choice('price', 2), choice('price', 0.98, Infinity)]) expect(hostunicoJevAnswer(value)).toBeNull();
  });
  it('makes no request without a key and falls back without retrying provider errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    const input = { apiKey: '', latestCaller: 'Where is the company based?', transcript: [], country: 'GB', signal: new AbortController().signal, fetcher };
    expect(await selectHostunicoJevAnswer(input)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await selectHostunicoJevAnswer({ ...input, apiKey: 'test-key' })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValueOnce(new Error('network unavailable'));
    expect(await selectHostunicoJevAnswer({ ...input, apiKey: 'test-key' })).toBeNull();
  });
});

describe('live coach response race', () => {
  it('shows a confident Jev answer immediately and cancels the unneeded generation', async () => {
    const onChunk = vi.fn(); let signal!: AbortSignal;
    const result = await raceHostunicoCoach({ fast: async () => 'SAY: Approved answer.\nASK:', generate: async (_, s) => { signal = s; return new Promise((_, reject) => s.addEventListener('abort', () => reject(new Error('aborted')))); }, onChunk, isAborted: () => false });
    expect(result?.source).toBe('jev');
    expect(signal.aborted).toBe(true);
    expect(onChunk).toHaveBeenCalledOnce();
  });
  it('does not wait for Jev and never lets a late answer overwrite an OpenAI stream', async () => {
    const fast = pending<string | null>(); const onChunk = vi.fn();
    const result = await raceHostunicoCoach({ fast: () => fast.promise, generate: async (write) => { write('SAY: Current', true); write('SAY: Current answer.', false); return 'SAY: Current answer.'; }, onChunk, isAborted: () => false });
    fast.resolve('SAY: Late different answer.'); await Promise.resolve();
    expect(result).toEqual({ source: 'openai', body: 'SAY: Current answer.' });
    expect(onChunk.mock.calls.map(([text]) => text)).toEqual(['SAY: Current', 'SAY: Current answer.']);
  });
  it('falls through on an uncertain fast answer and drops superseded output', async () => {
    const onChunk = vi.fn();
    const result = await raceHostunicoCoach({ fast: async () => null, generate: async (write) => { write('SAY: Fresh response.', true); return 'SAY: Fresh response.'; }, onChunk, isAborted: () => false });
    expect(result?.source).toBe('openai');
    onChunk.mockClear();
    expect(await raceHostunicoCoach({ fast: async () => 'SAY: Old response.', generate: async (write) => { write('SAY: Old response.', true); return 'SAY: Old response.'; }, onChunk, isAborted: () => true })).toBeNull();
    expect(onChunk).not.toHaveBeenCalled();
  });
});
