#!/usr/bin/env node
/**
 * Find city-centre flats to rent on Rightmove and put one per letting agency in
 * front of Pedro on the Serviced Accommodation desk (Hugo, 2026-09-23).
 *
 * Pedro asks the agent one thing: would the landlord, in principle, let this
 * flat on a company let to a serviced accommodation company. We do not take
 * the flat; Hugo sells the deal and brings the company.
 *
 * What it does, in order:
 *   1. Reads Rightmove's to-rent search for every city-centre postcode in
 *      scripts/lib/sa-listings.mjs (SA_AREAS). Plain GET, no browser, no proxy.
 *   2. Drops rooms, student lets, build-to-rent blocks, short lets, portals.
 *   3. Keeps ONE listing per agency (by phone), the newest.
 *   4. Skips an agency dealt anything in the last 14 days, one that said it
 *      never does company lets, and any phone already on Houses or Auction.
 *   5. Tops the "SA - Pedro" queue up to --target, one agency per city in turn.
 *
 * Nothing here texts, emails or rings anybody. It files calls for a human.
 *
 * Usage:
 *   node scripts/sa-scrape-and-assign.mjs                 # dry run, prints the picks
 *   node scripts/sa-scrape-and-assign.mjs --apply         # writes, target 100
 *   node scripts/sa-scrape-and-assign.mjs --apply --target=100 --pages=2
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  areaList, resolveHit, searchUrl, parseSearchPage, refuseReason, toListing,
  bestPerAgency, decideAgency, roundRobin, spokenStreet,
} from './lib/sa-listings.mjs'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const ENV = resolve(REPO, '.env')
if (existsSync(ENV)) {
  for (const line of readFileSync(ENV, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const APPLY = process.argv.includes('--apply')
const TARGET = parseInt(arg('target', '100'), 10)
const PAGES = parseInt(arg('pages', '2'), 10)

const AGENT_EMAIL = 'pedro@hostunico.com'
const CAMPAIGN_NAME = 'SA - Pedro'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const say = (s) => console.log(s)

async function get(url, accept = 'text/html') {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-GB,en;q=0.9', Referer: 'https://www.rightmove.co.uk/' },
        signal: AbortSignal.timeout(30_000),
      })
      if (r.ok) return await r.text()
      if (r.status === 404) return ''
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)))
  }
  return ''
}

async function locationFor(code) {
  const txt = await get(`https://los.rightmove.co.uk/typeahead?query=${encodeURIComponent(code)}&limit=10&exclude=`, 'application/json')
  try { return resolveHit(code, JSON.parse(txt)?.matches) } catch { return null }
}

/** Run fn over items, `width` at a time. One failure never stops the rest. */
async function pool(items, width, fn) {
  const out = []
  let next = 0
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < items.length) {
      const i = next++
      try { out[i] = await fn(items[i]) } catch (e) { out[i] = { error: String(e) } }
    }
  }))
  return out
}

async function scrape() {
  const areas = areaList()
  const refused = new Map()
  let seen = 0
  const results = await pool(areas, 6, async (a) => {
    const loc = await locationFor(a.code)
    if (!loc) return { ...a, loc: null, listings: [] }
    const listings = []
    for (let page = 0; page < PAGES; page++) {
      const rows = parseSearchPage(await get(searchUrl(loc, page * 24)))
      for (const p of rows) {
        seen++
        const why = refuseReason(p)
        if (why) { refused.set(why, (refused.get(why) ?? 0) + 1); continue }
        listings.push(toListing(p, a))
      }
      if (rows.length < 24) break
    }
    return { ...a, loc, listings }
  })
  const unresolved = results.filter((r) => r && !r.loc).map((r) => r.code)
  return { results, refused, seen, unresolved }
}

async function main() {
  say(`Serviced Accommodation listings to Pedro${APPLY ? '' : '  (DRY RUN, nothing is written)'}`)

  const { data: agent } = await db.from('profiles').select('id').eq('email', AGENT_EMAIL).maybeSingle()
  if (!agent) throw new Error(`no profile for ${AGENT_EMAIL}`)
  const { data: camp } = await db.from('wk_dialer_campaigns')
    .select('id, pipeline_id').eq('name', CAMPAIGN_NAME).eq('desk', 'sa').maybeSingle()
  if (!camp) throw new Error(`no campaign ${CAMPAIGN_NAME}; apply migration 20260923000001`)

  const { count: pending } = await db.from('wk_dialer_queue')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', camp.id).eq('status', 'pending')
  const room = Math.max(0, TARGET - (pending ?? 0))
  say(`  already waiting in the queue : ${pending ?? 0}`)
  say(`  room to fill up to ${TARGET}    : ${room}`)

  const t0 = Date.now()
  const { results, refused, seen, unresolved } = await scrape()
  say(`  postcodes read               : ${results.length} (${Math.round((Date.now() - t0) / 1000)}s)`)
  if (unresolved.length) say(`  postcodes Rightmove did not know: ${unresolved.join(', ')}`)
  say(`  listings seen                : ${seen}`)
  for (const [why, n] of [...refused.entries()].sort((a, b) => b[1] - a[1])) say(`    refused, ${why}: ${n}`)

  // One per agency across the whole country, then grouped back by city.
  const all = results.flatMap((r) => r?.listings ?? [])
  const perAgency = bestPerAgency(all)
  say(`  listings kept                : ${all.length}`)
  say(`  agencies                     : ${perAgency.size}`)

  // Who may be dealt today.
  const phones = [...perAgency.keys()]
  const history = new Map()
  const others = new Map()
  for (let i = 0; i < phones.length; i += 200) {
    const chunk = phones.slice(i, i + 200)
    const { data: h } = await db.from('sa_listings').select('agency_phone, branch_id, dealt_at, outcome, rightmove_id').in('agency_phone', chunk)
    for (const r of h ?? []) history.set(r.agency_phone, [...(history.get(r.agency_phone) ?? []), r])
    const { data: c } = await db.from('wk_contacts').select('id, phone, desk, custom_fields').in('phone', chunk)
    for (const r of c ?? []) others.set(r.phone, r)
  }
  const branches = [...perAgency.values()].map((l) => l.branch_id).filter(Boolean)
  const byBranch = new Map()
  for (let i = 0; i < branches.length; i += 200) {
    const { data: h } = await db.from('sa_listings').select('agency_phone, branch_id, dealt_at, outcome, rightmove_id').in('branch_id', branches.slice(i, i + 200))
    for (const r of h ?? []) byBranch.set(r.branch_id, [...(byBranch.get(r.branch_id) ?? []), r])
  }

  const byCity = new Map()
  let otherDesk = 0, resting = 0, never = 0, seenBefore = 0
  for (const l of perAgency.values()) {
    const owner = others.get(l.agency_phone)
    if (owner && owner.desk !== 'sa') { otherDesk++; continue }
    const hist = [...(history.get(l.agency_phone) ?? []), ...(l.branch_id ? byBranch.get(l.branch_id) ?? [] : [])]
    const d = decideAgency(hist)
    if (!d.deal) { if (/never/.test(d.reason)) never++; else resting++; continue }
    if (hist.some((h) => h.rightmove_id === l.rightmove_id)) { seenBefore++; continue }
    const list = byCity.get(l.city) ?? []
    list.push({ ...l, reason: d.reason, contact: owner ?? null })
    byCity.set(l.city, list)
  }
  for (const list of byCity.values()) list.sort((a, b) => (Date.parse(b.first_listed_at ?? '') || 0) - (Date.parse(a.first_listed_at ?? '') || 0))
  say(`  skipped, number is on Houses or Auction : ${otherDesk}`)
  say(`  skipped, agency resting (14 days)       : ${resting}`)
  say(`  skipped, never does company lets        : ${never}`)
  say(`  skipped, same flat dealt before          : ${seenBefore}`)

  const picks = roundRobin(byCity, room)
  const cityCount = new Map()
  for (const p of picks) cityCount.set(p.city, (cityCount.get(p.city) ?? 0) + 1)
  say(`  picked                       : ${picks.length}`)
  say(`  by city: ${[...cityCount.entries()].map(([c, n]) => `${c} ${n}`).join(', ')}`)
  say('')

  if (!APPLY) {
    for (const p of picks) say(`  ${p.city.padEnd(13)} ${p.agency_phone}  ${p.agency.slice(0, 44).padEnd(44)} ${p.bedrooms}b ${p.property_type ?? ''} £${p.rent_pcm} pcm  ${p.address}`)
    say('')
    say('  DRY RUN. Add --apply to write.')
    console.log(`SA_ASSIGN ${JSON.stringify({ seen, kept: all.length, agencies: perAgency.size, picked: picks.length, apply: false })}`)
    return
  }

  const { data: maxRow } = await db.from('wk_dialer_queue').select('priority')
    .eq('campaign_id', camp.id).order('priority', { ascending: false }).limit(1).maybeSingle()
  // Pedro's queue dials highest priority first, so the round-robin order is
  // preserved by counting down from the top.
  let top = (maxRow?.priority ?? 0) + picks.length + 1

  let queued = 0, failed = 0
  for (const p of picks) {
    const label = `${p.agency} (${p.agency_phone})`
    const facts = {
      lead_type: 'sa_agency',
      agency: p.agency,
      city: p.city,
      next_step: 'Ask about a company let',
      sa_listing_rm_id: p.rightmove_id,
      property_address: p.address,
      property_street: spokenStreet(p.address),
      rent_pcm: p.rent_pcm != null ? String(p.rent_pcm) : '',
      bedrooms: String(p.bedrooms ?? ''),
      property_type: p.property_type ?? '',
      listing_url: p.listing_url,
    }

    let contactId = p.contact?.id ?? null
    if (!contactId) {
      const { data: made, error } = await db.from('wk_contacts').insert({
        name: p.agency, phone: p.agency_phone, owner_agent_id: agent.id,
        desk: 'sa', custom_fields: facts, is_hot: false,
      }).select('id').single()
      if (error) { failed++; say(`  FAIL ${label}: ${error.message}`); continue }
      contactId = made.id
    } else {
      await db.from('wk_contacts')
        .update({ custom_fields: { ...(p.contact.custom_fields ?? {}), ...facts }, owner_agent_id: agent.id })
        .eq('id', contactId)
    }

    const { error: lErr } = await db.from('sa_listings').insert({
      rightmove_id: p.rightmove_id, branch_id: p.branch_id, agency: p.agency, agency_phone: p.agency_phone,
      city: p.city, outcode: p.outcode, address: p.address, rent_pcm: p.rent_pcm, bedrooms: p.bedrooms,
      bathrooms: p.bathrooms, property_type: p.property_type, summary: p.summary, listing_url: p.listing_url,
      photo_urls: p.photo_urls, first_listed_at: p.first_listed_at, let_available_date: p.let_available_date,
      wk_contact_id: contactId,
    })
    if (lErr) { failed++; say(`  FAIL ${label}: listing not saved (${lErr.message})`); continue }

    const { data: already } = await db.from('wk_dialer_queue').select('id')
      .eq('campaign_id', camp.id).eq('contact_id', contactId)
      .in('status', ['pending', 'dialing', 'review']).limit(1)
    if (!already?.length) {
      const { error: qErr } = await db.from('wk_dialer_queue').insert({
        campaign_id: camp.id, contact_id: contactId, status: 'pending', priority: top--,
      })
      if (qErr) { failed++; say(`  FAIL ${label}: ${qErr.message}`); continue }
    }
    queued++
    say(`  QUEUED ${p.city.padEnd(13)} ${label}: ${p.bedrooms} bed, £${p.rent_pcm} pcm, ${p.address}`)
  }

  say('')
  say(`  queued ${queued}, failed ${failed}`)
  console.log(`SA_ASSIGN ${JSON.stringify({ seen, kept: all.length, agencies: perAgency.size, picked: picks.length, queued, failed, apply: true })}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
