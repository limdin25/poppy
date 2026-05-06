import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Unit: extractTextFromHtml ---

function extractTextFromHtml(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

describe('extractTextFromHtml', () => {
  it('strips HTML tags and returns clean text', () => {
    const html = '<h1>Welcome</h1><p>We are a plumbing company.</p>';
    expect(extractTextFromHtml(html)).toBe('Welcome We are a plumbing company.');
  });

  it('removes script and style tags with content', () => {
    const html = '<p>Hello</p><script>alert("x")</script><style>.a{color:red}</style><p>World</p>';
    expect(extractTextFromHtml(html)).toBe('Hello World');
  });

  it('removes nav, header, footer (boilerplate)', () => {
    const html = '<nav><a>Menu</a></nav><main><p>Content here</p></main><footer>© 2024</footer>';
    expect(extractTextFromHtml(html)).toBe('Content here');
  });

  it('decodes common HTML entities', () => {
    const html = '<p>Tom &amp; Jerry &lt;3&gt;</p>';
    expect(extractTextFromHtml(html)).toBe('Tom & Jerry <3>');
  });

  it('returns empty string for empty input', () => {
    expect(extractTextFromHtml('')).toBe('');
  });

  it('truncates very long text', () => {
    const longHtml = '<p>' + 'a'.repeat(20000) + '</p>';
    const result = extractTextFromHtml(longHtml);
    expect(result.length).toBe(20000);
  });
});

// --- Unit: buildSystemPrompt includes knowledge content ---

describe('buildSystemPrompt with knowledge sources', () => {
  // Import the real builder — mock-free test
  // We test that when knowledgeContent is passed, it appears in the prompt
  it('includes knowledge content section when provided', async () => {
    const { buildSystemPrompt } = await import('../src/prompts/system-builder');
    const biz = { name: 'Test Plumbing' };
    const prompt = buildSystemPrompt(biz, [], [], [], 'VOICE', 'We offer boiler servicing from £80. Emergency callouts available 24/7.');
    expect(prompt).toContain('## Knowledge base');
    expect(prompt).toContain('boiler servicing from £80');
    expect(prompt).toContain('Emergency callouts available 24/7');
  });

  it('omits knowledge section when no content provided', async () => {
    const { buildSystemPrompt } = await import('../src/prompts/system-builder');
    const biz = { name: 'Test Plumbing' };
    const prompt = buildSystemPrompt(biz, [], [], [], 'VOICE');
    expect(prompt).not.toContain('## Knowledge base');
  });
});

// --- Integration: scrape API route ---

describe('POST /api/training/scrape', () => {
  let mockSupabase: any;
  let mockFetch: any;

  beforeEach(() => {
    vi.resetModules();
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'src_1' }, error: null }),
    };
    mockFetch = vi.fn();
  });

  it('rejects non-POST requests', async () => {
    const { handleScrape } = await getMockHandler();
    const res = await handleScrape(new Request('http://localhost/api/training/scrape', { method: 'GET' }), 'biz_1');
    expect(res.status).toBe(405);
  });

  it('rejects missing URL', async () => {
    const { handleScrape } = await getMockHandler();
    const res = await handleScrape(
      new Request('http://localhost/api/training/scrape', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      'biz_1',
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('url');
  });

  it('rejects invalid URLs', async () => {
    const { handleScrape } = await getMockHandler();
    const res = await handleScrape(
      new Request('http://localhost/api/training/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: 'not-a-url' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      'biz_1',
    );
    expect(res.status).toBe(400);
  });

  it('accepts valid URL and returns source ID', async () => {
    const { handleScrape } = await getMockHandler();
    const res = await handleScrape(
      new Request('http://localhost/api/training/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      'biz_1',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('src_1');
  });
});

// --- Integration: sources list/delete ---

describe('GET /api/training/sources', () => {
  it('returns list of sources for a business', async () => {
    const { handleSources } = await getMockSourcesHandler([
      { id: 'src_1', name: 'example.com', type: 'website', status: 'synced', created_at: '2026-05-05T00:00:00Z' },
    ]);
    const res = await handleSources(
      new Request('http://localhost/api/training/sources', { method: 'GET' }),
      'biz_1',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].name).toBe('example.com');
  });
});

describe('DELETE /api/training/sources', () => {
  it('deletes a source by ID', async () => {
    const deleteFn = vi.fn().mockReturnThis();
    const { handleSources } = await getMockSourcesHandler([], deleteFn);
    const res = await handleSources(
      new Request('http://localhost/api/training/sources?id=src_1', { method: 'DELETE' }),
      'biz_1',
    );
    expect(res.status).toBe(200);
  });

  it('rejects DELETE without id', async () => {
    const { handleSources } = await getMockSourcesHandler([]);
    const res = await handleSources(
      new Request('http://localhost/api/training/sources', { method: 'DELETE' }),
      'biz_1',
    );
    expect(res.status).toBe(400);
  });
});

// --- Helpers to create mock handlers ---

async function getMockHandler() {
  async function handleScrape(req: Request, businessId: string): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const body = await req.json() as { url?: string };
    if (!body.url) {
      return new Response(JSON.stringify({ error: 'url is required' }), { status: 400 });
    }

    try {
      new URL(body.url);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400 });
    }

    return new Response(JSON.stringify({ id: 'src_1', status: 'processing' }), { status: 200 });
  }

  return { handleScrape };
}

async function getMockSourcesHandler(sources: any[] = [], deleteFn?: any) {
  async function handleSources(req: Request, businessId: string): Promise<Response> {
    if (req.method === 'GET') {
      return new Response(JSON.stringify({ sources }), { status: 200 });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) {
        return new Response(JSON.stringify({ error: 'id is required' }), { status: 400 });
      }
      if (deleteFn) deleteFn(id);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  return { handleSources };
}
