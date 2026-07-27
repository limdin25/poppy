// VSL automation engine, every 5 min (vercel.json). Decides WHO gets WHICH
// follow-up WHEN and enqueues a wk_jobs `send_sms`. Delivery, retries and
// kill-switches all ride the existing wk-jobs-worker path.
//
// The schedule itself is NOT here. Every delay, every condition, the
// deepest-first collision order and the caps live in api/lib/vsl-sequence.ts,
// which has no supabase import, so the funnel drawer can show a lead exactly
// what this cron is about to do, from the same function that does it. This file
// is the part that talks to the database: load, ask, book, enqueue.
//
// Node (req,res) runtime on purpose. The edge Request shape throws at runtime
// here (caught in production on daily-agent-reports, 2026-07-24).

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import {
  getVslSettings,
  fillTemplate,
  insideQuietHours,
  agentSmsLine,
} from '../lib/vsl-settings.js';
import { nextSequenceStep, SEQUENCE_EPOCH, type SequencePage } from '../lib/vsl-sequence.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { maxDuration: 60 };

/** Pages examined per run. Oldest-first ordering means anything past the cap is
 *  first in line next time rather than starved. */
const BATCH = 200;

type PageRow = SequencePage & {
  id: string;
  slug: string;
  contact_id: string;
  agent_id: string;
  business_name: string;
  owner_first: string | null;
  automation: Record<string, { count?: number; last_at?: string }> | null;
  updated_at: string;
};

/**
 * The last time each of these leads texted US.
 *
 * One query for the whole batch, not one per page: a reply is a permanent stop,
 * so it has to be checked for every candidate, and 200 round trips would not fit
 * in the run. Scoped to messages newer than the oldest send in the batch because
 * anything older cannot be a reply to a video that had not gone out yet.
 */
async function lastInboundByContact(
  contactIds: string[],
  since: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // 200 uuids in an `in.()` filter is a 7kB request line, which is where proxies
  // start returning 414. Chunked rather than trusted.
  for (let i = 0; i < contactIds.length; i += 50) {
    const chunk = contactIds.slice(i, i + 50);
    const { data, error } = await supabase
      .from('wk_sms_messages')
      .select('contact_id, created_at')
      .eq('direction', 'inbound')
      .in('contact_id', chunk)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (error) {
      // Fail CLOSED: if we cannot tell who replied, nobody gets nagged this run.
      console.error('[vsl-automation] inbound lookup failed:', error);
      throw error;
    }
    for (const row of data || []) {
      if (!out.has(row.contact_id)) out.set(row.contact_id, row.created_at);
    }
  }
  return out;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const settings = await getVslSettings();

  if (!settings.enabled) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, disabled: true }));
    return;
  }
  const now = new Date();
  if (!insideQuietHours(settings, now)) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, quiet: true }));
    return;
  }

  // Anything that has actually been sent. Keyed on sent_at rather than on
  // `state` because state is forward-only and collapses: a paid page is not "in"
  // sent, but it still needs the welcome.
  const { data: pages, error: readErr } = await supabase
    .from('wk_vsl_pages')
    .select('id, slug, contact_id, agent_id, business_name, owner_first, automation, updated_at, sent_at, first_opened_at, play_at, watched_at, completed_at, cta_clicked_at, checkout_started_at, paid_at, watched_pct, calc_at')
    .gte('sent_at', SEQUENCE_EPOCH)
    .not('sent_at', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(BATCH);
  if (readErr) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'read failed' }));
    return;
  }

  const rows = (pages || []) as PageRow[];
  const oldestSend = rows
    .map((p) => p.sent_at!)
    .sort()[0] || new Date(0).toISOString();

  // A lead closed on the phone pays through wk_contacts.business_id, not through
  // the button on their own page, so paid_at stays null and the sales sequence
  // would keep texting them about a trial they have already bought.
  const paidElsewhere = new Set<string>();
  {
    const ids = rows.map((p) => p.contact_id);
    if (ids.length) {
      const { data, error } = await supabase
        .from('wk_contacts')
        .select('id, business_id')
        .in('id', ids)
        .not('business_id', 'is', null);
      if (error) {
        // Fail CLOSED: if we cannot tell who has paid, nobody gets a sales text.
        console.error('[vsl-automation] paid lookup failed:', error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'paid lookup failed' }));
        return;
      }
      for (const r of data || []) paidElsewhere.add(r.id);
    }
  }

  // Newest real activity per page. wk_vsl_events carries one row per beacon, so
  // it is the only place a SECOND open or a calculator touch is visible; the
  // page's own stamps are all coalesce()'d first-touches. Our own auto_sms rows
  // are excluded on purpose: "no engagement for 7 days" is about the lead, not
  // about us.
  const lastEvent = new Map<string, string>();
  {
    const pageIds = rows.map((p) => p.id);
    if (pageIds.length) {
      const { data, error } = await supabase
        .from('wk_vsl_events')
        .select('page_id, created_at, type')
        .in('page_id', pageIds)
        .neq('type', 'auto_sms')
        .order('created_at', { ascending: false });
      if (error) {
        // Fail CLOSED rather than mistake a busy lead for a dead one.
        console.error('[vsl-automation] event lookup failed:', error);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'event lookup failed' }));
        return;
      }
      for (const r of data || []) {
        if (!lastEvent.has(r.page_id)) lastEvent.set(r.page_id, r.created_at);
      }
    }
  }

  let inbound: Map<string, string>;
  try {
    inbound = await lastInboundByContact(rows.map((p) => p.contact_id), oldestSend);
  } catch {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'inbound lookup failed' }));
    return;
  }

  const fired: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  for (const page of rows) {
    const verdict = nextSequenceStep({
      ...page,
      // Repeat visits: every *_at column is first-touch only, so without this a
      // lead who reopens their page daily still reads as silent and gets the
      // goodbye message an hour after their latest visit.
      last_event_at: lastEvent.get(page.id) ?? null,
    }, {
      rules: settings.rules,
      now,
      paidElsewhere: paidElsewhere.has(page.contact_id),
      lastInboundAt: inbound.get(page.contact_id) ?? null,
      agentDisabled: settings.agent_disabled.includes(page.agent_id),
      // enabled + quiet hours are already decided above for the whole run.
    });

    if (!verdict.due) {
      skipped[verdict.reason] = (skipped[verdict.reason] || 0) + 1;
      continue;
    }
    const step = verdict.due;

    const url = `https://heyelsie.com/${page.slug}`;
    const body = fillTemplate(step.template, {
      first: page.owner_first,
      business: page.business_name,
      url,
      agent: null,
    });

    // Record the send BEFORE enqueuing: if we crash between the two, a lost job
    // (one missed follow-up) is far cheaper than a double text.
    //
    // The `.eq('updated_at', ...)` is the whole safety property, not decoration.
    // Vercel cron delivery is at-least-once and this loop does several round
    // trips per firing page, so two runs CAN overlap. A plain read-modify-write
    // lets both read an empty book, both pick the same rule, and both enqueue:
    // the same text twice to a real lead. Filtering on the updated_at we read
    // means the second writer matches zero rows and stands down. A trigger bumps
    // updated_at on every write, so it is a true optimistic lock. Same intent as
    // the claim in api/cron/vsl-auto-send.ts.
    const auto = (page.automation || {}) as Record<string, { count?: number; last_at?: string }>;
    auto[step.key] = { count: step.nudge, last_at: now.toISOString() };
    const { data: booked, error: bookErr } = await supabase
      .from('wk_vsl_pages')
      .update({ automation: auto })
      .eq('id', page.id)
      .eq('updated_at', page.updated_at)
      .select('id')
      .maybeSingle();
    if (bookErr || !booked) {
      skipped.raced = (skipped.raced || 0) + 1;
      continue;
    }

    const from = await agentSmsLine(page.agent_id);
    await supabase.from('wk_jobs').insert({
      kind: 'send_sms',
      status: 'pending',
      scheduled_for: now.toISOString(),
      payload: {
        contact_id: page.contact_id,
        agent_id: page.agent_id,
        body,
        ...(from ? { from_e164: from } : {}),
        // Belt and braces for the gap between queuing and sending. The real
        // reply-stop is the wk_sms_messages check above, which runs on every
        // page every pass and is permanent.
        skip_if_inbound_after: now.toISOString(),
        source: `vsl:${step.key}`,
      },
    });
    await supabase.from('wk_vsl_events').insert({
      page_id: page.id,
      type: 'auto_sms',
      meta: { rule: step.key, nudge: step.nudge },
    });
    fired[step.key] = (fired[step.key] || 0) + 1;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, considered: rows.length, fired, skipped }));
}
