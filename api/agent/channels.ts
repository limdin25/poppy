import { requireAuth } from '../lib/auth.js';
import { ensureChannelAgents } from '../lib/agent-channels.js';

export const config = { runtime: 'edge' };

/** Ensure the business has one agent per channel and return them keyed by channel. */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const agents = await ensureChannelAgents(auth.businessId);
    return new Response(JSON.stringify({ ok: true, agents }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
