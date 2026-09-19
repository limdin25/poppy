#!/usr/bin/env node
/**
 * Put unsold auction lots in front of Pedro on the Auction desk, grouped by
 * the auction OFFICE that holds them, on the "Auction - Pedro" dialer queue.
 *
 * Hugo, 2026-09-18: Pedro rings the auctioneer about lots that went under the
 * hammer and did not sell. The VPS auction lane (/root/scraper/auction) finds
 * them, values them with the Houses engine, and files only the ones with
 * strong, size-matched comparables through /api/properties/ingest with
 * desk='auction'. This script turns those rows into calls.
 *
 * ONE CONTACT PER OFFICE, not per lot: one call covers every lot of theirs on
 * our list (the Lots tab shows them all). When to deal an office again is
 * decided by scripts/lib/auction-redial-policy.mjs, which explains why it is
 * NOT the 14-day Houses rule.
 *
 * A PHONE ALREADY ON THE HOUSES DESK IS SKIPPED, never moved. wk_contacts.phone
 * is unique across the whole CRM, so an auction office whose number is also a
 * Houses contact cannot be an Auction contact too; it is reported and left.
 *
 * Nothing here texts, emails or rings anybody. It files calls for a human.
 *
 * Usage:
 *   node scripts/assign-auction-lots-to-pedro.mjs           # dry run
 *   node scripts/assign-auction-lots-to-pedro.mjs --apply
 *   node scripts/assign-auction-lots-to-pedro.mjs --offices=10 --apply
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { groupByBranch } from './lib/property-branches.mjs'
import { decideAuctionDeal, UNASKED } from './lib/auction-redial-policy.mjs'

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
const MAX_OFFICES = parseInt(arg('offices', '60'), 10)

const AGENT_EMAIL = 'pedro@hostunico.com'
const CAMPAIGN_NAME = 'Auction - Pedro'

const say = (...a) => console.log(...a)

async function loadLots() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('brrr_properties')
      .select('id, address, agent_phone, agent_name, status, deal, auction, created_at, wk_contact_id')
      .eq('desk', 'auction')
      .neq('status', 'auditor_killed')
      .not('agent_phone', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(`load: ${error.message}`)
    all.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return all
}

/** The last outbound call to this contact, and how many in a row went unanswered. */
async function officeHistory(contactId, colName) {
  if (!contactId) return { lastCallAt: null, lastOutcome: null, silentTries: 0 }
  const { data } = await db.from('wk_calls')
    .select('started_at, disposition_column_id')
    .eq('contact_id', contactId).eq('direction', 'outbound')
    .order('started_at', { ascending: false }).limit(10)
  const calls = data ?? []
  if (calls.length === 0) return { lastCallAt: null, lastOutcome: null, silentTries: 0 }
  let silentTries = 0
  for (const c of calls) {
    const o = c.disposition_column_id ? colName.get(c.disposition_column_id) ?? null : null
    if (o && o !== 'Voicemail' && o !== 'No pickup') break
    silentTries++
  }
  const first = calls[0]
  return {
    lastCallAt: first.started_at,
    lastOutcome: first.disposition_column_id ? colName.get(first.disposition_column_id) ?? null : null,
    silentTries,
  }
}

async function main() {
  say(`Auction lots to Pedro${APPLY ? '' : '  (DRY RUN, nothing is written)'}`)

  const { data: agent } = await db.from('profiles').select('id').eq('email', AGENT_EMAIL).maybeSingle()
  if (!agent) throw new Error(`no profile for ${AGENT_EMAIL}`)
  const { data: camp } = await db.from('wk_dialer_campaigns')
    .select('id, pipeline_id').eq('name', CAMPAIGN_NAME).eq('desk', 'auction').maybeSingle()
  if (!camp) throw new Error(`no campaign ${CAMPAIGN_NAME}; apply migration 20260918000001`)
  const { data: cols } = await db.from('wk_pipeline_columns').select('id, name')
  const colName = new Map((cols ?? []).map((c) => [c.id, c.name]))

  const lots = await loadLots()
  const offices = groupByBranch(lots)
  // Best evidence first: the office whose best lot is furthest under value.
  const best = (o) => Math.max(...o.properties.map((p) => Number(p.deal?.local_discount_pct) || 0))
  offices.sort((a, b) => best(b) - best(a))
  say(`  lots on file          : ${lots.length}`)
  say(`  auction offices       : ${offices.length}`)

  const { data: maxRow } = await db.from('wk_dialer_queue').select('priority')
    .eq('campaign_id', camp.id).order('priority', { ascending: false }).limit(1).maybeSingle()
  const { data: minRow } = await db.from('wk_dialer_queue').select('priority')
    .eq('campaign_id', camp.id).eq('status', 'pending').order('priority', { ascending: true }).limit(1).maybeSingle()
  let top = (maxRow?.priority ?? 0) + offices.length + 1
  let bottom = (minRow?.priority ?? 0) - 1

  let queued = 0, held = 0, skippedHouses = 0, dealt = 0
  for (const office of offices) {
    if (dealt >= MAX_OFFICES) break
    const a = office.properties[0]?.auction ?? {}
    const label = `${office.agency} (${office.phone})`

    // Who holds this number already?
    const { data: existing } = await db.from('wk_contacts')
      .select('id, desk, owner_agent_id, custom_fields, email').eq('phone', office.phone).maybeSingle()
    if (existing && existing.desk !== 'auction') {
      skippedHouses++
      say(`  SKIP ${label}: this number is already a Houses contact`)
      continue
    }

    const unasked = office.properties.filter((p) => UNASKED.has(p.status)).length
    const hist = await officeHistory(existing?.id ?? null, colName)
    const decision = decideAuctionDeal({ ...hist, unaskedLots: unasked })
    dealt++

    if (!APPLY) {
      say(`  ${decision.deal ? (decision.back ? 'REDIAL' : 'QUEUE ') : 'hold  '} ${label}: ${office.properties.length} lot(s), ${unasked} unasked. ${decision.reason}`)
      continue
    }

    // The contact: one per office, on the Auction desk, owned by Pedro.
    const facts = {
      lead_type: 'auctioneer',
      auction_house: String(a.house ?? ''),
      office: String(a.office ?? ''),
      next_step: existing?.custom_fields?.next_step || 'Ring the auctioneer',
    }
    let contactId = existing?.id ?? null
    if (!contactId) {
      const { data: made, error } = await db.from('wk_contacts').insert({
        name: office.agency, phone: office.phone, email: a.office_email || null,
        owner_agent_id: agent.id, desk: 'auction', custom_fields: facts, is_hot: false,
      }).select('id').single()
      if (error) {
        // An email already on another contact is the usual cause: file without it.
        const { data: retry, error: e2 } = await db.from('wk_contacts').insert({
          name: office.agency, phone: office.phone, owner_agent_id: agent.id,
          desk: 'auction', custom_fields: facts, is_hot: false,
        }).select('id').single()
        if (e2) { say(`  SKIP ${label}: could not create the contact (${e2.message})`); continue }
        contactId = retry.id
      } else {
        contactId = made.id
      }
    } else {
      await db.from('wk_contacts')
        .update({ custom_fields: { ...(existing.custom_fields ?? {}), ...facts } })
        .eq('id', contactId)
    }

    await db.from('brrr_properties')
      .update({ call_channel: 'human', human_agent_id: agent.id, wk_contact_id: contactId })
      .in('id', office.properties.map((p) => p.id))

    if (!decision.deal) { held++; say(`  held  ${label}: ${decision.reason}`); continue }

    const { data: already } = await db.from('wk_dialer_queue').select('id')
      .eq('campaign_id', camp.id).eq('contact_id', contactId)
      .in('status', ['pending', 'dialing', 'review']).limit(1)
    if (already?.length) { held++; say(`  held  ${label}: already in the queue`); continue }

    const { error: qErr } = await db.from('wk_dialer_queue').insert({
      campaign_id: camp.id, contact_id: contactId, status: 'pending',
      priority: decision.back ? bottom-- : top--,
    })
    if (qErr) { say(`  FAIL ${label}: ${qErr.message}`); continue }
    queued++
    say(`  QUEUED ${label}: ${office.properties.length} lot(s). ${decision.reason}`)
  }

  say('')
  say(`  queued ${queued}, held ${held}, skipped as Houses numbers ${skippedHouses}`)
  if (!APPLY) say('  DRY RUN. Add --apply to write.')
  console.log(`AUCTION_ASSIGN ${JSON.stringify({ lots: lots.length, offices: offices.length, queued, held, skippedHouses, apply: APPLY })}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
