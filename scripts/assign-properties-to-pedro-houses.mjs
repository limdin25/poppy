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
 * A BRANCH THAT HAS BEEN CALLED IS NEVER DEALT AGAIN unless you ask for it.
 * See scripts/lib/redial-policy.mjs for why, and for what --redial-unanswered
 * and --redial-all do.
 *
 * Usage:
 *   node scripts/assign-properties-to-pedro-houses.mjs               # dry run
 *   node scripts/assign-properties-to-pedro-houses.mjs --apply
 *   node scripts/assign-properties-to-pedro-houses.mjs --branches=5 --apply
 *   node scripts/assign-properties-to-pedro-houses.mjs --pursue-only --apply
 *   node scripts/assign-properties-to-pedro-houses.mjs --setup-only --apply
 *
 * Give him back the offices that never picked up, and only those, behind
 * everything he has not touched yet:
 *   node scripts/assign-properties-to-pedro-houses.mjs --refresh --redial-unanswered --apply
 *
 * DRY BY DEFAULT. Without --apply nothing is written and nothing is charged:
 * unlike the trade-lead scripts there is no paid screen in here at all (see
 * "Two things this deliberately does NOT do" below).
 *
 * --setup-only creates the agent and the campaign and stops, so the login can
 * be handed over before any lead is queued.
 */

import { createClient } from '@supabase/supabase-js'
import { compEvidenceSentence } from './lib/comp-evidence.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { phoneTail9, groupByBranch, headlineProperty } from './lib/property-branches.mjs'
import { decideRedial, redialModeFromArgv, REDIAL_MIN_GAP_HOURS, NOBODY_ANSWERED } from './lib/redial-policy.mjs'
import { meetsEvidenceStandard, belowStandardByTier } from './lib/evidence-standard.mjs'

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
// --review is the raw data command center (Hugo, 2026-08-19: "everything now
// hits a dedicated raw data tab in the CRM first"). Queue rows are written
// with status 'review', which the dialer never selects, and the headline
// house's display payload is upserted into wk_raw_leads. Hugo's press on
// /admin/crm/raw-leads flips review to pending. Without --review the script
// behaves exactly as it always did.
const REVIEW = process.argv.includes('--review')
// --refresh re-reads branches Pedro ALREADY has and rewrites the saved facts.
// Needed because those facts are not a display detail: the live AI coach reads
// offer_open, offer_ceiling and ladder off the contact, so a valuation
// that arrives (or a maths fix) after the branch was queued never reaches the
// call unless something rewrites them. Without this the only way to correct a
// queued branch is to unpick it by hand.
const REFRESH = process.argv.includes('--refresh')
// Whether an already-called branch may be dealt back onto the queue:
//
//   (nothing)             never. The default, and what --refresh does.
//   --redial-unanswered   only the offices nobody picked up, and only after
//                         REDIAL_MIN_GAP_HOURS, behind everything untouched.
//   --redial-all          every branch he holds, warts and all.
//
// --unanswered-only is the old spelling of --redial-unanswered and still works.
// The rules and the reasoning live in scripts/lib/redial-policy.mjs.
//
// The test is the OUTCOME he pressed, not the length of the call. A duration
// rule looked tempting and is wrong on both of its edge cases here:
// Purplebricks ran 210 seconds and every one of them was hold music, and the
// Bridgfords call ran 217 seconds and the transcript simply stops mid-question
// because the line dropped. Both of those deserve another ring; a "longer than
// two minutes means they spoke" rule would have buried them.
const REDIAL = redialModeFromArgv(process.argv)
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

// How far under its like-for-like local sold median a house must be advertised
// before it is worth a call. THE SAME VALUE AS send_to_elsie.MIN_LOCAL_DISCOUNT
// on the engine, and it is written here as well ON PURPOSE: this script queues
// from rows that engine may never have judged, so it cannot inherit the rule by
// assuming everything upstream was screened. See the gate below.
// RAISED 0.15 -> 0.20 on 2026-08-19, Hugo: "move from a 10% minimum discount
// to a 20% minimum discount right from the jump. No filler, just high
// conviction deals."
const MIN_LOCAL_DISCOUNT = 0.20

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
    // Normally only branches nobody has taken. Under --refresh, EVERYTHING:
    // the branches Pedro holds so their saved figures can be rewritten, AND
    // the untouched ones so tonight's scrape reaches him.
    //
    // --refresh used to load `human` INSTEAD of `ai`, which made the overnight
    // machine (whose only assign step is `--refresh --apply`) structurally
    // incapable of queueing a branch it had never seen. Every house the night
    // scraped sat at call_channel='ai' waiting for somebody to run the script
    // by hand. Nobody noticed because it was hand-run all week.
    if (!REFRESH) q = q.eq('call_channel', 'ai')
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


/** phone -> { lastCallAt, lastOutcome } for the MOST RECENT outbound call to
 *  that branch. Empty for a branch nobody has rung. lastOutcome is null when the
 *  call happened and no outcome was pressed at all (16 of Pedro's 55 calls on
 *  day one), which counts as unanswered because nothing says otherwise.
 *
 *  Deliberately NOT scoped to one agent: the office does not care which of us
 *  rang it. Outbound only, so a branch ringing US back never blocks the queue.
 *
 *  This is read on EVERY run now, not just under a redial flag. It is the thing
 *  that stops Pedro being handed a branch he has just finished with. */
async function callHistoryByPhone(phones) {
  const out = new Map()
  if (phones.length === 0) return out

  const contacts = []
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await db.from('wk_contacts').select('id, phone').in('phone', phones.slice(i, i + 200))
    contacts.push(...(data ?? []))
  }
  if (contacts.length === 0) return out
  const phoneOf = new Map(contacts.map((c) => [c.id, c.phone]))

  const { data: cols } = await db.from('wk_pipeline_columns').select('id, name')
  const colName = new Map((cols ?? []).map((c) => [c.id, c.name]))

  const ids = contacts.map((c) => c.id)
  const calls = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('wk_calls')
      .select('contact_id, disposition_column_id, started_at')
      .eq('direction', 'outbound')
      .in('contact_id', ids.slice(i, i + 200))
      .order('started_at', { ascending: false })
    calls.push(...(data ?? []))
  }
  // Ordered newest first, so the first row seen for a contact is its last call.
  //
  // The SILENT TRIES are counted across every call to the branch, not just the
  // last one, because that is what the voicemail cadence runs on: three daily
  // attempts and then weekly. An office rung five times without ever answering
  // must not keep a daily slot in front of offices nobody has tried at all.
  for (const c of calls) {
    const phone = phoneOf.get(c.contact_id)
    if (!phone) continue
    const outcome = c.disposition_column_id ? colName.get(c.disposition_column_id) ?? null : null
    const existing = out.get(phone)
    // A call with no outcome pressed counts as unanswered: nothing says
    // otherwise, and that is the same reading decideRedial already takes.
    const silent = !outcome || NOBODY_ANSWERED.has(outcome)
    if (!existing) {
      out.set(phone, {
        lastCallAt: c.started_at ?? null,
        lastOutcome: outcome,
        unansweredAttempts: silent ? 1 : 0,
      })
    } else if (silent) {
      existing.unansweredAttempts += 1
    }
  }
  return out
}

/** The facts the SCRIPT and the COACH both read off the contact. Mirrors
 *  scriptTokensFor() in src/features/crm/hooks/usePropertyListings.ts — the
 *  dialer refreshes these when the agent switches property mid-call, this sets
 *  the opening state. */
function factsFor(branch, headline, _settings) {
  // _settings kept for the callers' sake; the %-of-asking knobs it carried
  // are dead (16 Aug), the band is engine-only now.
  const deal = headline.deal ?? {}
  const num = (v) => { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }

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

  // THE %-OF-ASKING FALLBACK IS DEAD (16 Aug, same cut as offerRange in
  // api/lib/brrr-offer.ts). No engine band means max = 0, the money tokens
  // below are written EMPTY, and the coach and the script skip blanks. A
  // fabricated band read down the phone is worse than no figure at all.
  const engineMax = num(offer.max) || num(offer.ceiling) || num(deal.offer_max) || num(deal.offer_price)
  const max = engineMax
  const minRaw = num(offer.open) || num(deal.offer_min)
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
    // The second brain's reservations (deal_auditor.py on the VPS). A killed
    // deal is never ingested at all; these are the pass-with-reservations.
    ...(deal.audit && Array.isArray(deal.audit.reasons) ? deal.audit.reasons : []),
  ].filter(Boolean)
  // What it is worth with the extra bedroom: the engine's GDV, the comps
  // pipeline run again over beds+1 sales. The buying thesis in one number,
  // and until 2026-08-11 it never reached the contact.
  const gdvObj = (deal.gdv && typeof deal.gdv === 'object') ? deal.gdv : null
  const gdv = gdvObj ? num(gdvObj.estimate) : num(deal.gdv)
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
    worth_after_bed: gdv > 0
      ? `${money(gdv)} as a ${(parseInt(String(headline.bedrooms ?? ''), 10) || 0) + 1} bed`
      : 'not established',
    // Empty when there is no engine band, never a fabricated figure. The key
    // is `ladder`, the ONE ladder key (16 Aug): the dialer writes `ladder`,
    // the script templates read [ladder], and the coach prefers it.
    offer_open: min > 0 ? money(min) : '',
    offer_ceiling: max > 0 ? money(max) : '',
    ladder: max > 0
      ? (ladder.length > 1 ? ladder.map(money).join(', then ') : `${money(min)}, up to ${money(max)}`)
      : '',
    // ONE renderer, in scripts/lib/comp-evidence.mjs. The engine moved
    // deal.evidence from sentences to comp ROWS, and the .join() that used to
    // live here printed "[object Object] · [object Object]" onto the contact,
    // into a SCRIPT TOKEN, on its way to being read down the phone. It does not
    // throw, which is why it survived two days on a live board.
    comp_evidence: compEvidenceSentence(deal),
    valuation_notes: notes.length ? notes.join(', ') : 'nothing unusual flagged',
    properties_count: String(branch.properties.length),
    // What to do with this one next. Every branch arriving here is at step 1 of
    // the deal process by definition: nobody has rung it yet. The dialer, the
    // offer strip and the pipeline card all read this field and show the step
    // (Hugo 2026-08-12). The tag string must match a tag in
    // src/features/crm/components/templates/dealProcessSteps.ts, which
    // tests/property-deal-process.test.ts pins.
    //
    // Only ever set on a NEW branch or a --refresh. It is not a status field
    // and nothing here advances it: api/crm/property-outcome.ts moves it on
    // when Pedro presses an outcome, and the send box moves it on when an offer
    // email goes out.
    next_step: 'Discovery call',
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
  const pursued = PURSUE_ONLY
    ? properties.filter((p) => p.deal?.pursue === true || p.deal?.pursue === 'true')
    : properties
  // Only gold and strong evidence reaches him. See meetsEvidenceStandard above.
  const withEvidence = pursued.filter(meetsEvidenceStandard)
  const belowStandard = pursued.length - withEvidence.length
  if (belowStandard > 0) {
    const tiers = belowStandardByTier(pursued)
    say(`  evidence standard    : ${belowStandard} listing(s) held back, below gold/strong `
      + `(${Object.entries(tiers).map(([t, n]) => `${n} ${t}`).join(', ')})`)
  }

  // THE DISCOUNT, RE-CHECKED AT THE LAST GATE BEFORE PEDRO SEES IT.
  //
  // Hugo, 2026-08-16, having found three houses in the dialer at 10.5%, 6.7%
  // and 3.0% under their like-for-like local median against a rule of 15%:
  // "make sure this never ever happens again."
  //
  // The engine's own gate (send_to_elsie.MIN_LOCAL_DISCOUNT) is correct and
  // refuses exactly these. But it only guards the moment of PUSHING, and this
  // script queues from `brrr_properties`, which still holds rows written
  // BEFORE that gate existed on 2026-08-15. A rule added at the front door did
  // nothing about what was already inside, and this script had no discount
  // check of its own at all.
  //
  // So the measured number now travels on the deal blob and is re-checked
  // here. A MISSING stamp is a REFUSAL, not a pass: unverified is not the same
  // as fine, and treating it as fine is precisely how those three got in. The
  // historical rows stay out until something measures them, which is the
  // intended outcome rather than a side effect.
  const usable = withEvidence.filter((p) => {
    const d = Number(p.deal?.local_discount_pct)
    return Number.isFinite(d) && d >= MIN_LOCAL_DISCOUNT
  })
  const belowDiscount = withEvidence.length - usable.length
  if (belowDiscount > 0) {
    const unmeasured = withEvidence.filter(
      (p) => !Number.isFinite(Number(p.deal?.local_discount_pct))).length
    say(`  discount rule        : ${belowDiscount} listing(s) held back `
      + `(${unmeasured} never measured, ${belowDiscount - unmeasured} under `
      + `${Math.round(MIN_LOCAL_DISCOUNT * 100)}% of their like-for-like local median)`)
  }
  const allBranches = groupByBranch(usable)

  // Who has already been rung, and what they said. Read every run: a branch
  // Pedro has worked is held back by default, and only a --redial flag can
  // deal it again. Before this, the ONLY guard was "is there a pending queue
  // row", which is false the moment he finishes a call, so a re-run handed him
  // back exactly the offices he had just done.
  const nowMs = Date.now()
  const history = await callHistoryByPhone(allBranches.map((b) => b.phone))
  const decided = allBranches.map((b) => ({
    branch: b,
    ...decideRedial({
      ...(history.get(b.phone) ?? {}),
      // Newest CALLABLE listing: loadProperties has already dropped anything
      // the auditor killed, so a dead deal filed tonight cannot reopen an
      // office.
      newestListedAt: b.properties.map((p) => p.created_at ?? '').sort().slice(-1)[0] || null,
      mode: REDIAL,
      nowMs,
    }),
  }))
  const eligible = decided.filter((d) => d.queue)
  // Called already and not due a redial. Under --refresh their saved figures
  // are still rewritten and any new listing is still filed against them; what
  // they do not get is a place in the queue.
  const heldBack = decided.filter((d) => !d.queue)
  const branches = eligible.slice(0, MAX_BRANCHES)

  say('')
  say(`  status filter        : ${STATUSES.join(', ')}`)
  say(`  properties available : ${properties.length}${PURSUE_ONLY ? ` (${usable.length} after --pursue-only)` : ''}`)
  say(`  branches behind them : ${allBranches.length}`)
  say(`  redial policy        : ${REDIAL === 'never'
    ? 'a branch that has been called is not dealt again'
    : REDIAL === 'unanswered'
      ? `re-deal the no-answers only, after ${REDIAL_MIN_GAP_HOURS}h, at the back`
      : 're-deal EVERY branch he holds (--redial-all)'}`)
  say(`  held back, called already: ${heldBack.length}${heldBack.length ? ` (${heldBack.slice(0, 4).map((d) => `${d.branch.agency}: ${d.reason}`).join('; ')}${heldBack.length > 4 ? '; ...' : ''})` : ''}`)
  say(`  queueable            : ${eligible.length}`)
  say(`  taking               : ${branches.length} (--branches=${MAX_BRANCHES})`)
  if (eligible.length > branches.length) {
    say(`  NOT taking           : ${eligible.length - branches.length} branches left for a later run`)
  }
  say('')

  let queued = 0, skippedOwned = 0, propsFlipped = 0, refreshedOnly = 0
  const maxPriority = await currentMaxPriority(campaignId)
  // A redial goes BEHIND everything still waiting. The picker takes the highest
  // priority first, so stacking a second attempt on top (which is what happened
  // all day on 2026-08-11) buries 58 offices nobody has ever rung.
  const minPriority = await currentMinPendingPriority(campaignId)

  for (const [i, { branch, back, reason }] of branches.entries()) {
    const headline = headlineProperty(branch.properties)
    const facts = factsFor(branch, headline, settings)
    const label = `${branch.agency} (${branch.phone})`

    if (!APPLY) {
      say(`  ${String(i + 1).padStart(3)}. ${label}${back ? '  [REDIAL, to the back]' : ''}`)
      say(`       ${branch.properties.length} listing(s), open at ${facts.offer_open}, ceiling ${facts.offer_ceiling}`)
      say(`       headline: ${facts.property_address}`)
      if (back) say(`       ${reason}`)
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
    // Same rule as the held-back branch below: the facts refresh, the step
    // does not rewind. A branch already at "Confirm the numbers" stays there.
    const { data: prevRow } = await db.from('wk_contacts')
      .select('custom_fields').eq('id', contact.id).maybeSingle()
    const prevStep = prevRow?.custom_fields?.next_step
    await db.from('wk_contacts')
      .update({ custom_fields: prevStep ? { ...facts, next_step: prevStep } : facts })
      .eq('id', contact.id).eq('owner_agent_id', agentId)

    // The whole branch moves to human, never one property: the AI must not ring
    // this office about a different listing.
    const { count } = await db.from('brrr_properties')
      .update({ call_channel: 'human', human_agent_id: agentId, wk_contact_id: contact.id },
               { count: 'exact' })
      .in('id', branch.properties.map((p) => p.id))
    propsFlipped += count ?? branch.properties.length

    // A fresh branch stacks above whatever is already queued, so the biggest
    // branches come first. A redial goes underneath the lot.
    const { data: already } = await db.from('wk_dialer_queue')
      .select('id').eq('campaign_id', campaignId).eq('contact_id', contact.id)
      .in('status', ['pending', 'dialing', 'review']).limit(1)
    if (already && already.length) { say(`  SKIP ${label}: already in the queue`); continue }

    await db.from('wk_dialer_queue').insert({
      campaign_id: campaignId, contact_id: contact.id,
      status: REVIEW ? 'review' : 'pending',
      priority: back ? minPriority - 1 - i : maxPriority + (branches.length - i),
    })

    if (REVIEW) {
      // The raw tab's display row for the branch's headline house. Every
      // figure is READ off the engine's deal: band from offer.open/max,
      // evidence comps from reprice.evidence. The discount vs sold prices is
      // the same arithmetic the card badge already does on engine numbers.
      const h = headlineProperty(branch.properties)
      const deal = h?.deal ?? {}
      const offer = deal.offer ?? {}
      const evidence = (deal.reprice?.evidence ?? []).slice(0, 3).map((e) => ({
        price: e.price ?? null,
        distance_m: e.distance_m ?? null,
        date: e.date ?? null,
        address: e.address ?? null,
      }))
      const soldPrices = (deal.reprice?.evidence ?? [])
        .map((e) => Number(e.price)).filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b)
      const soldMedian = soldPrices.length
        ? (soldPrices.length % 2
          ? soldPrices[(soldPrices.length - 1) / 2]
          : (soldPrices[soldPrices.length / 2 - 1] + soldPrices[soldPrices.length / 2]) / 2)
        : null
      const { error: rawErr } = await db.from('wk_raw_leads').upsert({
        property_id: `brrr:${h.id}`,
        contact_id: contact.id,
        kind: 'priced',
        address: h.address ?? null,
        outcode: String(h.address ?? '').match(/\b([A-Z]{1,2}\d[A-Z0-9]?)\s*\d[A-Z]{2}\b/i)?.[1]?.toUpperCase() ?? null,
        asking_price: h.asking_price ?? null,
        discount: soldMedian && h.asking_price ? Number((1 - h.asking_price / soldMedian).toFixed(4)) : null,
        band_min: offer.open ?? null,
        band_max: offer.max ?? null,
        comps: evidence,
        floorplans: [],
        url: h.listing_url ?? null,
        bedrooms: h.bedrooms ?? null,
        property_type: h.property_type ?? null,
        agent_name: branch.agency ?? null,
        days_on_market: Number(h.days_on_market) || null,
        scraped_at: h.created_at ?? null,
        status: 'pending_review',
      }, { onConflict: 'property_id' })
      if (rawErr) say(`  raw-lead upsert failed for ${label}: ${rawErr.message}`)
    }
    queued++
    say(`  ${String(i + 1).padStart(3)}. ${label} — ${branch.properties.length} listing(s), queued${back ? ` at the back (${reason})` : ''}`)
  }

  // The branches he has already worked. No queue row, ever, on this path: the
  // point is that the facts and the listings stay current on a branch he holds
  // WITHOUT the branch being dealt back to him.
  if (APPLY) {
    for (const { branch, reason } of heldBack) {
      const { data: contact } = await db.from('wk_contacts')
        .select('id, owner_agent_id').eq('phone', branch.phone).maybeSingle()
      if (!contact || contact.owner_agent_id !== agentId) continue
      // Facts only under --refresh. On a normal run this branch's rows are the
      // NEW listings alone, so recomputing the headline from them would throw
      // away a better house the branch already had on file.
      if (REFRESH) {
        const facts = factsFor(branch, headlineProperty(branch.properties), settings)
        // A refresh rewrites the FACTS. It must not rewind the deal: a branch
        // Pedro has already worked may be on "Confirm the numbers" or further,
        // and putting it back to "Discovery call" would tell him to ring a
        // branch he has rung (Hugo 2026-08-12).
        const { data: prev } = await db.from('wk_contacts')
          .select('custom_fields').eq('id', contact.id).maybeSingle()
        const prevStep = prev?.custom_fields?.next_step
        if (prevStep) facts.next_step = prevStep
        await db.from('wk_contacts').update({ custom_fields: facts })
          .eq('id', contact.id).eq('owner_agent_id', agentId)
      }
      const { count } = await db.from('brrr_properties')
        .update({ call_channel: 'human', human_agent_id: agentId, wk_contact_id: contact.id },
                 { count: 'exact' })
        .in('id', branch.properties.map((p) => p.id))
      propsFlipped += count ?? 0
      refreshedOnly++
      say(`  held  ${branch.agency} — ${REFRESH ? 'facts refreshed' : 'listings filed'}, not queued (${reason})`)
    }
  }

  say('')
  say('─'.repeat(64))
  if (APPLY) {
    say(`  branches queued        : ${queued}`)
    say(`  held back, not queued  : ${heldBack.length} (${refreshedOnly} ${REFRESH ? 'had their figures refreshed' : 'had new listings filed'})`)
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

/** The bottom of the LIVE queue, so a redial lands under every branch still
 *  waiting. Rows already dialled are ignored: their priorities are history and
 *  counting them would drag each night's redials further into the negatives. */
async function currentMinPendingPriority(campaignId) {
  if (!campaignId) return 0
  const { data } = await db.from('wk_dialer_queue')
    .select('priority').eq('campaign_id', campaignId).eq('status', 'pending')
    .order('priority', { ascending: true }).limit(1)
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
