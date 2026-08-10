#!/usr/bin/env node
/**
 * Put scraped properties in front of a human agent, grouped by estate agency
 * branch, on the "Houses - Pedro" dialer queue.
 *
 * Hugo's call (2026-08-09): Pedro rings the estate agents himself. The AI
 * qualifier stays off, and this script sets call_channel='human' on every
 * property at a branch it hands over, so the AI can never ring an office Pedro
 * is mid-negotiation with even if it is switched back on later.
 *
 * ONE CONTACT PER BRANCH, not per property. Pattinson listing 12 houses is one
 * phone call about 12 houses, not 12 calls. The Houses tab in the dialer shows
 * the agent all of them; the headline (biggest offer) fills the offer strip and
 * the script.
 *
 * Usage:
 *   node scripts/assign-properties-to-pedro-houses.mjs               # dry run
 *   node scripts/assign-properties-to-pedro-houses.mjs --apply
 *   node scripts/assign-properties-to-pedro-houses.mjs --branches=5 --apply
 *   node scripts/assign-properties-to-pedro-houses.mjs --pursue-only --apply
 *   node scripts/assign-properties-to-pedro-houses.mjs --setup-only --apply
 *
 * DRY BY DEFAULT. Without --apply nothing is written and nothing is charged:
 * unlike the trade-lead scripts there is no paid screen in here at all (see
 * "Two things this deliberately does NOT do" below).
 *
 * --setup-only creates the agent and the campaign and stops, so the login can
 * be handed over before any lead is queued.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { phoneTail9, groupByBranch, headlineProperty } from './lib/property-branches.mjs'

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
// --refresh re-reads branches Pedro ALREADY has and rewrites the saved facts.
// Needed because those facts are not a display detail: the live AI coach reads
// offer_open, offer_ceiling and offer_ladder off the contact, so a valuation
// that arrives (or a maths fix) after the branch was queued never reaches the
// call unless something rewrites them. Without this the only way to correct a
// queued branch is to unpick it by hand.
const REFRESH = process.argv.includes('--refresh')
const SETUP_ONLY = process.argv.includes('--setup-only')
const PURSUE_ONLY = process.argv.includes('--pursue-only')
const MAX_BRANCHES = parseInt(arg('branches', '25'), 10)
// Which properties to hand over. Default is fresh ones: sent by the scraper and
// never called.
//
// The other useful value is `callback`. In June the AI rang 26 properties and
// 13 of them said call back, and nothing ever did. Those are the warmest thing
// in the table, so:
//   node scripts/assign-properties-to-pedro-houses.mjs --status=callback --apply
const STATUSES = arg('status', 'new,call_queued').split(',').map((s) => s.trim()).filter(Boolean)

// ── Fixed configuration ────────────────────────────────────────────────────
const AGENT = {
  // ONE address for login, sending and receiving: pedro@hostunico.com. It was
  // pedro@unicohost.com for a few hours on 2026-08-10 until Hugo tried to sign
  // in with the EMAIL address and hit invalid credentials; two identities one
  // letter apart is a trap, so the login was changed to match the mailbox
  // (hostunico.com is the domain we control and the one Resend sends from).
  // It has to match the auth account, or this script finds nobody and creates
  // a duplicate agent: the campaign, the number pin and the queue all hang off
  // the existing id, so a twin would leave Pedro logging in to an empty room.
  email: 'pedro@hostunico.com',
  name: 'Pedro Houses',
  // Property negotiations run long, so the plumber default of £10/day is low.
  dailyLimitPence: 3000,
}
const CAMPAIGN_NAME = 'Houses - Pedro'
const PIPELINE_ID = 'c2022b21-7a79-4203-90dd-5b06b46eef11'   // Default workspace pipeline
// Hugo, 2026-08-09: share Pedro's existing plumber number rather than buy one.
// The campaign pin is checked FIRST in wk-calls-create's caller-ID resolution,
// so this works without changing who owns the number.
const CALLER_ID_NUMBER_ID = '1a04cead-c768-46f4-8434-3ef94de7b6e3'   // +447462167894

const money = (n) => {
  const v = parseFloat(String(n ?? ''))
  return Number.isFinite(v) && v > 0 ? `£${Math.round(v).toLocaleString('en-GB')}` : '-'
}
const say = (...a) => console.log(...a)

// ── 1. The agent ───────────────────────────────────────────────────────────
//
// NOT through the wk-create-agent edge function. That function has no "this
// email already belongs to someone" branch: on a collision it rotates the
// existing user's password and overwrites their name and role, which would lock
// a real agent out of their account with no warning. This refuses instead.
async function ensureAgent() {
  const { data: existingProfile } = await db
    .from('profiles').select('id, name, email, workspace_role')
    .ilike('email', AGENT.email).maybeSingle()

  if (existingProfile) {
    say(`  agent: already exists (${existingProfile.name}, ${existingProfile.id})`)
    return existingProfile.id
  }

  if (!APPLY) {
    say(`  agent: WOULD CREATE ${AGENT.name} <${AGENT.email}>`)
    return null
  }

  // Belt and braces: an auth user can exist without a profiles row.
  const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const clash = (list?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === AGENT.email)
  if (clash) {
    throw new Error(
      `auth user ${AGENT.email} already exists (${clash.id}) with no profile row. ` +
      'Refusing to touch it: resolve by hand rather than risk resetting a real account.',
    )
  }

  const password = `Houses-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36).slice(-4)}`
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email: AGENT.email, password, email_confirm: true,
  })
  if (cErr) throw new Error(`createUser: ${cErr.message}`)
  const id = created.user.id

  const { error: pErr } = await db.from('profiles').upsert({
    id, email: AGENT.email, name: AGENT.name,
    workspace_role: 'agent', agent_status: 'offline',
  }, { onConflict: 'id' })
  if (pErr) throw new Error(`profiles: ${pErr.message}`)

  const { error: lErr } = await db.from('wk_voice_agent_limits').upsert({
    agent_id: id, daily_limit_pence: AGENT.dailyLimitPence, daily_spend_pence: 0,
    is_admin: false, show_on_leaderboard: true,
  }, { onConflict: 'agent_id' })
  if (lErr) throw new Error(`wk_voice_agent_limits: ${lErr.message}`)

  say(`  agent: CREATED ${AGENT.name} (${id})`)
  say('')
  say('  ┌──────────────────────────────────────────────────────────┐')
  say(`  │  LOGIN   ${AGENT.email}`)
  say(`  │  PASS    ${password}`)
  say('  │  Give these to Pedro. They are shown once, here, only.    │')
  say('  └──────────────────────────────────────────────────────────┘')
  say('')
  return id
}

// ── 2. The campaign ────────────────────────────────────────────────────────
async function ensureCampaign(agentId) {
  const { data: existing } = await db
    .from('wk_dialer_campaigns').select('id, name')
    .eq('name', CAMPAIGN_NAME).maybeSingle()

  let campaignId = existing?.id ?? null
  if (campaignId) {
    say(`  campaign: reusing "${CAMPAIGN_NAME}" (${campaignId})`)
  } else if (!APPLY) {
    say(`  campaign: WOULD CREATE "${CAMPAIGN_NAME}"`)
    return null
  } else {
    const { data, error } = await db.from('wk_dialer_campaigns').insert({
      name: CAMPAIGN_NAME, pipeline_id: PIPELINE_ID,
      parallel_lines: 1, is_active: true, created_by: agentId,
    }).select('id').single()
    if (error) throw new Error(`campaign: ${error.message}`)
    campaignId = data.id
    say(`  campaign: CREATED "${CAMPAIGN_NAME}" (${campaignId})`)
  }

  if (!APPLY || !agentId) return campaignId

  // Without this link the campaign does not appear in the agent's dropdown at
  // all, and the whole queue is invisible to him.
  await db.from('wk_campaign_agents')
    .upsert({ campaign_id: campaignId, agent_id: agentId, role: 'agent' },
            { onConflict: 'campaign_id,agent_id' })

  const { data: numLink } = await db.from('wk_campaign_numbers')
    .select('id').eq('campaign_id', campaignId).eq('number_id', CALLER_ID_NUMBER_ID).maybeSingle()
  if (!numLink) {
    await db.from('wk_campaign_numbers')
      .insert({ campaign_id: campaignId, number_id: CALLER_ID_NUMBER_ID, priority: 0 })
  }
  say('  campaign: agent linked, caller ID pinned')
  return campaignId
}

// ── 3. The properties ──────────────────────────────────────────────────────
async function loadProperties() {
  // PostgREST caps a response at 1000 rows and does it SILENTLY, which is
  // documented the hard way at assign-agent-batches.mjs:274-277.
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = db.from('brrr_properties')
      .select('id, address, agent_phone, agent_name, asking_price, price_text, bedrooms, property_type, days_on_market, deal, status, call_channel, created_at, listing_url')
    // Normally only branches nobody has taken. Under --refresh, the ones Pedro
    // already holds, so their saved figures can be rewritten in place.
    q = REFRESH ? q.eq('call_channel', 'human') : q.eq('call_channel', 'ai')
    const { data, error } = await q
      .not('agent_phone', 'is', null)
      .in('status', STATUSES)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`load: ${error.message}`)
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return all
}

/** The facts the SCRIPT and the COACH both read off the contact. Mirrors
 *  scriptTokensFor() in src/features/crm/hooks/usePropertyListings.ts — the
 *  dialer refreshes these when the agent switches property mid-call, this sets
 *  the opening state. */
function factsFor(branch, headline, settings) {
  const deal = headline.deal ?? {}
  const num = (v) => { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }
  const lowPct = settings.offer_low_pct ?? 70
  const highPct = settings.offer_high_pct ?? 75

  // valuation.py NESTS its answer: deal.offer = { open, max, ladder, flags },
  // deal.cmv = { estimate, confidence, ... }. The old browser Comps page
  // flattened it to deal.offer_min / offer_max before posting, so both shapes
  // exist in the wild and both must be read. Reading only the flat ones put
  // 157 branches in Pedro's queue quoting 70-75% of the ASKING PRICE with a
  // real valuation sitting underneath, and, because these same fields are what
  // the live AI coach reads, it would have coached him to walk away GBP 4,650
  // below the true ceiling. Nothing errored. It just quietly used the fallback.
  // Kept in step with offerRange() in api/lib/brrr-offer.ts, which this file
  // cannot import (it is .ts, this is a plain .mjs script).
  const offer = (deal.offer && typeof deal.offer === 'object') ? deal.offer : {}
  const cmvObj = (deal.cmv && typeof deal.cmv === 'object') ? deal.cmv : null
  const cmv = cmvObj ? num(cmvObj.estimate) : num(deal.cmv)
  const cmvConf = cmvObj ? cmvObj.confidence : deal.cmv_confidence

  const engineMax = num(offer.max) || num(deal.offer_max) || num(deal.offer_price)
  const max = engineMax > 0 ? engineMax : Math.round(num(headline.asking_price) * highPct / 100)
  const minRaw = engineMax > 0
    ? (num(offer.open) || num(deal.offer_min))
    : Math.round(num(headline.asking_price) * lowPct / 100)
  const min = minRaw > 0 && minRaw <= max ? minRaw : max
  const ladderSrc = Array.isArray(offer.ladder) ? offer.ladder : deal.ladder
  const ladder = Array.isArray(ladderSrc) ? ladderSrc.map(num).filter((n) => n > 0) : []
  // The engine reports its reservations on the offer, plus any top-level
  // warnings. Both matter to Pedro: "suspiciously_cheap_asking" is exactly the
  // sort of thing to know before he opens his mouth.
  const notes = [
    ...(Array.isArray(offer.flags) ? offer.flags : []),
    ...(Array.isArray(deal.warnings) ? deal.warnings : []),
    ...(Array.isArray(deal.flags) ? deal.flags : []),
  ].filter(Boolean)
  const addr = headline.address ?? ''

  return {
    lead_type: 'estate_agent',
    agency: branch.agency,
    property_address: addr,
    property_street: addr.split(',')[0]?.trim() || addr,
    property_url: headline.listing_url ?? '',
    asking_price: headline.price_text || money(headline.asking_price),
    bedrooms: headline.bedrooms != null ? String(headline.bedrooms) : '',
    property_type: (headline.property_type ?? '').toLowerCase(),
    days_on_market: headline.days_on_market ?? '',
    property_worth: cmv > 0
      ? `${money(cmv)}${cmvConf ? ` (${cmvConf} confidence)` : ''}`
      : 'not established',
    offer_open: money(min),
    offer_ceiling: money(max),
    offer_ladder: ladder.length > 1 ? ladder.map(money).join(', then ') : `${money(min)}, up to ${money(max)}`,
    // No distance in this sentence. cmv.ring_used is the engine's ring INDEX,
    // not a number of metres, and "4 sold comparables within 1m" is a line
    // Pedro would read out to an estate agent.
    comp_evidence: cmvObj && num(cmvObj.n_used) > 0
      ? `${cmvObj.n_used} sold comparables nearby put it at ${money(cmv)}`
      : (Array.isArray(deal.evidence) && deal.evidence.length
        ? deal.evidence.slice(0, 3).join(' · ') : 'no sold comparables on file'),
    valuation_notes: notes.length ? notes.join(', ') : 'nothing unusual flagged',
    properties_count: String(branch.properties.length),
  }
}

async function main() {
  say('')
  say(`Houses for Pedro  ${APPLY ? '*** APPLY ***' : '(dry run, nothing will be written)'}`)
  say('─'.repeat(64))

  const agentId = await ensureAgent()
  const campaignId = await ensureCampaign(agentId)
  if (SETUP_ONLY) { say('\n--setup-only: stopping before any lead is queued.\n'); return }
  if (!agentId || !campaignId) {
    say('\nDry run: agent and campaign do not exist yet, so lead counts below are indicative.\n')
  }

  const { data: sRow } = await db.from('platform_settings').select('value').eq('key', 'brrr_settings').maybeSingle()
  let settings = {}
  try { settings = sRow?.value ? JSON.parse(sRow.value) : {} } catch { settings = {} }

  const properties = await loadProperties()
  const usable = PURSUE_ONLY
    ? properties.filter((p) => p.deal?.pursue === true || p.deal?.pursue === 'true')
    : properties
  const branches = groupByBranch(usable).slice(0, MAX_BRANCHES)

  say('')
  say(`  status filter        : ${STATUSES.join(', ')}`)
  say(`  properties available : ${properties.length}${PURSUE_ONLY ? ` (${usable.length} after --pursue-only)` : ''}`)
  say(`  branches behind them : ${groupByBranch(usable).length}`)
  say(`  taking               : ${branches.length} (--branches=${MAX_BRANCHES})`)
  if (groupByBranch(usable).length > branches.length) {
    say(`  NOT taking           : ${groupByBranch(usable).length - branches.length} branches left for a later run`)
  }
  say('')

  let queued = 0, skippedOwned = 0, propsFlipped = 0
  const maxPriority = await currentMaxPriority(campaignId)

  for (const [i, branch] of branches.entries()) {
    const headline = headlineProperty(branch.properties)
    const facts = factsFor(branch, headline, settings)
    const label = `${branch.agency} (${branch.phone})`

    if (!APPLY) {
      say(`  ${String(i + 1).padStart(3)}. ${label}`)
      say(`       ${branch.properties.length} listing(s), open at ${facts.offer_open}, ceiling ${facts.offer_ceiling}`)
      say(`       headline: ${facts.property_address}`)
      continue
    }

    // Upsert by phone with ignoreDuplicates: wk_contacts.phone is globally
    // UNIQUE, so a plain upsert would OVERWRITE somebody else's lead if an
    // estate agency number is already in the CRM. Never do that.
    await db.from('wk_contacts').upsert({
      name: branch.agency, phone: branch.phone,
      owner_agent_id: agentId, custom_fields: facts, is_hot: false,
    }, { onConflict: 'phone', ignoreDuplicates: true })

    const { data: contact } = await db.from('wk_contacts')
      .select('id, owner_agent_id').eq('phone', branch.phone).maybeSingle()
    if (!contact) { say(`  SKIP ${label}: contact could not be resolved`); continue }

    // Second pass, scoped to rows we own. If this number already belonged to
    // another agent's lead we leave it entirely alone and say so, rather than
    // stealing it and permanently locking one of them out via
    // wk_contact_locked_agent (which has no unlock).
    if (contact.owner_agent_id !== agentId) {
      skippedOwned++
      say(`  SKIP ${label}: already owned by another agent (${contact.owner_agent_id})`)
      continue
    }
    await db.from('wk_contacts')
      .update({ custom_fields: facts })
      .eq('id', contact.id).eq('owner_agent_id', agentId)

    // The whole branch moves to human, never one property: the AI must not ring
    // this office about a different listing.
    const { count } = await db.from('brrr_properties')
      .update({ call_channel: 'human', human_agent_id: agentId, wk_contact_id: contact.id },
               { count: 'exact' })
      .in('id', branch.properties.map((p) => p.id))
    propsFlipped += count ?? branch.properties.length

    // Stack above whatever is already queued, so an existing queue order is
    // untouched and the biggest branches come first.
    const { data: already } = await db.from('wk_dialer_queue')
      .select('id').eq('campaign_id', campaignId).eq('contact_id', contact.id)
      .in('status', ['pending', 'dialing']).limit(1)
    if (already && already.length) { say(`  SKIP ${label}: already in the queue`); continue }

    await db.from('wk_dialer_queue').insert({
      campaign_id: campaignId, contact_id: contact.id,
      status: 'pending', priority: maxPriority + (branches.length - i),
    })
    queued++
    say(`  ${String(i + 1).padStart(3)}. ${label} — ${branch.properties.length} listing(s), queued`)
  }

  say('')
  say('─'.repeat(64))
  if (APPLY) {
    say(`  branches queued        : ${queued}`)
    say(`  properties -> human    : ${propsFlipped}`)
    if (skippedOwned) say(`  skipped, owned by others: ${skippedOwned}`)
    say('')
    say('  Pedro: /admin/crm/dialer-pro?script=property_call')
  } else {
    say('  Dry run. Nothing written. Add --apply to do it for real.')
  }
  say('')
}

async function currentMaxPriority(campaignId) {
  if (!campaignId) return 0
  const { data } = await db.from('wk_dialer_queue')
    .select('priority').eq('campaign_id', campaignId)
    .order('priority', { ascending: false }).limit(1)
  return data?.[0]?.priority ?? 0
}

// Two things this deliberately does NOT do, both of which its sibling scripts DO:
//
//   isTextableUkMobile  — estate agency switchboards are landlines (01/02).
//                         Copying that filter across would silently drop 100%
//                         of the input and look like "no properties found".
//   dropDeadNumbers     — the paid Twilio line_status screen is a MOBILE
//                         subscription check. On a landline it returns unknown
//                         and fails open anyway, so it would bill £5.29 per
//                         1,000 to learn nothing. The cron's 30-minute
//                         same-branch spacing is the real protection here.

main().catch((e) => { console.error('\nFAILED:', e.message, '\n'); process.exit(1) })

export { phoneTail9 }
