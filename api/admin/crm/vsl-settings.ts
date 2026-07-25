// Admin read/write for the VSL funnel config (platform_settings.vsl_automation)
// plus the AI-reply mode surface — the draft-mode bottleneck killed 15 hot
// replies in July; the settings UI shows it and can flip it to auto here.

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../lib/require-admin.js';
import { getVslSettings, saveVslSettings } from '../../lib/vsl-settings.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (gate instanceof Response) return gate;

  if (req.method === 'GET') {
    const [settings, aiReply, agents] = await Promise.all([
      getVslSettings(),
      supabase.from('wk_ai_reply_settings').select('mode, enabled').eq('id', 'default').maybeSingle(),
      supabase.from('profiles').select('id, name').in('workspace_role', ['agent', 'admin']).order('name'),
    ]);
    return Response.json({
      settings,
      ai_reply_mode: aiReply.data?.mode ?? 'draft',
      ai_reply_enabled: aiReply.data?.enabled ?? false,
      agents: agents.data ?? [],
    });
  }

  if (req.method === 'POST') {
    let body: { settings?: Record<string, unknown>; ai_reply_mode?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (body.ai_reply_mode === 'auto' || body.ai_reply_mode === 'draft') {
      await supabase
        .from('wk_ai_reply_settings')
        .update({ mode: body.ai_reply_mode })
        .eq('id', 'default');
    }

    const settings = body.settings
      ? await saveVslSettings(body.settings as never)
      : await getVslSettings();

    return Response.json({ ok: true, settings });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
