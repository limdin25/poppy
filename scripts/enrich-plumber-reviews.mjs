#!/usr/bin/env node
/**
 * Fix the plumber leads' review count + rating with REAL Google data.
 *
 * The source CSV's "Number of Reviews" was unreliable — the scraper defaulted
 * to 0 whenever it couldn't read the count (e.g. In Goes Plumbing: CSV said 0,
 * Google shows 85). This overwrites custom_fields.reviews + custom_fields.rating
 * from the Google Places "Find Place from Text" API (name + town), keeping the
 * original CSV value in custom_fields.reviews_csv for audit. Rank is left as-is
 * (it needs a separate search-position calc).
 *
 * Secrets from env only:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_KEY
 * The Google key is referer-restricted to poppy-henna.vercel.app, so we send
 * that Referer header.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GOOGLE_PLACES_KEY=... \
 *     node scripts/enrich-plumber-reviews.mjs [agentId]
 */

import { createClient } from '@supabase/supabase-js';

// ── SUPERSEDED ───────────────────────────────────────────────────────────────
// Use scripts/process-plumber-leads.mjs — it enriches AND drops >65-review leads
// AND orders A→Z in one run. Enriching alone leaves high-review leads in the
// batch. Refuses unless you opt in. See docs/PLUMBER_LEADS_PIPELINE.md.
if (process.env.FORCE_LEGACY !== '1') {
  console.error('SUPERSEDED — run: node scripts/process-plumber-leads.mjs');
  console.error('(enriches + drops >65 reviews + orders A→Z in one idempotent run)');
  console.error('Override for a one-off with FORCE_LEGACY=1.');
  process.exit(1);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_PLACES_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_PLACES_KEY');
  process.exit(2);
}
const AGENT_ID = process.argv[2] || '28dee5a4-e8be-4019-a6ad-e1dcf07b875c';
const REFERER = 'https://poppy-henna.vercel.app/';

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPlace(name, town) {
  const query = encodeURIComponent([name, town].filter(Boolean).join(' '));
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json`
    + `?input=${query}&inputtype=textquery`
    + `&fields=name,rating,user_ratings_total&key=${GOOGLE_PLACES_KEY}`;
  const res = await fetch(url, { headers: { Referer: REFERER } });
  const json = await res.json();
  if (json.status !== 'OK' || !json.candidates?.length) return null;
  const c = json.candidates[0];
  return {
    reviews: typeof c.user_ratings_total === 'number' ? String(c.user_ratings_total) : null,
    rating: typeof c.rating === 'number' ? String(c.rating) : null,
    matchedName: c.name,
  };
}

// Pull the plumber leads (owned by the agent, carrying the CSV custom_fields).
const { data: rows, error } = await sb
  .from('wk_contacts')
  .select('id, name, custom_fields')
  .eq('owner_agent_id', AGENT_ID);
if (error) { console.error('load error:', error.message); process.exit(1); }

const leads = (rows ?? []).filter((r) => r.custom_fields && r.custom_fields.google_search_url);
console.log(`Enriching ${leads.length} leads via Google Places…`);

let updated = 0, notFound = 0, unchanged = 0;
for (const lead of leads) {
  const cf = lead.custom_fields || {};
  const place = await findPlace(lead.name, cf.town);
  await sleep(120); // gentle on the API
  if (!place || place.reviews == null) { notFound++; continue; }

  const next = { ...cf };
  if (cf.reviews_csv === undefined) next.reviews_csv = cf.reviews ?? '';
  next.reviews = place.reviews;
  if (place.rating != null) next.rating = place.rating;
  next.reviews_source = 'google';

  if (next.reviews === cf.reviews && next.rating === cf.rating) { unchanged++; continue; }

  const { error: upErr } = await sb.from('wk_contacts').update({ custom_fields: next }).eq('id', lead.id);
  if (upErr) { console.error(`update ${lead.name}:`, upErr.message); continue; }
  updated++;
  if (updated <= 8) console.log(`  ${lead.name}: ${cf.reviews ?? '?'} → ${next.reviews} reviews (${next.rating}★)`);
}

console.log('');
console.log(`DONE — ${updated} updated, ${unchanged} already correct, ${notFound} not found on Google.`);
