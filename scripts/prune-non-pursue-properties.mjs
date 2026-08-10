// Remove from Pedro's world every property the valuation engine says not to
// pursue, and every queued branch left with nothing worth ringing about.
//
// Why this exists, 2026-08-10, and why it is an emergency script:
//
//   The first batch sent to Pedro ignored the engine's own pursue flag. 157
//   properties went into brrr_properties and 94 branches into his dialer
//   queue; under the corrected course maths only 60 of the 222 valued so far
//   are worth a call. Linfield Terrace was live on his screen at open GBP
//   69,000 against a GBP 124,950 asking, a number no seller would ever take,
//   because on that street the 3-beds sell BELOW the 2-bed value, so the
//   kitchen-to-bedroom conversion adds nothing and the engine had said
//   "overpriced, do not pursue" all along.
//
// What it does, in order, and only with --apply:
//   1. Reads the pursue verdicts exported from the scraper (pursue_map.json,
//      built by the SAME valuation.py that prices the deals, so this list and
//      the numbers can never disagree).
//   2. Deletes brrr_properties rows whose verdict is do-not-pursue, UNLESS the
//      property already has a call logged against it. A row with history is
//      never deleted, it is demoted to status 'not_qualified' instead.
//   3. Removes still-pending wk_dialer_queue rows for branch contacts that no
//      longer have a single property behind them. In-progress or completed
//      queue rows are left alone.
//   4. Writes everything it deleted to a JSON backup first, so this is
//      reversible by hand.
//
// The rows are re-creatable at any time: send_to_elsie.py on the VPS rebuilds
// any of them from the scraper database in one run, so deleting here loses
// nothing except the wrong numbers on Pedro's screen.
//
//   node scripts/prune-non-pursue-properties.mjs                 # dry run
//   node scripts/prune-non-pursue-properties.mjs --apply
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
  || '/private/tmp/claude-501/-Users-hugo-Whats-Poppy/0d7e1ba7-f00b-4a6b-860c-f4ba48eaae86/scratchpad/pursue_map.json'
const pursue = JSON.parse(fs.readFileSync(mapPath, 'utf8'))

const say = (...a) => console.log(...a)
say(`Prune non-pursue properties ${APPLY ? '*** APPLY ***' : '(dry run)'}`)
say(`  verdicts loaded: ${Object.keys(pursue).length} (${Object.values(pursue).filter(Boolean).length} pursue)`)

// 1. Every property row, joined to its verdict.
const { data: props, error } = await db.from('brrr_properties')
  .select('id, source_property_id, address, asking_price, status, call_channel, wk_contact_id, agent_name, agent_phone, deal')
if (error) throw new Error(error.message)

const bad = props.filter((p) => pursue[p.source_property_id] === false)
const unknown = props.filter((p) => !(p.source_property_id in pursue))
say(`  in Elsie: ${props.length} properties; ${bad.length} rejected by the engine, ${unknown.length} with no verdict yet (left alone)`)

// 2. Which of the bad ones have history? Those are demoted, never deleted.
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
  say(`   DELETE  ${String(p.asking_price ?? '?').padStart(8)}  ${(p.address ?? '').slice(0, 52)}`)
}
if (toDelete.length > 12) say(`   ... and ${toDelete.length - 12} more`)
for (const p of toDemote) say(`   DEMOTE (has calls)  ${(p.address ?? '').slice(0, 52)}`)

// 3. Branch contacts that would be left empty lose their pending queue rows.
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

// 4. Backup, then act.
const backup = path.join(path.dirname(mapPath), `pruned-properties-${Date.now()}.json`)
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
}
say('done')
