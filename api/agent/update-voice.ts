import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RETELL_API_KEY = process.env.RETELL_API_KEY!;

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  try {
    const { voiceId } = await req.json() as { voiceId?: string };

    if (!voiceId) {
      return new Response(JSON.stringify({ error: 'voiceId is required' }), { status: 400 });
    }

    const { data: channel } = await supabase
      .from('channels')
      .select('config')
      .eq('business_id', businessId)
      .eq('type', 'voice')
      .single();

    if (!channel?.config) {
      return new Response(JSON.stringify({ error: 'No voice channel configured' }), { status: 404 });
    }

    const config = channel.config as Record<string, string>;
    const agentId = config.retell_agent_id;
    if (!agentId) {
      return new Response(JSON.stringify({ error: 'No Retell agent ID found' }), { status: 404 });
    }

    const res = await fetch(`https://api.retellai.com/update-agent/${agentId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ voice_id: voiceId }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: `Retell update failed: ${err}` }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
