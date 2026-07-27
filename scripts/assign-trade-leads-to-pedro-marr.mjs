#!/usr/bin/env node
/**
 * Move freshly-scraped trade leads (scrape-trade-leads.mjs output already sitting
 * in wk_contacts, unassigned) onto Pedro's and Marr's EXISTING dialer queues, at
 * the TOP (highest priority — dialed first), without touching any lead already
 * queued below them.
 *
 * Hugo's call (2026-07-27):
 *   - Same queue they already dial ("Plumbers - Pedro" / "Plumbers - Marr"), not
 *     a new campaign — nothing for them to switch tomorrow.
 *   - pest-control: named-owner only (Hugo's standard rule).
 *   - locksmith: name NOT required (~95% of locksmiths are sole traders with no
 *     Companies House record at all) — interpolateScript.ts now collapses the
 *     opener to "is that [business_name]?" when there's no owner_first, so an
 *     unnamed lead still reads naturally, never a raw bracket.
 *   - Still mobile-only and reviews<=65 — both already enforced at scrape time,
 *     re-checked here as a defensive belt-and-braces pass.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/assign-trade-leads-to-pedro-marr.mjs [--niche=locksmith,pest-control] [--apply]
 *
 * Dry run by default — pass --apply to actually write.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
for (const line of readFileSync(resolve(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const NICHES = arg('niche', 'locksmith,pest-control').split(',').map((s) => s.trim()).filter(Boolean)
const APPLY = process.argv.includes('--apply')
const MAX_REVIEWS = 65

// Hugo's rule, hardcoded per trade so it can't be flipped by a stray CLI flag.
const REQUIRE_OWNER = { locksmith: false, 'pest-control': true }

const BATCHES = [
  { label: 'Pedro', agentId: 'c3e3c2a7-4cfb-4381-ab35-335fb1a331f1', campaign: 'Plumbers - Pedro' },
  { label: 'Marr', agentId: '7b677273-f330-43c7-b21a-6242d6f8881a', campaign: 'Plumbers - Marr' },
]

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const isUkMobile = (raw) => /^0?7\d{9}$/.test(String(raw || '').replace(/[\s()-]/g, '').replace(/^\+44/, '0'))

// ---- 1. pull every unassigned lead for the target niches (paginated — PostgREST caps at 1000/response) ----
const candidates = []
for (const niche of NICHES) {
  let from = 0
  for (;;) {
    const { data, error } = await sb
      .from('wk_contacts')
      .select('id, name, phone, owner_agent_id, custom_fields')
      .filter('custom_fields->>niche', 'eq', niche)
      .is('owner_agent_id', null)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) { console.error(`load ${niche}:`, error.message); process.exit(1) }
    for (const r of data ?? []) candidates.push({ ...r, niche })
    if (!data || data.length < 1000) break
    from += 1000
  }
}
console.log(`Loaded ${candidates.length} unassigned candidate(s) across niches: ${NICHES.join(', ')}`)

// ---- 2. filter: mobile + reviews<=65 (defensive re-check) + owner-name rule per niche ----
let droppedMobile = 0, droppedReviews = 0, droppedNoOwner = 0
const keepers = candidates.filter((c) => {
  if (!isUkMobile(c.phone)) { droppedMobile++; return false }
  const reviews = Number(c.custom_fields?.reviews ?? 0)
  if (reviews < 1 || reviews > MAX_REVIEWS) { droppedReviews++; return false }
  if (REQUIRE_OWNER[c.niche] && !String(c.custom_fields?.owner_name ?? '').trim()) { droppedNoOwner++; return false }
  return true
})
console.log(`Keepers: ${keepers.length} (dropped ${droppedMobile} non-mobile, ${droppedReviews} bad review count, ${droppedNoOwner} no-owner-where-required)`)
if (!keepers.length) { console.log('Nothing to assign.'); process.exit(0) }

// A→Z within the whole keeper set, then dealt alternately so both agents get an
// even spread of the alphabet and of both trades (mirrors assign-agent-batches.mjs).
keepers.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()))
const dealt = BATCHES.map(() => [])
keepers.forEach((k, i) => dealt[i % BATCHES.length].push(k))

if (!APPLY) {
  for (let b = 0; b < BATCHES.length; b++) {
    console.log(`[${BATCHES[b].label}] would get ${dealt[b].length} leads`)
  }
  console.log('\ndry run — re-run with --apply to write')
  process.exit(0)
}

// ---- 3. write: assign owner + queue at the TOP of the agent's existing campaign ----
for (let b = 0; b < BATCHES.length; b++) {
  const batch = BATCHES[b]
  const leads = dealt[b]
  if (!leads.length) { console.log(`[${batch.label}] no leads — skip`); continue }

  const { data: campaign, error: campErr } = await sb
    .from('wk_dialer_campaigns').select('id').eq('name', batch.campaign).maybeSingle()
  if (campErr || !campaign) { console.error(`[${batch.label}] campaign "${batch.campaign}" not found:`, campErr?.message); process.exit(1) }
  const campaignId = campaign.id

  // current ceiling — new leads stack ABOVE it, existing queue order untouched
  let maxPriority = 0
  {
    let from = 0
    for (;;) {
      const { data, error } = await sb.from('wk_dialer_queue')
        .select('priority').eq('campaign_id', campaignId).eq('status', 'pending')
        .order('priority', { ascending: false }).range(from, from + 999)
      if (error) { console.error(`[${batch.label}] read max priority:`, error.message); process.exit(1) }
      if (from === 0 && data?.length) maxPriority = data[0].priority || 0
      if (!data || data.length < 1000) break
      from += 1000
    }
  }

  // own the contacts
  const CHUNK = 50
  for (let i = 0; i < leads.length; i += CHUNK) {
    const slice = leads.slice(i, i + CHUNK)
    const { error } = await sb.from('wk_contacts')
      .update({ owner_agent_id: batch.agentId })
      .in('id', slice.map((l) => l.id))
      .is('owner_agent_id', null) // never steal a contact another run just claimed
    if (error) { console.error(`[${batch.label}] own contacts:`, error.message); process.exit(1) }
  }

  // link agent to the campaign (idempotent — should already exist, but cheap to confirm)
  await sb.from('wk_campaign_agents')
    .upsert({ campaign_id: campaignId, agent_id: batch.agentId, role: 'agent' }, { onConflict: 'campaign_id,agent_id', ignoreDuplicates: true })

  // queue at the top: A first in the new batch gets the highest priority
  const queueRows = leads.map((l, i) => ({
    campaign_id: campaignId, contact_id: l.id, status: 'pending',
    priority: maxPriority + (leads.length - i),
  }))
  let queued = 0
  for (let i = 0; i < queueRows.length; i += CHUNK) {
    const { data, error } = await sb.from('wk_dialer_queue').insert(queueRows.slice(i, i + CHUNK)).select('id')
    if (error) { console.error(`[${batch.label}] queue insert:`, error.message); process.exit(1) }
    queued += (data ?? []).length
  }

  console.log(`[${batch.label}] campaign ${campaignId}: ${leads.length} owned, ${queued} queued at priority ${maxPriority + 1}-${maxPriority + leads.length} (was topping out at ${maxPriority}).`)
}
console.log('\nDONE.')
