// Create a demo site for a lead and text them the link.
//
// The agent-facing entry point: the "Send site" button in the dialer, and any
// service-key caller that already knows it wants a site. The automated
// "the lead said yes" path is api/site-demo/reply.ts, which classifies first
// and then calls the same generator.

import { createClient } from '@supabase/supabase-js';
import { generateSiteForContact } from '../lib/site-demo-generate.js';

export const config = { runtime: 'edge' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Service key (automation) or a real agent JWT (the button). */
export async function authoriseSiteDemo(req: Request): Promise<{ agentId: string | null } | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  if (
    token === process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (process.env.CRM_JOBS_KEY && token === process.env.CRM_JOBS_KEY)
  ) {
    return { agentId: null };
  }

  const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await caller.auth.getUser();
  if (!data?.user) return null;
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return null;
  return { agentId: data.user.id };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const who = await authoriseSiteDemo(req);
  if (!who) return json({ error: 'Unauthorized' }, 401);

  let body: { contact_id?: string; source?: string; send?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const contactId = String(body.contact_id || '');
  if (!contactId) return json({ error: 'contact_id required' }, 400);

  const result = await generateSiteForContact({
    contactId,
    fallbackAgentId: who.agentId,
    source: body.source || 'manual',
    send: body.send,
  });

  if (!result.ok) return json({ error: result.error }, result.status || 500);
  return json(result);
}
