// Morning leads for Pedro (Hugo, 2026-10-14).
//
// Runs every 15 minutes from 05:45 to 10:00 London, Monday to Saturday, and
// once more when the VPS SpareRoom import finishes. Each pass:
//   1. counts Pedro's callable leads that have a ready report,
//   2. if under the target, deals eligible listings not yet on his queue
//      (wk_hostunico_morning_deal: strict phone rule, every row starts held),
//   3. prepares the report for every queued lead missing one, and refreshes
//      the ones still being researched. A held lead is released by the
//      database only when its report qualifies, so Pedro never gets a lead
//      without a ready report,
//   4. writes the day's summary row in hostunico_morning_runs.
// Idempotent and capped by the settings in platform_settings
// 'hostunico_morning_leads'. NOTHING here calls, texts or emails anybody.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HOSTUNICO_CAMPAIGN, reportProperty } from '../lib/hostunico-report.js';
import { hostunicoCountry } from '../../supabase/functions/_shared/hostunico-pricing.js';
import { inBatches, listingUnfurnished, londonClock, morningLevel, morningSettings, morningWindowOpen, pickReportListing } from '../lib/hostunico-morning.js';

export const config = { maxDuration: 300 };

type Listing = { id: string; wk_contact_id: string; hostunico_uplift_status: string | null; report_property: unknown; photo_urls: string[] | null; address: string | null; listing_url: string | null; property_type: string | null; rent_pcm: number | null; source_price: string | null; hostunico_call_eligible: boolean; summary: string | null };
type Report = { listing_id: string; remote_id: string; access_token: string; state: string | null; report_url: string | null; property: unknown; report_pitch: { planning?: boolean } | null };

const send = (res: ServerResponse, status: number, body: unknown) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };

async function remote(action: 'start', payload: Record<string, unknown>) {
  const token = process.env.HOSTUNICO_CRM_TOKEN;
  if (!token) throw new Error('report connection not configured');
  const r = await fetch(`https://hostunico.com/api/hostunico/crm-estimates/${action}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(25000),
  });
  const value = await r.json().catch(() => ({})) as { stage?: string; message?: string; reportUrl?: string; reportPitch?: unknown };
  if (!r.ok || !value.stage) throw new Error(`report ${action} HTTP ${r.status}`);
  return value;
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export async function morningPass(db: SupabaseClient, now = new Date(), deadline = Date.now() + 240000) {
  const settingsRow = await db.from('platform_settings').select('value').eq('key', 'hostunico_morning_leads').maybeSingle();
  const settings = morningSettings(settingsRow.data?.value);
  if (!settings.enabled) return { skipped: 'disabled' };
  const day = londonClock(now).date;
  await db.from('hostunico_morning_runs').upsert({ run_date: day }, { onConflict: 'run_date', ignoreDuplicates: true });
  const { data: run, error: runError } = await db.from('hostunico_morning_runs').select('*').eq('run_date', day).single();
  if (runError || !run) throw new Error('summary row unavailable');
  const counts = async () => {
    const { data, error } = await db.rpc('wk_hostunico_morning_counts');
    if (error) throw new Error(error.message);
    return data as { ready: number; held_waiting_report: number; undealt_listings: number; pending_without_report: number };
  };
  const before = await counts();
  let addedContacts = 0, addedListings = 0;
  const dealRoom = settings.max_new_listings - run.added_listings;
  if (before.ready < settings.target_ready && dealRoom > 0) {
    const { data, error } = await db.rpc('wk_hostunico_morning_deal', { p_limit: dealRoom });
    if (error) throw new Error(error.message);
    addedContacts = data.contacts; addedListings = data.listings;
  }

  // Every queued lead, released or held, whose report is missing or unfinished.
  const queue = await rows<{ contact_id: string; priority: number; wk_contacts: { phone: string; hostunico_country: string | null } }>(
    db.from('wk_dialer_queue').select('contact_id,priority,wk_contacts!inner(phone,hostunico_country,desk,do_not_call)')
      .eq('campaign_id', HOSTUNICO_CAMPAIGN).eq('wk_contacts.desk', 'sa').eq('wk_contacts.do_not_call', false)
      .or('status.eq.pending,and(status.eq.skipped,hostunico_uplift_hold.eq.true)')
      .order('priority', { ascending: false }).order('created_at').limit(1000));
  const contactIds = [...new Set(queue.map((q) => q.contact_id))];
  const listings: Listing[] = [];
  for (let i = 0; i < contactIds.length; i += 200) {
    listings.push(...await rows<Listing>(db.from('sa_listings').select('id,wk_contact_id,hostunico_uplift_status,report_property,photo_urls,address,listing_url,property_type,rent_pcm,source_price,hostunico_call_eligible,summary')
      .in('wk_contact_id', contactIds.slice(i, i + 200)).eq('hostunico_call_eligible', true).in('source', ['spareroom', 'rightmove'])));
  }
  const reports = new Map<string, Report>();
  const listingIds = listings.map((l) => l.id);
  for (let i = 0; i < listingIds.length; i += 200) {
    for (const r of await rows<Report>(db.from('sa_property_reports').select('listing_id,remote_id,access_token,state,report_url,property,report_pitch').in('listing_id', listingIds.slice(i, i + 200)))) reports.set(r.listing_id, r);
  }
  const contactOf = new Map(queue.map((q) => [q.contact_id, q.wk_contacts]));
  const work: { listing: Listing; report: Report | undefined }[] = [];
  let startRoom = settings.max_reports - run.reports_started;
  for (const id of contactIds) {
    const listing = pickReportListing(listings.filter((l) => l.wk_contact_id === id));
    if (!listing || !reportProperty(listing.report_property)) continue;
    const report = reports.get(listing.id);
    // A rent-matching placeholder is 'ready' but still waits for market research: keep refreshing it.
    if ((report?.state === 'ready' && report.report_pitch && !report.report_pitch.planning) || report?.state === 'review') continue;
    if (!report) { if (startRoom <= 0) continue; startRoom--; }
    work.push({ listing, report });
  }

  let started = 0, nowReady = 0, failures = 0;
  await inBatches(work, 4, deadline, async ({ listing, report }) => {
    try {
      let row = report;
      if (!row) {
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
        const { error } = await db.from('sa_property_reports').upsert({ listing_id: listing.id, access_token: token, property: reportProperty(listing.report_property) }, { onConflict: 'listing_id', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        const { data, error: readError } = await db.from('sa_property_reports').select('listing_id,remote_id,access_token,state,report_url,property,report_pitch').eq('listing_id', listing.id).single();
        if (readError || !data) throw new Error('report row unavailable');
        row = data as Report;
        started++;
      }
      const contact = contactOf.get(listing.wk_contact_id);
      const result = await remote('start', {
        id: row.remote_id, token: row.access_token, property: row.property, country: hostunicoCountry(contact?.hostunico_country, contact?.phone),
        listing: { title: listing.address, photo: listing.photo_urls?.[0], url: listing.listing_url, propertyType: listing.property_type, advertisedRentPcm: listing.rent_pcm != null ? Number(listing.rent_pcm) : undefined, sourcePrice: listing.source_price, wholePropertyVerified: listing.hostunico_call_eligible === true, ...(listingUnfurnished(listing) ? { unfurnished: true } : {}) },
      });
      const ready = result.stage === 'ready' && !!result.reportPitch;
      const { error } = await db.from('sa_property_reports').update({ state: result.stage, message: result.message ?? null, report_url: result.reportUrl ?? null, report_pitch: ready ? result.reportPitch : null, updated_at: new Date().toISOString() })
        .eq('listing_id', listing.id).eq('remote_id', row.remote_id);
      if (error) throw new Error(error.message);
      if (ready && !(result.reportPitch as { planning?: boolean }).planning) nowReady++;
    } catch {
      failures++;
    }
  });

  const after = await counts();
  const stock = after.held_waiting_report + after.undealt_listings;
  const vpsBlocked = (run.vps as { session?: string } | null)?.session === 'expired';
  const level = morningLevel(after.ready, stock, settings, vpsBlocked);
  const summary = {
    ready_before: run.ready_before ?? before.ready, ready_after: after.ready,
    added_contacts: run.added_contacts + addedContacts, added_listings: run.added_listings + addedListings,
    reports_started: run.reports_started + started, reports_ready: run.reports_ready + nowReady, failures: run.failures + failures,
    stock_left: stock, passes: run.passes + 1, level,
    note: [
      level === 'blocked' ? 'SpareRoom session on the VPS has expired. Hugo needs to sign the scraper back in.' : '',
      level !== 'info' && stock + after.ready < 2 * settings.daily_leads ? `Stock is under two days of calling: ${after.ready} ready and ${stock} more in stock against about ${settings.daily_leads} a day.` : '',
      after.pending_without_report ? `${after.pending_without_report} pending leads have no ready report.` : '',
    ].filter(Boolean).join(' ') || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('hostunico_morning_runs').update(summary).eq('run_date', day);
  if (error) throw new Error(error.message);
  return { day, before, after, added: { contacts: addedContacts, listings: addedListings }, reports: { started, ready: nowReady, refreshed: work.length - started, failures }, level, automaticMessages: 0 };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return send(res, 401, { error: 'Unauthorized' });
  const force = new URL(req.url || '/', 'https://app.heyelsie.com').searchParams.get('force') === '1';
  if (!force && !morningWindowOpen(new Date())) return send(res, 200, { skipped: 'outside the 05:45 to 10:00 London window' });
  try {
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    return send(res, 200, await morningPass(db));
  } catch (e) {
    return send(res, 503, { error: e instanceof Error ? e.message : 'Morning leads pass failed' });
  }
}
