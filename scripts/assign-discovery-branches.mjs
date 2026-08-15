// Discovery-first: one branch, ONE property, no figure, 150 a night.
//
// Hugo, 2026-08-15, authorising the mode in his own words: "we aim for 150 per
// night ... make sure pedro already have 150 now and then keep the circle by
// adding 150 new every night ... gold/strong on the top of pedros list ...
// i prefer 1 branch, 1 property. agent will have no patience to chat about 5
// properties."
//
// WHAT THIS IS. Call one of the two-call process never names a figure, by
// design, so it does not need a priced deal behind it. The pricing gate
// (floor plan, comps tier, valuation, auditor) protects a number said out
// loud, and no number is said. A branch from this pool graduates to an offer
// call only after the homework passes the full standard through /api/reprice.
//
// The LISTING checks (band, no auction/tenants/retirement, house not flat,
// lettings sanity, crime gate, one-house-per-branch choice) live in
// discovery_pool.py on the scraper, which writes the pool this reads. The
// CALL checks live here: the 14-day redial hold, do-not-call, queue dedupe
// and owner collisions. That side knows listings; this side knows calls.
//
// GOLD/STRONG ALWAYS ON TOP. The priced assign script inserts fresh branches
// ABOVE the current maximum priority; this one inserts BELOW the current
// minimum, so a discovery branch can never outrank a priced deal, tonight or
// any night, whatever order the two scripts run in.
//
// NO MONEY ON THE CARD, structurally. A discovery contact never receives
// offer_open, offer_ceiling, ladder, property_worth, worth_after_bed or
// comp_evidence, so the live coach CANNOT quote a figure, and the script pane
// opens in discovery mode because next_step is 'Discovery call'.
//
// Usage:
//   node scripts/assign-discovery-branches.mjs --pool=discovery_pool.json            # dry
//   node scripts/assign-discovery-branches.mjs --pool=... --count=150 --apply
//
// DRY BY DEFAULT. Without --apply nothing is written.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideRedial } from './lib/redial-policy.mjs'

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
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const APPLY = process.argv.includes('--apply')
const COUNT = parseInt(arg('count', '150'), 10)
const POOL_PATH = arg('pool', '/root/scraper/exports/discovery_pool.json')

// The same identities the priced path uses. REFUSED rather than created here:
// if either is missing something is badly wrong and a discovery run must not
// be the thing that invents a second Pedro.
const AGENT_EMAIL = 'pedro@hostunico.com'
const CAMPAIGN_NAME = 'Houses - Pedro'

const say = (s) => console.log(s)

async function main() {
  say(`Discovery-first assign. ${APPLY ? 'APPLY' : 'DRY RUN'}, target ${COUNT} branches.`)

  const pool = JSON.parse(readFileSync(POOL_PATH, 'utf8'))
  say(`  pool: ${pool.length} branches from ${POOL_PATH}`)

  const { data: agent } = await db.from('profiles')
    .select('id, name').ilike('email', AGENT_EMAIL).maybeSingle()
  if (!agent) { console.error(`REFUSING: no agent ${AGENT_EMAIL}`); process.exit(2) }
  const { data: campaign } = await db.from('wk_dialer_campaigns')
    .select('id').eq('name', CAMPAIGN_NAME).maybeSingle()
  if (!campaign) { console.error(`REFUSING: no campaign ${CAMPAIGN_NAME}`); process.exit(2) }

  // Who has already been rung, exactly as the priced path measures it.
  const phones = pool.map((b) => b.phone)
  const history = new Map()
  const contactsByPhone = new Map()
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await db.from('wk_contacts')
      .select('id, phone, owner_agent_id, do_not_call')
      .in('phone', phones.slice(i, i + 200))
    for (const c of data ?? []) contactsByPhone.set(c.phone, c)
  }
  const ids = [...contactsByPhone.values()].map((c) => c.id)
  const phoneOf = new Map([...contactsByPhone.values()].map((c) => [c.id, c.phone]))
  const { data: cols } = await db.from('wk_pipeline_columns').select('id, name')
  const colName = new Map((cols ?? []).map((c) => [c.id, c.name]))
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('wk_calls')
      .select('contact_id, disposition_column_id, started_at')
      .eq('direction', 'outbound')
      .in('contact_id', ids.slice(i, i + 200))
      .order('started_at', { ascending: false })
    for (const c of data ?? []) {
      const phone = phoneOf.get(c.contact_id)
      if (!phone || history.has(phone)) continue
      history.set(phone, {
        lastCallAt: c.started_at ?? null,
        lastOutcome: c.disposition_column_id ? colName.get(c.disposition_column_id) ?? null : null,
      })
    }
  }

  // Already queued: one branch, one card, never duplicates.
  const queued = new Set()
  let discoveryPending = 0
  {
    const { data } = await db.from('wk_dialer_queue')
      .select('contact_id').eq('campaign_id', campaign.id)
      .in('status', ['pending', 'dialing'])
    const ids = (data ?? []).map((q) => q.contact_id)
    for (const id of ids) queued.add(id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data: cs } = await db.from('wk_contacts')
        .select('id, custom_fields').in('id', ids.slice(i, i + 200))
      for (const c of cs ?? []) {
        if (c.custom_fields?.source === 'discovery_pool') discoveryPending++
      }
    }
  }

  // --count is a TARGET, not an increment. "Keep the circle by adding 150 new
  // every night" must never mean a growing backlog on a day Pedro dials fewer:
  // a branch queued today and dialled in three weeks is a stale card and a
  // wasted slot in the pool. Top up to the target and stop.
  const toAdd = Math.max(0, COUNT - discoveryPending)
  say(`  discovery already pending: ${discoveryPending}; topping up by ${toAdd} to reach ${COUNT}`)

  // BELOW the priced deals, always: everything here goes under the current
  // minimum pending priority.
  const { data: minRow } = await db.from('wk_dialer_queue')
    .select('priority').eq('campaign_id', campaign.id).eq('status', 'pending')
    .order('priority', { ascending: true }).limit(1)
  let nextPriority = ((minRow?.[0]?.priority ?? 0) - 1)

  const nowMs = Date.now()
  const skipped = { called: 0, owned_elsewhere: 0, dnc: 0, queued: 0 }
  let taken = 0

  for (const branch of pool) {
    if (taken >= toAdd) break
    const existing = contactsByPhone.get(branch.phone)
    if (existing?.do_not_call) { skipped.dnc++; continue }
    if (existing && existing.owner_agent_id && existing.owner_agent_id !== agent.id) {
      skipped.owned_elsewhere++; continue
    }
    if (existing && queued.has(existing.id)) { skipped.queued++; continue }
    const verdict = decideRedial({ ...(history.get(branch.phone) ?? {}), nowMs })
    if (!verdict.queue) { skipped.called++; continue }

    const p = branch.property
    const facts = {
      lead_type: 'estate_agent',
      source: 'discovery_pool',
      next_step: 'Discovery call',
      agency: branch.agency || '',
      properties_count: '1',
      property_address: p.address ?? '',
      property_url: p.url ?? '',
      property_street: String(p.address ?? '').split(',')[0].trim(),
      bedrooms: String(p.bedrooms ?? ''),
      property_type: p.property_type ?? '',
      days_on_market: String(p.days_on_market ?? ''),
      asking_price: p.price ? `£${Number(p.price).toLocaleString('en-GB')}` : '',
      // Written in as many words so no screen, coach or report can mistake
      // an unpriced discovery card for a deal with a band behind it.
      valuation_notes: 'Discovery call. No figure exists for this house yet; the ballpark is built AFTER this call from what the agent says.',
    }

    if (!APPLY) {
      taken++
      if (taken <= 15) say(`  ${String(taken).padStart(3)}. ${branch.agency || branch.phone} — ${facts.property_street}${p.price_reduced ? ' (price cut)' : ''}`)
      continue
    }

    let contactId = existing?.id
    if (!contactId) {
      const { data: created, error } = await db.from('wk_contacts').insert({
        name: branch.agency || branch.phone,
        phone: branch.phone,
        owner_agent_id: agent.id,
        custom_fields: facts,
        is_hot: false,
      }).select('id').single()
      if (error || !created) { say(`  FAILED to create ${branch.agency}: ${error?.message}`); continue }
      contactId = created.id
    } else {
      // Merge, never wipe: an existing branch keeps everything it has and
      // gains the discovery facts. Money keys are never written here.
      const { data: row } = await db.from('wk_contacts')
        .select('custom_fields').eq('id', contactId).maybeSingle()
      await db.from('wk_contacts')
        .update({
          owner_agent_id: existing.owner_agent_id ?? agent.id,
          custom_fields: { ...(row?.custom_fields ?? {}), ...facts },
        })
        .eq('id', contactId)
    }

    await db.from('wk_dialer_queue').insert({
      campaign_id: campaign.id, contact_id: contactId,
      status: 'pending', priority: nextPriority--,
    })
    taken++
  }

  say('')
  say(`  queued          : ${taken} discovery branch(es), all BELOW the priced deals`)
  say(`  held back       : called within the window ${skipped.called}, owned by another agent ${skipped.owned_elsewhere}, do-not-call ${skipped.dnc}, already queued ${skipped.queued}`)
  if (taken < toAdd) {
    // A silent shortfall reads as "covered everything". Say it in capitals:
    // this is the number that tells Hugo the pool is running thin.
    say(`  SHORTFALL: wanted ${toAdd} more, found ${taken}. The pool is running thin; widen the scrape or shorten the redial window.`)
  }
  if (!APPLY) say('  Dry run. Nothing written. Add --apply to do it for real.')
}

main().catch((e) => { console.error(e); process.exit(1) })
