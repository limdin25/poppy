// The video messages, for the Templates page.
//
// Hugo 2026-07-27: "when I go to templates, I don't see the templates for
// sending the video. It should be there as well."
//
// He was right, and it wasn't an oversight in the page — the video messages
// live in platform_settings.vsl_automation, not in wk_sms_templates, so the
// Templates list was structurally incapable of showing them. An agent reading
// that page was reading an incomplete account of what this CRM sends in their
// name.
//
// GET  — any CRM agent or admin. They send these; they get to read them.
// POST — admins only. Same deep-merge save the funnel's settings drawer uses,
//        so a partial patch here can't wipe the notify toggles it doesn't know
//        about.

import { createClient } from '@supabase/supabase-js';
import { requireAdminAny } from '../lib/require-admin.js';
import { getVslSettings, saveVslSettings, type VslSettings } from '../lib/vsl-settings.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Only the message-shaped fields. The funnel drawer owns the rest. */
function templatesOf(s: VslSettings) {
  return {
    send_template: s.send_template,
    send_template_no_site: s.send_template_no_site,
    rules: Object.fromEntries(
      Object.entries(s.rules).map(([k, r]) => [k, {
        enabled: r.enabled,
        template: r.template,
        delay_minutes: r.delay_minutes,
        max_sends: r.max_sends,
        repeat_hours: r.repeat_hours,
      }]),
    ),
  };
}

export default async function handler(req: Request): Promise<Response> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (req.method === 'GET') {
    // Staff gate through the caller's own JWT so RLS decides, not this file.
    const caller = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
    if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

    const settings = await getVslSettings();
    return Response.json({ templates: templatesOf(settings), enabled: settings.enabled });
  }

  if (req.method === 'POST') {
    const gate = await requireAdminAny(req);
    if (gate instanceof Response) return gate;

    let body: { templates?: Partial<VslSettings> };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body.templates) return Response.json({ error: 'templates required' }, { status: 400 });

    const settings = await saveVslSettings(body.templates);
    return Response.json({ ok: true, templates: templatesOf(settings) });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
}
