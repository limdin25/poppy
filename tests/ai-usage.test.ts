// The cost log's writer, the token readers for each provider, and the two
// places the live coach reads token counts from.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logAiUsage, tokensFromAnthropic, tokensFromGemini, tokensFromOpenAI, usageRow } from '../supabase/functions/_shared/ai-usage';
import { parseSseChunk } from '../supabase/functions/wk-voice-transcription/coach-stream';
import { selectHostunicoJevAnswer } from '../supabase/functions/_shared/hostunico-jev';

afterEach(() => vi.useRealTimers());

describe('reading token counts, one rule for every provider', () => {
  it('Anthropic leaves the cache out of input_tokens, so it is added back', () => {
    expect(tokensFromAnthropic({ input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 }))
      .toEqual({ inputTokens: 1050, outputTokens: 20, cachedInputTokens: 900 });
  });
  it('OpenAI reports prompt tokens with the cached part inside, and reasoning inside the output', () => {
    expect(tokensFromOpenAI({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 600 } }))
      .toEqual({ inputTokens: 1000, outputTokens: 50, cachedInputTokens: 600 });
  });
  it('Gemini thinking tokens are billed as output', () => {
    expect(tokensFromGemini({ promptTokenCount: 1200, candidatesTokenCount: 80, thoughtsTokenCount: 300, cachedContentTokenCount: 200 }))
      .toEqual({ inputTokens: 1200, outputTokens: 380, cachedInputTokens: 200 });
  });
  it('missing, negative or nonsense numbers count as zero', () => {
    expect(tokensFromOpenAI(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
    expect(tokensFromGemini({ promptTokenCount: -5, candidatesTokenCount: 'x', thoughtsTokenCount: NaN })).toEqual({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  });
});

describe('the row that is written', () => {
  it('labels, rounds and bounds what it is given', () => {
    const row = usageRow({ provider: 'openai', model: 'gpt-5.4-mini', inputTokens: 100.4, outputTokens: 7, cachedInputTokens: 5000, units: 1.234567, latencyMs: 812.6, ref: 'x'.repeat(500) });
    expect(row).toMatchObject({ provider: 'openai', model: 'gpt-5.4-mini', feature: 'unlabelled', input_tokens: 100, output_tokens: 7, units: 1.2346, latency_ms: 813, ok: true, requested_model: null, business_id: null });
    // Cached tokens can never exceed the input they are part of.
    expect(row.cached_input_tokens).toBe(100);
    expect(row.ref).toHaveLength(120);
  });
  it('records a failed call and the model that was asked for instead', () => {
    expect(usageRow({ provider: 'anthropic', model: 'claude-sonnet-5', feature: 'x', ok: false, requestedModel: 'gemini-3.8-flash' }))
      .toMatchObject({ ok: false, requested_model: 'gemini-3.8-flash' });
  });
});

describe('writing it must never hurt the call it describes', () => {
  it('inserts into ai_usage_log', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ insert }));
    await logAiUsage({ from }, { provider: 'google', model: 'gemini-3.8-flash', feature: 'houses-test', inputTokens: 10 });
    expect(from).toHaveBeenCalledWith('ai_usage_log');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google', feature: 'houses-test', input_tokens: 10 }));
  });
  it('swallows a database error, a thrown error and a missing client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(logAiUsage({ from: () => ({ insert: async () => ({ error: { message: 'boom' } }) }) }, { provider: 'openai', model: 'm' })).resolves.toBeUndefined();
    await expect(logAiUsage({ from: () => { throw new Error('down'); } }, { provider: 'openai', model: 'm' })).resolves.toBeUndefined();
    await expect(logAiUsage(undefined, { provider: 'openai', model: 'm' })).resolves.toBeUndefined();
    warn.mockRestore();
  });
  it('gives up after two and a half seconds on a database that hangs', async () => {
    vi.useFakeTimers();
    let done = false;
    const pending = logAiUsage({ from: () => ({ insert: () => new Promise(() => {}) }) }, { provider: 'openai', model: 'm' }).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(2400);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(done).toBe(true);
  });
});

describe('the live coach reads token counts without changing what it does', () => {
  it('OpenAI sends usage in the last chunk, which the stream parser now passes on', () => {
    const chunk = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":8400,"completion_tokens":31,"prompt_tokens_details":{"cached_tokens":8192}}}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    const { events } = parseSseChunk(chunk);
    expect(events).toEqual([
      { delta: 'Hi', done: false },
      { delta: '', done: false, usage: { prompt_tokens: 8400, completion_tokens: 31, prompt_tokens_details: { cached_tokens: 8192 } } },
      { delta: '', done: true },
    ]);
  });
  it('Jev hands its usage to the logger, and a logger that throws cannot lose the answer', async () => {
    const payload = { answers: { approved_answer: { type: 'choice', choice: 'none', confidence: 0.99, probabilities: {} } }, usage: { input_tokens: 362, output_tokens: 32 } };
    const fetcher = vi.fn(async () => Response.json(payload));
    const base = { apiKey: 'k', latestCaller: 'hello', transcript: [], country: 'GB', signal: new AbortController().signal, fetcher: fetcher as unknown as typeof fetch };
    const seen: unknown[] = [];
    await selectHostunicoJevAnswer({ ...base, onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([{ input_tokens: 362, output_tokens: 32 }]);
    await expect(selectHostunicoJevAnswer({ ...base, onUsage: () => { throw new Error('logger broke'); } })).resolves.toBeNull();
  });
});
