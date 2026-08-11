// Remove from Pedro's world every property the second brain has killed.
//
// Sister script to prune-non-pursue-properties.mjs, same shape, different
// judge. The founding case, 2026-08-11: Holloway Head B1, a 2-bed ex-council
// tower flat asking GBP 100,000, valued at GBP 293,296 off luxury new-build
// comps 100 metres away, queued to Pedro with an opening offer of GBP 95,000.
// The engine's statistics were clean and the conclusion was absurd, so a
// second brain (deal_auditor.py on the VPS) now judges every deal after the
// engine prices it, and this script clears out what it has killed.
//
// The kill list comes from rm_audit_rejects on the scraper database, exported
// as JSON: { "<source_property_id>": "reason,reason", ... }. Built by the SAME
// audit that gates send_to_elsie.py, so the list and the gate cannot disagree.
//
// What it does, only with --apply:
//   1. Marks killed brrr_properties rows status 'auditor_killed'. It does NOT
//      delete them, and that is the whole lesson of 2026-08-11: the first
//      version deleted 127 rows, Dixons' only listing was one of them, and
//      thirteen calls in Pedro's history were left with no deal behind them
//      and no way to ask why. A withdrawn deal is hidden from the dialer
//      (usePropertyListings drops it) and can never be queued (the assign
//      script only takes new/call_queued), but Call history still shows it,
//      marked withdrawn, with the auditor's reasons. Rows already carrying a
//      HUMAN outcome are left exactly as they are.
//   2. Removes still-pending wk_dialer_queue rows for branch contacts left
//      with no live property behind them. In-progress and completed rows stay.
//   3. Strips the money fields from those emptied branch contacts, because the
//      live coach reads custom_fields and must never quote a dead figure.
//   4. Writes a JSON backup of everything first.
//
//   node scripts/prune-audit-killed.mjs --map=kills.json           # dry run
//   node scripts/prune-audit-killed.mjs --map=kills.json --apply
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const db = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const APPLY = process.argv.includes('--apply')
const mapPath = process.argv.find((a) => a.startsWith('--map='))?.slice(6)
if (!mapPath) {
  console.error('need --map=<kills.json> (export of rm_audit_rejects)')
  process.exit(1)
}
const kills = JSON.parse(fs.readFileSync(mapPath, 'utf8'))

const say = (...a) => console.log(...a)
say(`Prune auditor-killed properties ${APPLY ? '*** APPLY ***' : '(dry run)'}`)
say(`  kills loaded: ${Object.keys(kills).length}`)

const { data: props, error } = await db.from('brrr_properties')
  .select('id, source_property_id, address, asking_price, status, call_channel, wk_contact_id, agent_name, agent_phone')
if (error) throw new Error(error.message)

const bad = props.filter((p) => p.source_property_id in kills)
say(`  in Elsie: ${props.length} properties; ${bad.length} on the kill list`)

// A human outcome outranks a machine one, so a branch somebody has actually
// qualified keeps its status; only machine-set rows become 'auditor_killed'.
const MACHINE_STATUSES = new Set(['new', 'call_queued', 'auditor_killed'])
const toWithdraw = bad.filter((p) => MACHINE_STATUSES.has(p.status))
const leftAlone = bad.filter((p) => !MACHINE_STATUSES.has(p.status))

for (const p of toWithdraw.slice(0, 12)) {
  say(`   WITHDRAW  ${String(p.asking_price ?? '?').padStart(8)}  ${(p.address ?? '').slice(0, 44)}  [${kills[p.source_property_id]}]`)
}
if (toWithdraw.length > 12) say(`   ... and ${toWithdraw.length - 12} more`)
for (const p of leftAlone) say(`   LEFT ALONE (human status "${p.status}")  ${(p.address ?? '').slice(0, 44)}`)

// A branch with nothing live behind it is not a branch to ring, WHATEVER
// emptied it. Computed from the state of the table rather than from this run's
// kill list on purpose: properties also leave the callable set when the engine
// stops pursuing them (the ingest withdraws those), and a rule that only knew
// about auditor kills left four branches sitting in Pedro's queue with nothing
// to talk about.
const withdrawnIds = new Set(toWithdraw.map((p) => p.id))
const isLive = (p) => p.status !== 'auditor_killed' && !withdrawnIds.has(p.id)
const liveByContact = new Map()
const allContacts = new Set()
for (const p of props) {
  if (!p.wk_contact_id) continue
  allContacts.add(p.wk_contact_id)
  if (isLive(p)) liveByContact.set(p.wk_contact_id, (liveByContact.get(p.wk_contact_id) ?? 0) + 1)
}
const emptyContacts = [...allContacts].filter((c) => !liveByContact.has(c))
say(`  branches with nothing live left: ${emptyContacts.length}`)

if (!APPLY) {
  say('\nDry run. Nothing written. Add --apply to do it.')
  process.exit(0)
}

const backup = path.join(path.dirname(mapPath), `pruned-audit-killed-${Date.now()}.json`)
fs.writeFileSync(backup, JSON.stringify({ toWithdraw, leftAlone, emptyContacts }, null, 1))
say(`  backup written: ${backup}`)

if (toWithdraw.length) {
  const { error: e } = await db.from('brrr_properties')
    .update({ status: 'auditor_killed' }).in('id', toWithdraw.map((p) => p.id))
  if (e) throw new Error(`withdraw: ${e.message}`)
  say(`  withdrew ${toWithdraw.length} properties (kept on file, hidden from the dialer)`)
}
if (emptyContacts.length) {
  const { data: gone, error: e } = await db.from('wk_dialer_queue')
    .delete().in('contact_id', emptyContacts).eq('status', 'pending').select('id')
  if (e) throw new Error(`queue: ${e.message}`)
  say(`  removed ${gone?.length ?? 0} pending queue rows for emptied branches`)

  // An emptied branch's contact still carries the dead deal's money in
  // custom_fields, and the live coach reads custom_fields. Strip the figures
  // and say why, or a History redial coaches numbers whose deal is gone.
  const MONEY_KEYS = ['offer_open', 'offer_ceiling', 'ladder', 'offer_ladder',
    'property_worth', 'worth_after_bed', 'comp_evidence']
  let stripped = 0
  for (const id of emptyContacts) {
    const { data: row } = await db.from('wk_contacts')
      .select('id, custom_fields').eq('id', id).maybeSingle()
    if (!row || (row.custom_fields ?? {}).lead_type !== 'estate_agent') continue
    const cf = { ...(row.custom_fields ?? {}) }
    for (const k of MONEY_KEYS) delete cf[k]
    cf.valuation_notes = 'the auditor withdrew the deal behind this branch; do not quote figures'
    const { error: e2 } = await db.from('wk_contacts').update({ custom_fields: cf }).eq('id', id)
    if (!e2) stripped += 1
  }
  say(`  stripped stale money fields from ${stripped} emptied branch contacts`)
}
say('done')
