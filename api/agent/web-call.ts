import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_API_KEY = process.env.RETELL_API_KEY!;

export const config = { runtime: 'edge' };

/**
 * Starts a Retell WEB call so the owner can test their agent from the browser
 * (mic + speakers) without a phone number. Returns an access_token the Retell
 * Web SDK uses to connect. Scoped to a specific agent (a phone number's voice
 * agent); falls back to the business's default voice agent.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  try {
    const { agentId } = await req.json() as { agentId?: string };

    let retellAgentId: string | null = null;
    if (agentId) {
      const { data } = await supabase
        .from('agents')
        .select('retell_agent_id')
        .eq('id', agentId)
        .eq('business_id', businessId)
        .single();
      retellAgentId = (data?.retell_agent_id as string) || null;
    }
    if (!retellAgentId) {
      const { data } = await supabase
        .from('agents')
        .select('retell_agent_id, is_default')
        .eq('business_id', businessId)
        .eq('agent_type', 'voice')
        .not('retell_agent_id', 'is', null)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle();
      retellAgentId = (data?.retell_agent_id as string) || null;
    }
    if (!retellAgentId) {
      return new Response(JSON.stringify({ error: 'No voice agent set up for this business yet.' }), { status: 400 });
    }

    const res = await fetch('https://api.retellai.com/v2/create-web-call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: retellAgentId }),
    });
    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `Could not start test call: ${err}` }), { status: 500 });
    }
    const data = await res.json() as { access_token?: string; call_id?: string };
    return new Response(JSON.stringify({ access_token: data.access_token, call_id: data.call_id }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
