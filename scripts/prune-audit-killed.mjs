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
//   1. Deletes killed brrr_properties rows, UNLESS a call is already logged
//      against one; those are demoted to status 'not_qualified' instead.
//   2. Removes still-pending wk_dialer_queue rows for branch contacts left
//      with no property behind them. In-progress and completed rows stay.
//   3. Writes a JSON backup of everything first, so this is reversible.
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

const badIds = bad.map((p) => p.id)
let calledIds = new Set()
if (badIds.length) {
  const { data: calls } = await db.from('brrr_property_calls')
    .select('property_id').in('property_id', badIds)
  calledIds = new Set((calls ?? []).map((c) => c.property_id))
}
const toDelete = bad.filter((p) => !calledIds.has(p.id))
const toDemote = bad.filter((p) => calledIds.has(p.id))

for (const p of toDelete.slice(0, 12)) {
  say(`   DELETE  ${String(p.asking_price ?? '?').padStart(8)}  ${(p.address ?? '').slice(0, 46)}  [${kills[p.source_property_id]}]`)
}
if (toDelete.length > 12) say(`   ... and ${toDelete.length - 12} more`)
for (const p of toDemote) say(`   DEMOTE (has calls)  ${(p.address ?? '').slice(0, 52)}`)

const survivors = props.filter((p) => !toDelete.some((d) => d.id === p.id))
const liveByContact = new Map()
for (const p of survivors) {
  if (p.wk_contact_id) liveByContact.set(p.wk_contact_id, (liveByContact.get(p.wk_contact_id) ?? 0) + 1)
}
const touchedContacts = [...new Set(bad.map((p) => p.wk_contact_id).filter(Boolean))]
const emptyContacts = touchedContacts.filter((c) => !liveByContact.has(c))
say(`  branches emptied by this: ${emptyContacts.length}`)

if (!APPLY) {
  say('\nDry run. Nothing written. Add --apply to do it.')
  process.exit(0)
}

const backup = path.join(path.dirname(mapPath), `pruned-audit-killed-${Date.now()}.json`)
fs.writeFileSync(backup, JSON.stringify({ toDelete, toDemote, emptyContacts }, null, 1))
say(`  backup written: ${backup}`)

if (toDelete.length) {
  const { error: e } = await db.from('brrr_properties').delete().in('id', toDelete.map((p) => p.id))
  if (e) throw new Error(`delete: ${e.message}`)
  say(`  deleted ${toDelete.length} properties`)
}
if (toDemote.length) {
  const { error: e } = await db.from('brrr_properties')
    .update({ status: 'not_qualified' }).in('id', toDemote.map((p) => p.id))
  if (e) throw new Error(`demote: ${e.message}`)
  say(`  demoted ${toDemote.length} properties with call history`)
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
