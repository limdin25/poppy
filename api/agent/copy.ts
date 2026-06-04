import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { copyAgentSettings } from '../lib/agent-channels.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/** Copy ALL settings from one channel's agent into another (same business). */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { fromAgentId, toAgentId } = await req.json() as { fromAgentId?: string; toAgentId?: string };
    if (!fromAgentId || !toAgentId || fromAgentId === toAgentId) {
      return new Response(JSON.stringify({ error: 'fromAgentId and toAgentId (different) required' }), { status: 400 });
    }

    // Both agents must belong to the caller's business.
    const { data: rows } = await supabase
      .from('agents')
      .select('id, agent_type, retell_agent_id')
      .eq('business_id', auth.businessId)
      .in('id', [fromAgentId, toAgentId]);
    if (!rows || rows.length !== 2) {
      return new Response(JSON.stringify({ error: 'Agents not found for this business' }), { status: 404 });
    }

    await copyAgentSettings(auth.businessId, fromAgentId, toAgentId);

    // If the target is the voice agent, push the copied prompt/settings to Retell.
    const target = rows.find((r) => r.id === toAgentId);
    if (target?.agent_type === 'voice' && target.retell_agent_id) {
      const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
      const toolSecret = process.env.TOOL_SECRET || '';
      await fetch(`${appUrl}/api/agent/sync-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tool-secret': toolSecret },
        body: JSON.stringify({ businessId: auth.businessId, agentId: toAgentId }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
