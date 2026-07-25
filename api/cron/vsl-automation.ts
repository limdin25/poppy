// VSL automation engine — every 5 min (vercel.json). Walks the funnel states
// and enqueues wk_jobs `send_sms` nudges per the admin-configured rules
// (platform_settings.vsl_automation). Delivery, retries, kill-switches and
// reply-cancel all ride the existing wk-jobs-worker path — this cron only
// decides WHO gets WHICH message WHEN.
//
// Node (req,res) runtime on purpose — the edge Request shape throws at runtime
// here (caught in production on daily-agent-reports, 2026-07-24).

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import {
  getVslSettings,
  fillTemplate,
  insideQuietHours,
  type VslSettings,
  type VslRule,
} from '../lib/vsl-settings.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { maxDuration: 60 };

// Which page-state each rule fires on, and which timestamp starts its clock.
const RULE_STATE: Record<keyof VslSettings['rules'], { state: string; since: string }> = {
  sent_not_opened: { state: 'sent', since: 'sent_at' },
  opened_not_watched: { state: 'opened', since: 'first_opened_at' },
  watched_no_click: { state: 'watched', since: 'watched_at' },
  checkout_abandoned: { state: 'checkout_started', since: 'checkout_started_at' },
  paid_welcome: { state: 'paid', since: 'paid_at' },
};

/** The owning agent's SMS line (wk_number_agents → wk_numbers, GB preferred).
 *  Falls back to the workspace's first GB-preferred sms-enabled line so a lead
 *  never silently goes un-nudged just because their agent has no assigned
 *  number (mirrors wk-sms-send's workspace-default fallback). */
async function agentLine(agentId: string): Promise<string | null> {
  const { data } = await supabase
    .from('wk_number_agents')
    .select('is_primary, wk_numbers ( e164, channel, sms_enabled, is_active )')
    .eq('agent_id', agentId);
  const rows = (data || [])
    .map((r: any) => ({ primary: r.is_primary, n: r.wk_numbers }))
    .filter((r) => r.n && r.n.channel === 'sms' && r.n.sms_enabled && r.n.is_active);
  if (rows.length) {
    rows.sort((a, b) => {
      const gb = Number((b.n.e164 || '').startsWith('+44')) - Number((a.n.e164 || '').startsWith('+44'));
      if (gb) return gb;
      return Number(b.primary) - Number(a.primary);
    });
    return rows[0].n.e164;
  }
  const { data: fallback } = await supabase
    .from('wk_numbers')
    .select('e164')
    .eq('channel', 'sms')
    .eq('sms_enabled', true)
    .eq('is_active', true)
    .order('e164', { ascending: false }); // +44 sorts before +1
  return fallback?.[0]?.e164 ?? null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const settings = await getVslSettings();
  const result: Record<string, number> = {};

  if (!settings.enabled) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, disabled: true }));
    return;
  }
  if (!insideQuietHours(settings)) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, quiet: true }));
    return;
  }

  const now = Date.now();

  for (const key of Object.keys(RULE_STATE) as (keyof VslSettings['rules'])[]) {
    const rule: VslRule = settings.rules[key];
    if (!rule?.enabled) continue;
    const { state, since } = RULE_STATE[key];

    // Deterministic oldest-first ordering so pages beyond the batch cap aren't
    // starved run after run.
    const { data: pages } = await supabase
      .from('wk_vsl_pages')
      .select('*')
      .eq('state', state)
      .order('updated_at', { ascending: true })
      .limit(200);

    let fired = 0;
    for (const page of pages || []) {
      if (settings.agent_disabled.includes(page.agent_id)) continue;

      const auto = (page.automation || {}) as Record<string, { count?: number; last_at?: string }>;
      const mine = auto[key] || {};
      const count = mine.count || 0;
      if (count >= rule.max_sends) continue;

      // Clock: state entry for the first nudge, previous nudge for repeats.
      const anchor = count === 0 ? page[since] : mine.last_at;
      if (!anchor) continue;
      const waitMs = count === 0 ? rule.delay_minutes * 60_000 : rule.repeat_hours * 3_600_000;
      if (now - new Date(anchor).getTime() < waitMs) continue;

      const url = `https://heyelsie.com/${page.slug}`;
      const body = fillTemplate(rule.template, {
        first: page.owner_first,
        business: page.business_name,
        url,
        agent: null,
      });

      // Record the nudge BEFORE enqueuing: if we crash between the two, a lost
      // job (one missed nudge) is far cheaper than a double-text.
      auto[key] = { count: count + 1, last_at: new Date().toISOString() };
      const { error: bookErr } = await supabase
        .from('wk_vsl_pages').update({ automation: auto }).eq('id', page.id);
      if (bookErr) continue;

      const from = await agentLine(page.agent_id);
      await supabase.from('wk_jobs').insert({
        kind: 'send_sms',
        status: 'pending',
        scheduled_for: new Date().toISOString(),
        payload: {
          contact_id: page.contact_id,
          agent_id: page.agent_id,
          body,
          ...(from ? { from_e164: from } : {}),
          // A lead who texted back since queuing shouldn't get nagged.
          skip_if_inbound_after: new Date().toISOString(),
          source: `vsl:${key}`,
        },
      });
      await supabase.from('wk_vsl_events').insert({
        page_id: page.id,
        type: 'auto_sms',
        meta: { rule: key, nudge: count + 1 },
      });
      fired++;
    }
    result[key] = fired;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, fired: result }));
}
