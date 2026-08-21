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
import { decideRedial, listedAtOf, redialModeFromArgv, NOBODY_ANSWERED } from './lib/redial-policy.mjs'

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
// with status 'review', which the dialer never selects, and the display
// payload is upserted into wk_raw_leads. Hugo's press on /admin/crm/raw-leads
// flips review to pending. Without --review the script behaves exactly as it
// always did.
const REVIEW = process.argv.includes('--review')
const COUNT = parseInt(arg('count', '150'), 10)
// WHO MAY BE RUNG AGAIN.   (wired up 2026-08-20)
//
// The policy has understood this since 2026-08-11 and this script never asked
// it: it always ran the default, 'never', so a branch that went to voicemail
// was treated exactly like one that told Pedro no. Hugo, needing volume and
// with 192 branches on file where nobody had ever picked up: "hammer the
// machine and give me more branches but of course must be solid".
//
// --redial-unanswered is the solid version of that. It re-deals ONLY offices
// where nobody answered, on the cadence the policy already defines (three
// daily tries, then weekly), and it will not touch an office that gave a real
// answer of any kind, including "not interested". --redial-all exists and is
// the blunt one; it is not what this is.
const REDIAL_MODE = redialModeFromArgv(process.argv)
const POOL_PATH = arg('pool', '/root/scraper/exports/discovery_pool.json')
// Tonight's verdict on every house the engine reached one on, pass or fail.
// Defaults to sitting beside the pool file, so --pool from another directory
// picks up the matching verdicts rather than a stale set from somewhere else.
const VERDICTS_PATH = arg('verdicts',
  POOL_PATH.replace(/discovery_pool\.json$/, 'discovery_verdicts.json'))

// How far under its like-for-like local sold median a house must be advertised
// before it is worth a call. The same value as discovery_pool.MIN_DISCOUNT.
// Repeated here deliberately: this is the last gate before Pedro, and a gate
// that trusts its input is not a gate. RAISED 0.15 -> 0.20 on 2026-08-19,
// Hugo: "move from a 10% minimum discount to a 20% minimum discount right
// from the jump. No filler, just high conviction deals." Measured before the
// move: the pool held 272 houses at 20%+, comfortably above the 200-a-day
// baseline he set as the condition.
const MIN_LOCAL_DISCOUNT = 0.20

// The same identities the priced path uses. REFUSED rather than created here:
// if either is missing something is badly wrong and a discovery run must not
// be the thing that invents a second Pedro.
const AGENT_EMAIL = 'pedro@hostunico.com'
const CAMPAIGN_NAME = 'Houses - Pedro'

const say = (s) => console.log(s)

async function main() {
  say(`Discovery-first assign. ${APPLY ? 'APPLY' : 'DRY RUN'}, target ${COUNT} branches.`)
  // Said out loud because it changes who gets rung, and a run that quietly
  // re-deals offices is exactly what Pedro complained about on 2026-08-11.
  say(`  redial mode: ${REDIAL_MODE}${REDIAL_MODE === 'unanswered'
    ? ' (offices where nobody picked up, on the voicemail cadence)'
    : REDIAL_MODE === 'all' ? ' (EVERY called branch is back in play)'
    : ' (a branch that has been called is not dealt again)'}`)

  // THE FLOOR IN FORCE, SAID OUT LOUD ON EVERY RUN.   (2026-08-21)
  //
  // This script runs from a COPY at /root/elsie-assign on the VPS, and the copy
  // is only as current as the last person who remembered to re-copy it. On
  // 2026-08-21 the priced twin was found still carrying 0.15, two days after
  // the floor moved to 0.20, and nothing anywhere said so: the test that pins
  // the value reads the repo, and the repo was right. A number printed into the
  // morning log every night is the cheapest possible way for a stale copy to
  // announce itself, so it is printed whether it looks interesting or not.
  say(`  minimum discount in force: ${Math.round(MIN_LOCAL_DISCOUNT * 100)}%`)

  const rawPool = JSON.parse(readFileSync(POOL_PATH, 'utf8'))

  // THE DISCOUNT, RE-CHECKED HERE TOO, even though discovery_pool.py already
  // screens on it. Hugo, 2026-08-16: "make sure this never ever happens again."
  //
  // The pool file is not evidence, it is a file. It can be stale, it can be
  // half-written if a run was killed, and it can be hand-edited. Re-reading the
  // number it carries costs nothing and means the last gate before Pedro
  // depends on a value rather than on a promise that some earlier step checked
  // one. A MISSING discount is a REFUSAL: unverified is not the same as fine,
  // and that assumption is exactly how three houses at 10.5%, 6.7% and 3.0%
  // under reached his dialer on the priced side.
  //
  // THE SEVEN COMPARABLE RULES ARE RE-CHECKED HERE FOR THE SAME REASON.
  // Hugo, 2026-08-19: "make sure ai does all this as well before send to my
  // raw list ... make sure all of this is rock solid." comp_gate.py in the
  // engine is what DECIDES; this reads its receipt and refuses anything that
  // does not carry seven answered rules with every one of them ok. A pool file
  // written by an older engine has no comp_checks at all, and that is a
  // refusal too: unchecked is not the same as fine.
  const SEVEN = ['street_first', 'recent_enough', 'photographs', 'condition',
    'sizes', 'own_street', 'on_market']
  const gatePassed = (p) => {
    const checks = Array.isArray(p?.comp_checks) ? p.comp_checks : []
    if (checks.length !== SEVEN.length) return false
    const seen = new Set(checks.filter((c) => c && c.ok === true).map((c) => c.rule))
    return SEVEN.every((r) => seen.has(r))
  }

  let droppedGate = 0
  const pool = rawPool.filter((b) => {
    const d = Number(b?.property?.discount)
    if (!(Number.isFinite(d) && d >= MIN_LOCAL_DISCOUNT)) return false
    if (!gatePassed(b?.property)) { droppedGate++; return false }
    return true
  })
  const dropped = rawPool.length - pool.length - droppedGate
  say(`  pool: ${pool.length} branches from ${POOL_PATH}`
    + (dropped ? `  (${dropped} refused here: no measured discount, or under `
      + `${Math.round(MIN_LOCAL_DISCOUNT * 100)}%)` : '')
    + (droppedGate ? `  (${droppedGate} refused here: did not clear all seven `
      + `comparable rules)` : ''))
  if (!pool.length) {
    console.error('REFUSING: not one branch in the pool carries a discount at or '
      + 'over the rule. That is a broken pool, not an empty night.')
    process.exit(2)
  }

  // ------------------------------------------------------------------
  // WHAT PEDRO IS ALREADY HOLDING, RE-TESTED AGAINST TONIGHT'S NUMBERS.
  // ------------------------------------------------------------------
  //
  // Hugo, 2026-08-20, looking at 5.3% and 6.7% houses on his agent's list:
  // "this is unacceptable, why do we keep giving property to Pedro that
  // doesn't have 20% discount at least."
  //
  // The 20 percent rule was never missing. It ran on every house being ADDED,
  // here and in the engine, and it still does. The hole was that it only ever
  // ran ONCE, on the night a house was queued. A house that went into the
  // queue on 18 August, when the comparables were still wrong, sat there
  // untouched while the engine was fixed twice underneath it. Pedro spent
  // twenty minutes on Wootton Street, Bedworth and was arranging a builder,
  // on a house that is 5.3 percent under, because the card was written before
  // the road evidence existed.
  //
  // So every pending row is now re-tested every night. The engine writes a
  // verdict for every house it reached one on (discovery_verdicts.json);
  // anything it FAILED comes out of the queue before a single new branch is
  // added.
  //
  // ABSENCE IS NOT A VERDICT, and this is the part that has to stay right. The
  // seven-rule gate runs under a clock and never reaches most of the stock, so
  // a house missing from tonight's file has not been judged and is left
  // exactly where it is. Only an explicit failure removes anything.
  //
  // AND THE FILE ITSELF HAS TO BE ONE WE CAN ACT ON.   (2026-08-21)
  //
  // Two ways a verdicts file can be dangerous rather than merely useless, and
  // both were live on 2026-08-21:
  //
  //   OLD SHAPE. The rule above ("absence is not a verdict") was added to the
  //   engine on 2026-08-21 at 05:32. The file sitting in exports at the time
  //   was written at 05:42 by a run that had started earlier and was still
  //   holding the previous code in memory, so it carried the OLD behaviour:
  //   33,734 houses marked failed, including every house whose comparables or
  //   floor plan simply had not been fetched yet. Deleting queue rows against
  //   that list is exactly the mistake the engine had just stopped making.
  //   `not_judged` is the field the fixed engine always writes, so its absence
  //   is a reliable "this file predates the fix".
  //
  //   STALE. A night where the pool builder was killed writes no file at all,
  //   so yesterday's stays on disk and would be re-applied as though it were
  //   tonight's answer. A verdict is about the day it was taken.
  //
  // Neither case is an error worth stopping the run for. Adding branches is the
  // job; re-testing is the extra. So both skip the re-test, loudly, and the
  // night still queues.
  const VERDICTS_MAX_AGE_HOURS = 24
  let verdicts = null
  try {
    verdicts = JSON.parse(readFileSync(VERDICTS_PATH, 'utf8'))
  } catch { /* no file tonight: re-testing is skipped, never guessed at */ }
  if (verdicts && !Object.prototype.hasOwnProperty.call(verdicts, 'not_judged')) {
    say('  REFUSING to re-test: the verdicts file has no not_judged count, so it '
      + 'was written before the engine learned that a house we had not read yet '
      + 'is not a house that failed. Nothing was removed from the queue.')
    verdicts = null
  }
  if (verdicts) {
    const takenAt = new Date(String(verdicts.at ?? '')).getTime()
    const ageHours = Number.isFinite(takenAt) ? (Date.now() - takenAt) / 3_600_000 : Infinity
    if (!(ageHours <= VERDICTS_MAX_AGE_HOURS)) {
      say(`  REFUSING to re-test: the verdicts file is ${Number.isFinite(ageHours)
        ? `${Math.round(ageHours)}h old` : 'undated'}, and a verdict is about the `
        + `day it was taken. Nothing was removed from the queue.`)
      verdicts = null
    }
  }
  if (verdicts && Array.isArray(verdicts.failed) && verdicts.failed.length) {
    const failed = new Set(verdicts.failed.map(String))
    const { data: pending } = await db.from('wk_dialer_queue')
      .select('id, contact_id, wk_contacts!inner(custom_fields)')
      .eq('status', 'pending')
    const doomed = []
    for (const row of pending ?? []) {
      const url = row.wk_contacts?.custom_fields?.property_url ?? ''
      const pid = String(url).match(/\/properties\/(\d+)/)?.[1]
      if (pid && failed.has(pid)) doomed.push({ id: row.id, pid, url })
    }
    say(`  re-tested ${pending?.length ?? 0} houses already in the queue against `
      + `tonight's verdicts: ${doomed.length} no longer qualify`)
    for (const d of doomed) say(`    dropping ${d.pid}  ${d.url}`)
    if (doomed.length && APPLY) {
      for (let i = 0; i < doomed.length; i += 100) {
        await db.from('wk_dialer_queue').delete()
          .in('id', doomed.slice(i, i + 100).map((d) => d.id))
      }
      say(`  removed ${doomed.length} from the queue`)
    }
  } else {
    say('  no verdicts file tonight, so nothing already queued was re-tested')
  }

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
      if (!phone) continue
      const outcome = c.disposition_column_id ? colName.get(c.disposition_column_id) ?? null : null
      const seen = history.get(phone)
      if (!seen) {
        history.set(phone, {
          lastCallAt: c.started_at ?? null,
          lastOutcome: outcome,
          // HOW MANY TIMES NOBODY PICKED UP, which drives the voicemail
          // cadence: three daily tries, then weekly, so an office that never
          // answers cannot hold a slot in front of one nobody has tried at
          // all. Counted here because the rows arrive newest first and the
          // run of silent calls is the leading part of that list. A null
          // outcome counts as unanswered, the same as the policy treats it.
          unansweredAttempts: (!outcome || NOBODY_ANSWERED.has(outcome)) ? 1 : 0,
          _stillCounting: !outcome || NOBODY_ANSWERED.has(outcome),
        })
        continue
      }
      if (seen._stillCounting) {
        if (!outcome || NOBODY_ANSWERED.has(outcome)) seen.unansweredAttempts += 1
        else seen._stillCounting = false
      }
    }
  }

  // Already queued: one branch, one card, never duplicates.
  const queued = new Set()
  let discoveryPending = 0
  {
    const { data } = await db.from('wk_dialer_queue')
      .select('contact_id').eq('campaign_id', campaign.id)
      .in('status', ['pending', 'dialing', 'review'])
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
  let reopened = 0

  // TWO PASSES, AND THE ORDER OF THEM IS THE POINT.
  //
  // A branch we have rung before must never leapfrog one nobody has spoken to
  // yet: that is the whole reason decideRedial returns `back`. Priorities here
  // count DOWNWARDS from below the priced deals, so the only way to honour it
  // is to place every fresh branch before any reopened one. Doing it as two
  // passes over the same ranked pool keeps the ordering inside each group
  // exactly as it was, which is what the pool's own ranking is for.
  for (const pass of [false, true]) {
  for (const branch of pool) {
    if (taken >= toAdd) break
    // Counted on the first pass only: the same branch is walked twice and a
    // held-back branch counted twice reads as twice as many held back.
    const existing = contactsByPhone.get(branch.phone)
    if (existing?.do_not_call) { if (!pass) skipped.dnc++; continue }
    if (existing && existing.owner_agent_id && existing.owner_agent_id !== agent.id) {
      if (!pass) skipped.owned_elsewhere++; continue
    }
    if (existing && queued.has(existing.id)) { if (!pass) skipped.queued++; continue }
    const p = branch.property
    // A HOUSE LISTED SINCE WE LAST RANG REOPENS THE BRANCH.   (wired 2026-08-21)
    //
    // The policy has always known this rule and this script never handed it the
    // date, so the rule was dead here. It is still the policy that decides: an
    // office where a human answered waits the full fourteen days whatever it
    // lists, an office that never picked up waits the ordinary twenty hours,
    // and either way a reopened branch goes to the BACK of the queue behind the
    // offices nobody has tried at all.
    const verdict = decideRedial({
      ...(history.get(branch.phone) ?? {}),
      newestListedAt: listedAtOf(p, nowMs),
      mode: REDIAL_MODE,
      nowMs,
    })
    if (!verdict.queue) { if (!pass) skipped.called++; continue }
    // Fresh branches on the first pass, reopened ones on the second.
    if (verdict.back !== pass) continue
    if (pass) reopened++
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
      status: REVIEW ? 'review' : 'pending', priority: nextPriority--,
    })

    if (REVIEW) {
      // The display payload for the raw tab, straight from the engine's own
      // export: discount, three like-for-like comps, floor plans and the
      // pre-call viable band all arrive computed, never derived here. Old
      // pool files without the new fields still file cleanly with blanks.
      const { error: rawErr } = await db.from('wk_raw_leads').upsert({
        property_id: String(p.property_id ?? ''),
        contact_id: contactId,
        kind: 'discovery',
        address: p.address ?? null,
        outcode: String(p.address ?? '').match(/\b([A-Z]{1,2}\d[A-Z0-9]?)\s*\d[A-Z]{2}\b/i)?.[1]?.toUpperCase() ?? null,
        asking_price: p.price ?? null,
        discount: p.discount ?? null,
        band_min: p.band_min ?? null,
        band_max: p.band_max ?? null,
        comps: p.comps3 ?? [],
        floorplans: p.floorplans ?? [],
        url: p.url ?? null,
        bedrooms: p.bedrooms ?? null,
        property_type: p.property_type ?? null,
        agent_name: branch.agency ?? null,
        days_on_market: Number(p.days_on_market) || null,
        scraped_at: p.scraped_at ?? null,
        // The subject's own size and where it came from. The pool refuses
        // unsized houses (Hugo, 19 Aug: "if we don't know the size of our
        // property, we cannot make comparisons"), so these arrive filled.
        floor_area_sqm: p.subject_floor_area_sqm ?? null,
        area_source: p.area_source ?? null,
        // The receipt for the seven rules, one row each, exactly as the
        // engine answered them. Read never derived: nothing in the browser
        // or in this script decides whether a rule passed.
        comp_checks: Array.isArray(p.comp_checks) ? p.comp_checks : [],
        market_comps: p.market_comps ?? null,
        market_ceiling: p.market_ceiling ?? null,
        status: 'pending_review',
      }, { onConflict: 'property_id' })
      if (rawErr) say(`  raw-lead upsert failed for ${facts.property_street}: ${rawErr.message}`)
    }
    taken++
  }
  }

  say('')
  say(`  queued          : ${taken} discovery branch(es), all BELOW the priced deals`)
  // `back` covers both ways a branch reopens (a house listed since we rang, and
  // the voicemail cadence under --redial-unanswered), so the line says "rung
  // before" rather than naming one of them and being wrong half the time.
  say(`  of those        : ${taken - reopened} never rung before, ${reopened} rung before and reopened (queued behind the fresh ones)`)
  say(`  held back       : called within the window ${skipped.called}, owned by another agent ${skipped.owned_elsewhere}, do-not-call ${skipped.dnc}, already queued ${skipped.queued}`)
  if (taken < toAdd) {
    // A silent shortfall reads as "covered everything". Say it in capitals:
    // this is the number that tells Hugo the pool is running thin.
    say(`  SHORTFALL: wanted ${toAdd} more, found ${taken}. The pool is running thin; widen the scrape or shorten the redial window.`)
  }
  if (!APPLY) say('  Dry run. Nothing written. Add --apply to do it for real.')
}

main().catch((e) => { console.error(e); process.exit(1) })
