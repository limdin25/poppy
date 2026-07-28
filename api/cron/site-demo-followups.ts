// The escalation ladder, walked once a minute.
//
// Every minute rather than every five, because the highest value trigger in
// the whole funnel is "they opened it ten minutes ago and are still looking".
// A five minute cron would blur that into uselessness.
//
// Node runtime on purpose: the edge Request shape threw in production on
// daily-agent-reports (2026-07-24), and this job has no reason to be on edge.
//
// WHAT THIS JOB IS NOT. It does not decide the schedule. nextLadderStep() in
// src/core/site-demo/ladder.ts does, and it is pure, so the cron, the tests and
// the flow canvas cannot disagree about what happens when.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  nextLadderStep,
  type LadderConfig,
  type LadderPage,
} from '../../src/core/site-demo/ladder.js';
import { formatUkPhone } from '../../src/core/site-demo/fill.js';
import {
  DEMO_LINE_E164,
  advanceSiteState,
  getSiteDemoSettings,
  getLadderConfig,
  logSiteEvent,
  siteDemoDb as supabase,
  siteUrl,
} from '../lib/site-demo.js';

export const config = { maxDuration: 60 };

const BATCH = 200;

/** London wall-clock HH:MM, so quiet hours mean what a person means by them. */
function londonTime(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

function insideQuietHours(now: Date, start: string, end: string): boolean {
  const t = londonTime(now);
  return t < start || t >= end;
}

interface Row extends LadderPage {
  id: string;
  slug: string;
  contact_id: string;
  agent_id: string;
  business_name: string;
  owner_first: string | null;
  trade_label: string | null;
  town: string | null;
  updated_at: string;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  const rawAuth = req.headers['authorization'];
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return send(401, { error: 'Unauthorized' });

  const now = new Date();
  const settings = await getSiteDemoSettings();

  // GUARD ORDER, and it matters. Cheapest and most total first: if the master
  // switch is off nothing else is worth a query, and quiet hours apply to the
  // whole run rather than per lead.
  if (!settings.enabled) return send(200, { ok: true, skipped: 'disabled' });
  if (insideQuietHours(now, settings.quiet_hours.start, settings.quiet_hours.end)) {
    return send(200, { ok: true, skipped: 'quiet_hours' });
  }

  const ladderConfig: LadderConfig = await getLadderConfig();

  // Read by sent_at, not by state. State is forward-only and collapses, so a
  // page that has moved on still needs to be considered for the stages it has
  // not done. Oldest first, so anything past the batch cap is first next run.
  const { data, error } = await supabase
    .from('wk_site_pages')
    .select(
      'id, slug, contact_id, agent_id, business_name, owner_first, trade_label, town, state, ' +
        'sent_at, first_opened_at, first_engaged_at, checkout_sent_at, last_call_at, ' +
        'outbound_call_attempts, chat_count, call_count, automation, updated_at',
    )
    .not('sent_at', 'is', null)
    .in('state', ['sent', 'opened'])
    .order('updated_at', { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error('[site-demo-followups] page query failed:', error.message);
    return send(500, { error: 'query_failed' });
  }
  const rows = (data || []) as unknown as Row[];
  if (!rows.length) return send(200, { ok: true, considered: 0 });

  const contactIds = Array.from(new Set(rows.map((r) => r.contact_id)));

  // ---- Context lookups. All FAIL CLOSED: a failure here 500s the run rather
  // than texting somebody we should not have. A late nudge is free, a nudge to
  // someone who opted out is not.

  // Chunked because 200 uuids in a single in.() overruns the URL length limit.
  const chunk = <T,>(xs: T[], n: number) =>
    Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

  const optedOut = new Set<string>();
  const doNotCall = new Set<string>();
  const lastInbound = new Map<string, string>();

  for (const ids of chunk(contactIds, 50)) {
    const [tags, contacts, inbound] = await Promise.all([
      supabase.from('wk_contact_tags').select('contact_id, tag').in('contact_id', ids).eq('tag', 'do-not-text'),
      supabase.from('wk_contacts').select('id, do_not_call').in('id', ids),
      supabase
        .from('wk_sms_messages')
        .select('contact_id, created_at')
        .in('contact_id', ids)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false }),
    ]);
    if (tags.error || contacts.error || inbound.error) {
      console.error('[site-demo-followups] context lookup failed, standing down');
      return send(500, { error: 'context_failed' });
    }
    for (const t of tags.data || []) optedOut.add((t as { contact_id: string }).contact_id);
    for (const c of contacts.data || []) {
      const row = c as { id: string; do_not_call?: boolean };
      if (row.do_not_call) doNotCall.add(row.id);
    }
    for (const m of inbound.data || []) {
      const row = m as { contact_id: string; created_at: string };
      if (!lastInbound.has(row.contact_id)) lastInbound.set(row.contact_id, row.created_at);
    }
  }

  // The outbound kill switch. One call for the whole run: if sending is off,
  // nothing below should happen at all.
  const { data: allowed } = await supabase.rpc('wk_outbound_sms_allowed');
  const gate = (allowed || {}) as { allowed?: boolean; reason?: string };
  if (gate.allowed === false && gate.reason === 'killswitch') {
    return send(200, { ok: true, skipped: 'killswitch' });
  }
  const smsAllowed = gate.allowed !== false;

  let sent = 0;
  let called = 0;
  let skipped = 0;

  for (const page of rows) {
    if (sent + called >= settings.max_per_run) break;
    if (optedOut.has(page.contact_id)) {
      skipped++;
      continue;
    }

    const action = nextLadderStep(page, {
      now,
      ownerFirst: page.owner_first,
      businessName: page.business_name,
      url: siteUrl(page.slug),
      demoNumber: formatUkPhone(DEMO_LINE_E164),
      lastInboundAt: lastInbound.get(page.contact_id) || null,
      config: ladderConfig,
    });
    if (action.kind === 'none') {
      skipped++;
      continue;
    }

    // Voice suppression is separate from SMS suppression and only applies to
    // the call. A lead can be do_not_call without being do-not-text.
    if (action.kind === 'call' && doNotCall.has(page.contact_id)) {
      skipped++;
      continue;
    }
    if (action.kind === 'sms' && !smsAllowed) {
      skipped++;
      continue;
    }

    // CLAIM BEFORE ACTING. Vercel cron delivery is at-least-once, so two runs
    // can overlap. Writing the stage first, conditional on updated_at, means
    // the loser matches zero rows and stands down. A lost nudge is cheaper
    // than a double text to a real business.
    const automation = { ...(page.automation || {}), [action.stage]: { count: 1, last_at: now.toISOString() } };
    const { data: claimed } = await supabase
      .from('wk_site_pages')
      .update({ automation })
      .eq('id', page.id)
      .eq('updated_at', page.updated_at)
      .select('id');
    if (!claimed?.length) {
      skipped++;
      continue;
    }

    if (action.kind === 'sms') {
      // Through the CRM job path, never the Twilio API directly: the worker
      // owns normalisation, the kill switch and the wk_sms_messages row that
      // puts this in the lead's thread.
      const { error: jobErr } = await supabase.from('wk_jobs').insert({
        kind: 'send_sms',
        status: 'pending',
        payload: {
          contact_id: page.contact_id,
          agent_id: page.agent_id,
          body: action.body,
          source: `site_demo:${action.stage}`,
        },
      });
      if (jobErr) {
        console.error('[site-demo-followups] enqueue failed:', jobErr.message);
        continue;
      }
      await logSiteEvent(page.id, 'followup_sent', { stage: action.stage });
      await advanceSiteState(page, null, { nudge: true });
      sent++;
    } else {
      const ok = await placeOutboundCall(page, action.attempt);
      await logSiteEvent(page.id, 'outbound_call', { stage: action.stage, attempt: action.attempt, ok });
      if (ok) {
        await advanceSiteState(page, null, { outbound_call: true });
        called++;
      }
    }
  }

  return send(200, { ok: true, considered: rows.length, sent, called, skipped });
}

/**
 * Elsie rings the lead from the same demo line they would have called.
 *
 * The dynamic variables are the same shape retell-inbound.ts builds for an
 * inbound call, supplied at creation time instead of read from a webhook. The
 * opener owns that this is a follow-up rather than pretending to be inbound.
 */
async function placeOutboundCall(page: Row, attempt: number): Promise<boolean> {
  const apiKey = process.env.RETELL_API_KEY;
  const agentId = process.env.SITE_DEMO_AGENT_ID;
  if (!apiKey || !agentId) {
    console.error('[site-demo-followups] outbound call not configured');
    return false;
  }

  const { data: contact } = await supabase
    .from('wk_contacts')
    .select('phone')
    .eq('id', page.contact_id)
    .maybeSingle();
  if (!contact?.phone) return false;

  try {
    const res = await fetch('https://api.retellai.com/v2/create-phone-call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_number: DEMO_LINE_E164,
        to_number: contact.phone,
        override_agent_id: agentId,
        ring_duration_ms: 45000,
        metadata: { type: 'site_demo', page_id: page.id, contact_id: page.contact_id, attempt },
        retell_llm_dynamic_variables: {
          site_demo_match: 'yes',
          outbound: 'yes',
          business_name: String(page.business_name || ''),
          owner_first: String(page.owner_first || ''),
          trade: String(page.trade_label || ''),
          town: String(page.town || ''),
        },
      }),
    });
    if (!res.ok) {
      console.error('[site-demo-followups] create-phone-call failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[site-demo-followups] create-phone-call threw:', e);
    return false;
  }
}
