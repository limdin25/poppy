// Gemini through callLLM, and what every call writes to the AI cost log.
// No network: fetch is a fake Google, a fake Anthropic and a fake OpenAI, and
// the database is a list of inserted rows.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  return { rows: [] as any[], settings: {} as Record<string, string> };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'ai_usage_log') return { insert: async (row: any) => { env.rows.push(row); return { error: null }; } };
      const chain: any = {
        select: () => chain, eq: (_k: string, v: string) => { chain.key = v; return chain; },
        single: async () => ({ data: env.settings[chain.key] ? { value: env.settings[chain.key] } : null }),
        limit: () => chain, maybeSingle: async () => ({ data: null }),
      };
      return chain;
    },
  }),
}));

interface Call { url: string; headers: Record<string, string>; body: any }
let calls: Call[];
let googleStatus: number;
let googleReply: any;

function fakeFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    if (url.startsWith('https://img.example/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    calls.push({ url, headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes('generativelanguage.googleapis.com')) {
      const reply = typeof googleReply === 'function' ? googleReply(calls.filter((c) => c.url.includes('generativelanguage')).length) : googleReply;
      return new Response(JSON.stringify(reply.body ?? reply), { status: reply.status ?? googleStatus });
    }
    if (url.includes('api.anthropic.com')) {
      return Response.json({ content: [{ type: 'text', text: 'claude answer' }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 } });
    }
    return Response.json({ choices: [{ message: { content: 'gpt answer' } }], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 600 } } });
  }));
}

const GOOD = { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: 'hello from gemini' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 80, thoughtsTokenCount: 300, cachedContentTokenCount: 200 } };

async function load() {
  vi.resetModules();
  return (await import('../api/lib/llm')).callLLM;
}
const googleCalls = () => calls.filter((c) => c.url.includes('generativelanguage'));

beforeEach(() => {
  env.rows.length = 0;
  env.settings = {};
  for (const k of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete process.env[k];
  process.env.ANTHROPIC_API_KEY = 'ant-key';
  googleStatus = 200;
  googleReply = GOOD;
  fakeFetch();
});

describe('Gemini straight to Google', () => {
  it('sends the request Google expects, ignores thinking text, and logs thinking as output', async () => {
    process.env.GEMINI_API_KEY = 'g-key';
    const callLLM = await load();
    const out = await callLLM('gemini-3.8-flash', 'SYSTEM', [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1' }, { role: 'user', content: 'Q2' }], 1000, { feature: 'houses-test', thinkingBudget: 400 });
    expect(out).toBe('hello from gemini');
    const g = googleCalls();
    expect(g).toHaveLength(1);
    expect(g[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(g[0].headers['x-goog-api-key']).toBe('g-key');
    expect(g[0].url).not.toContain('g-key');
    expect(g[0].body.systemInstruction.parts[0].text).toBe('SYSTEM');
    expect(g[0].body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
    // The answer keeps all 1000 tokens: the ceiling is grown by the thinking allowance.
    expect(g[0].body.generationConfig).toMatchObject({ maxOutputTokens: 1400, thinkingConfig: { thinkingBudget: 400 } });
    expect(env.rows).toEqual([expect.objectContaining({
      provider: 'google', model: 'gemini-3.8-flash', feature: 'houses-test', input_tokens: 1200, output_tokens: 380, cached_input_tokens: 200, ok: true, requested_model: null,
    })]);
  });

  it('asks for JSON when the caller wants it and downloads linked pictures itself', async () => {
    process.env.GEMINI_API_KEY = 'g-key';
    const callLLM = await load();
    await callLLM('gemini-3.8-flash', 'S', [{ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'url', url: 'https://img.example/a.jpg' } }, { type: 'image', source: { type: 'url', url: 'http://insecure.example/b.jpg' } }] }], 500, { jsonOutput: true });
    const parts = googleCalls()[0].body.contents[0].parts;
    expect(googleCalls()[0].body.generationConfig.responseMimeType).toBe('application/json');
    expect(parts[1].inline_data).toEqual({ mime_type: 'image/jpeg', data: btoa(String.fromCharCode(1, 2, 3)) });
    expect(parts[2]).toEqual({ text: '[image skipped: not an https link]' });
  });

  it('retries once without a thinking budget when the model does not take one', async () => {
    process.env.GEMINI_API_KEY = 'g-key';
    googleReply = (n: number) => n === 1 ? { status: 400, body: { error: { message: 'thinking_budget is not supported for this model' } } } : GOOD;
    const callLLM = await load();
    expect(await callLLM('gemini-3.1-pro-preview', 'S', [{ role: 'user', content: 'x' }], 500)).toBe('hello from gemini');
    expect(googleCalls()).toHaveLength(2);
    expect(googleCalls()[0].body.generationConfig.thinkingConfig).toBeDefined();
    expect(googleCalls()[1].body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('with no Gemini key a Claude model answers at once, and the log says which was asked for', async () => {
    const callLLM = await load();
    const out = await callLLM('gemini-3.8-flash', 'S', [{ role: 'user', content: 'x' }], 500, { feature: 'houses-test', fallbackModel: 'claude-sonnet-5' });
    expect(out).toBe('claude answer');
    expect(googleCalls()).toHaveLength(0);
    expect(calls[0].body.model).toBe('claude-sonnet-5');
    expect(env.rows).toEqual([expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-5', requested_model: 'gemini-3.8-flash', input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20 })]);
  });

  it('out of credit (402): falls back to the named Claude, then stops asking Google for ten minutes', async () => {
    process.env.GEMINI_API_KEY = 'g-key';
    googleReply = { status: 402, body: { error: { message: 'Your prepayment credits are depleted' } } };
    const callLLM = await load();
    const opts = { feature: 'houses-test', fallbackModel: 'claude-sonnet-5', thinkingBudget: 4096 };
    expect(await callLLM('gemini-3.8-flash', 'S', [{ role: 'user', content: 'x' }], 8000, opts)).toBe('claude answer');
    expect(googleCalls()).toHaveLength(1);
    // The Gemini thinking allowance (4096) must not leak into the Claude request,
    // which keeps Sonnet 5's own automatic allowance.
    expect(calls.find((c) => c.url.includes('anthropic'))!.body.thinking).toEqual({ type: 'enabled', budget_tokens: 1536 });
    expect(await callLLM('gemini-3.8-flash', 'S', [{ role: 'user', content: 'y' }], 8000, opts)).toBe('claude answer');
    expect(googleCalls()).toHaveLength(1);
    expect(env.rows.map((r) => [r.provider, r.ok, r.requested_model])).toEqual([
      ['google', false, null], ['anthropic', true, 'gemini-3.8-flash'], ['anthropic', true, 'gemini-3.8-flash'],
    ]);
  });

  it('an empty Gemini answer is never handed back as a blank', async () => {
    process.env.GEMINI_API_KEY = 'g-key';
    googleReply = { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 0, thoughtsTokenCount: 900 } };
    const callLLM = await load();
    expect(await callLLM('gemini-3.8-flash', 'S', [{ role: 'user', content: 'x' }], 500, { fallbackModel: 'claude-sonnet-5' })).toBe('claude answer');
    expect(env.rows[0]).toMatchObject({ provider: 'google', ok: false, output_tokens: 900 });
  });

  it('does not fall back when the caller forbids it', async () => {
    process.env.GEMINI_API_KEY = 'g-key';
    googleStatus = 500; googleReply = { status: 500, body: {} };
    const callLLM = await load();
    expect(await callLLM('gemini-3.8-flash', 'S', [{ role: 'user', content: 'x' }], 500, { allowProviderFallback: false })).toBe('');
    expect(calls.filter((c) => c.url.includes('anthropic'))).toHaveLength(0);
  });
});

describe('every other provider writes to the cost log too', () => {
  it('Anthropic: cache reads are counted inside the input and as cached', async () => {
    const callLLM = await load();
    await callLLM('claude-sonnet-5', 'S', [{ role: 'user', content: 'x' }], 300, { feature: 'inbox-reply' });
    expect(env.rows[0]).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5', feature: 'inbox-reply', input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20 });
  });
  it('OpenAI: cached prompt tokens are reported', async () => {
    process.env.OPENAI_API_KEY = 'o-key';
    const callLLM = await load();
    expect(await callLLM('gpt-5.4-mini', 'S', [{ role: 'user', content: 'x' }], 300, { feature: 'reply-classifier' })).toBe('gpt answer');
    expect(env.rows[0]).toMatchObject({ provider: 'openai', model: 'gpt-5.4-mini', feature: 'reply-classifier', input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50 });
  });
  it('a call with no feature is still counted, as unlabelled', async () => {
    const callLLM = await load();
    await callLLM('claude-sonnet-5', 'S', [{ role: 'user', content: 'x' }]);
    expect(env.rows[0].feature).toBe('unlabelled');
  });
});
