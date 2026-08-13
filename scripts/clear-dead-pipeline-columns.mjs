// Clear the dead columns off the pipeline board, keeping only live opportunities.
//
// Hugo, 2026-08-12, looking at the Pipelines screen:
//   "i think all those can go. just keep deciding, ballpark and interested"
//
// He was shown that the board mixes THREE campaigns and chose to clear all of
// them, including Marr's:
//
//     Plumbers - Marr    1,870 rows
//     Plumbers - Pedro     863 rows
//     Houses - Pedro       167 rows   <- the property work
//
// ⚠️ WHY THIS DOES NOT DELETE ANYTHING.
//
// It sets `pipeline_column_id = null`, which takes a contact off the board and
// leaves the record intact. The board ends up exactly as Hugo asked - only
// Deciding, Ballpark and Interested - and nothing is destroyed.
//
// Deleting the rows outright would take the phone numbers and the call history
// with them: `wk_calls`, `wk_call_timeline` and `wk_dialer_queue` all reference
// `contact_id`, and 1,780 of these are Marr's, a business Hugo has said more
// than once has nothing to do with the property work. On 2026-08-12 a script of
// mine removed 396 plumber queue rows by accident and 309 had to be restored.
// Taking them off the board achieves what was asked and stays reversible; if
// Hugo wants them destroyed as well that is one more deliberate step, not a
// side effect of tidying a screen.
//
// A full JSON backup of every row touched is written BEFORE anything changes,
// with the exact restore command printed at the end.
//
//   node scripts/clear-dead-pipeline-columns.mjs            # dry run
//   node scripts/clear-dead-pipeline-columns.mjs --apply
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

const PIPELINE = 'c2022b21-7a79-4203-90dd-5b06b46eef11' // Default workspace
const CLEAR = ['Voicemail', 'No pickup', 'Not interested', 'Nurturing']
const KEEP = ['Offer with vendor', 'Deciding', 'Ballpark agreed', 'Ballpark', 'Discovery done', 'Interested']

// PostgREST silently caps a select at 1000 rows. Every read here pages, because
// a partial read would make the counts wrong and the backup incomplete.
async function all(table, cols = '*') {
  let out = [], from = 0
  for (;;) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999)
    if (error) { console.error(table, error.message); break }
    out = out.concat(data || [])
    if (!data || data.length < 1000) break
    from += 1000
  }
  return out
}

const cols = await all('wk_pipeline_columns')
const inPipe = cols.filter((c) => c.pipeline_id === PIPELINE)
const colName = Object.fromEntries(inPipe.map((c) => [c.id, c.name]))
const clearIds = new Set(inPipe.filter((c) => CLEAR.includes(c.name)).map((c) => c.id))
if (!clearIds.size) { console.error('none of the columns to clear were found'); process.exit(1) }

const camps = await all('wk_dialer_campaigns', 'id,name')
const campName = Object.fromEntries(camps.map((c) => [c.id, c.name]))
const queue = await all('wk_dialer_queue', 'contact_id,campaign_id')
const contactCamp = {}
for (const r of queue) {
  if (r.contact_id) (contactCamp[r.contact_id] ||= new Set()).add(campName[r.campaign_id] || '?')
}

const contacts = await all('wk_contacts', 'id,name,phone,pipeline_column_id,owner_agent_id,stage_moved_at,last_contact_at')
const doomed = contacts.filter((c) => clearIds.has(c.pipeline_column_id))
const kept = contacts.filter((c) => colName[c.pipeline_column_id]
                                    && KEEP.includes(colName[c.pipeline_column_id]))

const byCamp = {}
for (const c of doomed) {
  const k = [...(contactCamp[c.id] || ['(never queued)'])].sort().join('+')
  ;(byCamp[k] ||= {})[colName[c.pipeline_column_id]] =
    ((byCamp[k] || {})[colName[c.pipeline_column_id]] || 0) + 1
}

console.log(`TAKING OFF THE BOARD: ${doomed.length} contacts\n`)
for (const [k, v] of Object.entries(byCamp).sort(
  (a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0)
          - Object.values(a[1]).reduce((x, y) => x + y, 0))) {
  const tot = Object.values(v).reduce((x, y) => x + y, 0)
  console.log(`  ${k}  (${tot})`)
  for (const [col, n] of Object.entries(v).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(5)}  ${col}`)
  }
}

const keptByCol = {}
for (const c of kept) keptByCol[colName[c.pipeline_column_id]] = (keptByCol[colName[c.pipeline_column_id]] || 0) + 1
console.log(`\nSTAYING ON THE BOARD: ${kept.length}`)
for (const [k, n] of Object.entries(keptByCol)) console.log(`      ${String(n).padStart(5)}  ${k}`)

if (!APPLY) {
  console.log('\nDRY RUN. Nothing changed. Add --apply to do it.')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(ROOT, `pipeline-clear-backup-${stamp}.json`)
fs.writeFileSync(backup, JSON.stringify(
  doomed.map((c) => ({ id: c.id, name: c.name, pipeline_column_id: c.pipeline_column_id,
                       column_name: colName[c.pipeline_column_id],
                       campaign: [...(contactCamp[c.id] || [])].join('+') })), null, 1))
console.log(`\nbackup written: ${path.basename(backup)}  (${doomed.length} rows)`)

let done = 0
for (let i = 0; i < doomed.length; i += 200) {
  const batch = doomed.slice(i, i + 200).map((c) => c.id)
  const { error } = await db.from('wk_contacts')
    .update({ pipeline_column_id: null }).in('id', batch)
  if (error) { console.error('  batch failed:', error.message); break }
  done += batch.length
  process.stdout.write(`\r  cleared ${done}/${doomed.length}`)
}
console.log(`\n\ndone. ${done} contacts taken off the board, ${kept.length} live ones left.`)
console.log(`\nTo put them all back:`)
console.log(`  node scripts/restore-pipeline-clear.mjs ${path.basename(backup)} --apply`)
