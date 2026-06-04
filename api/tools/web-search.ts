import { webSearch } from '../../src/integrations/tavily/client.js';
import { authorizeToolCall } from '../lib/tool-auth.js';

export const config = { runtime: 'edge' };

/**
 * Mid-call tool: look something up on the web (via Tavily) while the voice call
 * is still live. Returns a short synthesised answer plus the top sources so the
 * agent can read the answer to the caller.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const rawBody = await req.json().catch(() => ({})) as Record<string, unknown>;
  const body = (rawBody.args ?? rawBody) as {
    business_id?: string;
    query?: string;
  };

  const auth = await authorizeToolCall(req, body);
  if (auth instanceof Response) return auth;

  const query = (body.query || '').trim();
  if (!query) {
    return new Response(JSON.stringify({
      error: 'query required',
      spoken: 'What would you like me to look up?',
    }), { status: 400 });
  }

  try {
    const { answer, results } = await webSearch(query, 3);
    const sources = results.map(r => ({ title: r.title, url: r.url, content: r.content.slice(0, 400) }));
    const spoken = answer
      || (sources.length ? sources.map(s => s.title).join('; ') : "I couldn't find anything on that.");
    return new Response(JSON.stringify({
      ok: true,
      answer: answer ?? null,
      sources,
      spoken,
    }), { status: 200 });
  } catch (err: any) {
    console.error('[tools/web-search] error:', err);
    return new Response(JSON.stringify({
      error: err.message,
      spoken: "Sorry, I couldn't look that up right now.",
    }), { status: 500 });
  }
}
