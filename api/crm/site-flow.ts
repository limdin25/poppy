// Data and settings for the website sales flow canvas.
//
// EVERY WRITE GOES THROUGH HERE. wk_site_pages and wk_site_events have no
// client write policy on purpose, and the ladder config drives a cron that
// texts and rings real businesses, so it is not something a browser gets to
// PATCH directly.
//
// GET  -> live counts + the current ladder config + the copy the panels edit
// POST -> save the ladder config (admins only)

import { createClient } from '@supabase/supabase-js';
import { resolveLadderConfig, type LadderConfig } from '../../src/core/site-demo/ladder.js';
import { getLadderConfig, saveLadderConfig, getSiteDemoSettings } from '../lib/site-demo.js';

export const config = { runtime: 'edge' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function caller(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await client.auth.getUser();
  if (!data?.user) return null;
  const { data: staff } = await client.rpc('wk_is_agent_or_admin');
  if (!staff) return null;
  const { data: admin } = await client.rpc('wk_is_admin');
  return { client, userId: data.user.id, isAdmin: Boolean(admin) };
}

export default async function handler(req: Request): Promise<Response> {
  const who = await caller(req);
  if (!who) return json({ error: 'Unauthorized' }, 401);

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const agent = url.searchParams.get('agent');

    // Called with the CALLER'S client, not the service role. The RPC is
    // SECURITY DEFINER and does its own staff gate, so it must see the real
    // auth.uid() to clip an agent to their own leads.
    const { data: counts, error } = await who.client.rpc('wk_site_funnel_summary', {
      p_from: from || null,
      p_to: to || null,
      p_agent: agent || null,
    });
    // DEGRADE, DO NOT 500. The counts are the least important thing on this
    // page: the controls that change what the cron does to real businesses
    // matter more. Before the migration is applied this RPC does not exist at
    // all, and a 500 here would leave an admin looking at a canvas with no
    // working controls and no explanation.
    if (error) console.error('[site-flow] summary unavailable:', error.message);

    const [ladder, settings] = await Promise.all([getLadderConfig(), getSiteDemoSettings()]);
    return json({
      counts: counts || [],
      counts_error: error ? 'The live counts are not available yet.' : undefined,
      ladder,
      settings: {
        enabled: settings.enabled,
        quiet_hours: settings.quiet_hours,
        chat_enabled: settings.chat_enabled,
        checkout_enabled: settings.checkout_enabled,
      },
      is_admin: who.isAdmin,
    });
  }

  if (req.method === 'POST') {
    // Agents can look at the flow. Changing what it does to real businesses is
    // an admin action.
    if (!who.isAdmin) return json({ error: 'Admins only' }, 403);

    let body: { ladder?: Partial<LadderConfig> };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Bad JSON' }, 400);
    }
    if (!body.ladder) return json({ error: 'ladder required' }, 400);

    // Resolved before saving, so a stray string or a negative number cannot
    // reach the cron and stall the funnel.
    const saved = await saveLadderConfig(resolveLadderConfig(body.ladder));
    return json({ ok: true, ladder: saved });
  }

  return json({ error: 'Method not allowed' }, 405);
}
