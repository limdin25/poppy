// Delete the trade leads (plumbers, locksmiths, pest control) sitting on the
// property pipeline board.
//
// Hugo, 2026-08-13, shown that 29 of the 58 board contacts were plumber leads:
//   "delete Plumber leads (18 Pedro + 9 Marr + 2 strays) 29
//    this business is gone, stop with this i said many times"
//
// This is a REAL DELETE, not the take-off-the-board move that
// clear-dead-pipeline-columns.mjs does. Hugo asked for the record gone, and he
// has said the trade business is over more than once, so the reversible version
// is not what he wants any more.
//
// ⚠️ THERE IS NO UNDO IN THE DATABASE. The undo is the backup file this writes
// BEFORE touching anything: every contact row plus every child row that would be
// destroyed with it (calls, call timeline, dialer queue, tags, tasks). If the
// backup cannot be written, nothing is deleted.
//
// SCOPE, deliberately narrow: only contacts that are BOTH
//   (a) sitting in Deciding / Ballpark / Interested on the property pipeline, AND
//   (b) NOT in the 'Houses - Pedro' campaign.
// The wider trade queues (Plumbers - Marr, Plumbers - Pedro) hold thousands more
// rows and are NOT touched here. Widening a delete beyond what was pointed at is
// how 396 plumber queue rows got destroyed by accident on 2026-08-12.
//
//   node scripts/delete-trade-leads-from-board.mjs            # dry run
//   node scripts/delete-trade-leads-from-board.mjs --apply
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
const db = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL,
                        env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

const PIPELINE = 'c2022b21-7a79-4203-90dd-5b06b46eef11'
const BOARD = ['Offer with vendor', 'Deciding', 'Ballpark agreed', 'Ballpark', 'Discovery done', 'Interested']
const PROPERTY_CAMPAIGN = 'Houses - Pedro'

// PostgREST caps a select at 1000 rows and says nothing. A partial read here
// would mean an incomplete backup of rows we are about to destroy.
async function all(table, cols = '*') {
  let out = [], from = 0
  for (;;) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out = out.concat(data || [])
    if (!data || data.length < 1000) break
    from += 1000
  }
  return out
}

const cols = (await all('wk_pipeline_columns')).filter((c) => c.pipeline_id === PIPELINE)
const colName = Object.fromEntries(cols.map((c) => [c.id, c.name]))
const boardIds = new Set(cols.filter((c) => BOARD.includes(c.name)).map((c) => c.id))
if (!boardIds.size) { console.error('board columns not found'); process.exit(1) }

const camps = await all('wk_dialer_campaigns', 'id,name')
const campName = Object.fromEntries(camps.map((c) => [c.id, c.name]))
const queue = await all('wk_dialer_queue')
const contactCamp = {}
for (const r of queue) {
  if (r.contact_id) (contactCamp[r.contact_id] ||= new Set()).add(campName[r.campaign_id] || '?')
}

const contacts = await all('wk_contacts')
const doomed = contacts.filter((c) => boardIds.has(c.pipeline_column_id)
  && !(contactCamp[c.id] || new Set()).has(PROPERTY_CAMPAIGN))
const doomedIds = new Set(doomed.map((c) => c.id))

if (!doomed.length) { console.log('nothing to delete. already clean.'); process.exit(0) }

// Everything that would die with them.
const calls = (await all('wk_calls')).filter((r) => doomedIds.has(r.contact_id))
const callIds = new Set(calls.map((r) => r.id))
const timeline = (await all('wk_call_timeline')).filter((r) => callIds.has(r.call_id))
const qRows = queue.filter((r) => doomedIds.has(r.contact_id))
const tags = (await all('wk_contact_tags')).filter((r) => doomedIds.has(r.contact_id))
const tasks = (await all('wk_tasks')).filter((r) => doomedIds.has(r.contact_id))

console.log(`DELETING ${doomed.length} trade leads from the property board\n`)
const byCamp = {}
for (const c of doomed) {
  const k = [...(contactCamp[c.id] || ['(never queued)'])].sort().join('+')
  byCamp[k] = (byCamp[k] || 0) + 1
}
for (const [k, n] of Object.entries(byCamp).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${k}`)
}
console.log('\n  and with them:')
console.log(`  ${String(calls.length).padStart(4)}  call records`)
console.log(`  ${String(timeline.length).padStart(4)}  call timeline entries`)
console.log(`  ${String(qRows.length).padStart(4)}  dialer queue rows`)
console.log(`  ${String(tags.length).padStart(4)}  tags`)
console.log(`  ${String(tasks.length).padStart(4)}  tasks`)

// Prove the property side is untouched.
const propLeft = contacts.filter((c) => boardIds.has(c.pipeline_column_id)
  && (contactCamp[c.id] || new Set()).has(PROPERTY_CAMPAIGN))
console.log(`\n  UNTOUCHED on the board: ${propLeft.length} property contacts`)
const leftByCol = {}
for (const c of propLeft) leftByCol[colName[c.pipeline_column_id]] = (leftByCol[colName[c.pipeline_column_id]] || 0) + 1
console.log('  ', leftByCol)
const otherTrade = queue.filter((r) => !doomedIds.has(r.contact_id)
  && String(campName[r.campaign_id] || '').startsWith('Plumbers')).length
console.log(`\n  NOT IN SCOPE: ${otherTrade} trade queue rows outside the board stay as they are.`)

console.log('\n  the 29:')
for (const c of doomed) console.log(`    ${String(c.name).slice(0, 44).padEnd(46)} ${c.phone}`)

if (!APPLY) { console.log('\nDRY RUN. Nothing deleted. Add --apply to do it.'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(ROOT, `backup-trade-leads-deleted-${stamp}.json`)
fs.writeFileSync(backup, JSON.stringify(
  { deleted_at: stamp, contacts: doomed, calls, call_timeline: timeline,
    dialer_queue: qRows, contact_tags: tags, tasks }, null, 1))
const size = fs.statSync(backup).size
if (size < 1000) { console.error('backup looks empty, refusing to delete'); process.exit(1) }
console.log(`\nbackup written: ${path.basename(backup)}  (${(size / 1024).toFixed(0)} KB)`)

// Children first, parents last, or the foreign keys refuse.
async function wipe(table, col, ids) {
  if (!ids.length) return 0
  let done = 0
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const { error } = await db.from(table).delete().in(col, batch)
    if (error) { console.error(`  ${table} failed: ${error.message}`); process.exit(1) }
    done += batch.length
  }
  console.log(`  ${table.padEnd(20)} ${done} removed`)
  return done
}

// wk_call_timeline is a VIEW over the call records, not a table of its own, so
// it cannot be deleted from and does not need to be: its rows disappear when the
// calls underneath them go. It is still captured in the backup above.
await wipe('wk_calls', 'id', calls.map((r) => r.id))
await wipe('wk_dialer_queue', 'id', qRows.map((r) => r.id))
await wipe('wk_contact_tags', 'id', tags.map((r) => r.id))
await wipe('wk_tasks', 'id', tasks.map((r) => r.id))
await wipe('wk_contacts', 'id', doomed.map((c) => c.id))

// Confirm from the database, not from what we think we did.
const after = (await all('wk_contacts', 'id,pipeline_column_id'))
  .filter((c) => boardIds.has(c.pipeline_column_id))
console.log(`\ndone. ${after.length} contacts left on the board (was ${doomed.length + propLeft.length}).`)
console.log(`backup, if it ever needs reading: ${path.basename(backup)}`)
