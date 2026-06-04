import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webSearch } from '../src/integrations/tavily/client';

describe('tavily webSearch', () => {
  beforeEach(() => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('throws when the key is missing', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(webSearch('hello')).rejects.toThrow('TAVILY_API_KEY is not set');
  });

  it('posts the query with include_answer and parses the response', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        answer: 'The Eiffel Tower is 330m tall.',
        results: [{ title: 'Eiffel Tower', url: 'https://x', content: 'It is 330 metres.' }],
      }),
      text: () => Promise.resolve(''),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await webSearch('how tall is the eiffel tower', 3);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    const sent = JSON.parse(init.body as string);
    expect(sent.api_key).toBe('tvly-test');
    expect(sent.query).toBe('how tall is the eiffel tower');
    expect(sent.include_answer).toBe(true);
    expect(sent.max_results).toBe(3);
    expect(out.answer).toContain('330m');
    expect(out.results).toHaveLength(1);
  });

  it('throws with status text on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 429,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('rate limited'),
    })));
    await expect(webSearch('x')).rejects.toThrow('Tavily search failed: 429 rate limited');
  });
});
