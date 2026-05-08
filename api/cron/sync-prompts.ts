import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const toolSecret = process.env.TOOL_SECRET || '';
  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';

  try {
    const { data: agents } = await supabase
      .from('agents')
      .select('id, business_id')
      .eq('type', 'voice');

    if (!agents || agents.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0 }), { status: 200 });
    }

    let synced = 0;
    let failed = 0;

    for (const agent of agents) {
      try {
        const res = await fetch(`${appUrl}/api/agent/sync-prompt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tool-secret': toolSecret,
          },
          body: JSON.stringify({ businessId: agent.business_id, agentId: agent.id }),
        });
        if (res.ok) synced++;
        else failed++;
      } catch {
        failed++;
      }
    }

    return new Response(JSON.stringify({ ok: true, synced, failed }), { status: 200 });
  } catch (err: any) {
    console.error('[sync-prompts] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
