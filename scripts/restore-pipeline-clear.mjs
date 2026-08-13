// Put contacts back on the pipeline board from a clear-dead-pipeline-columns backup.
//
// Written at the same time as the script that clears them, on purpose. A backup
// nobody has tested restoring is not a backup, it is a file. This one is the
// exact inverse: it reads the JSON and writes each contact's original
// pipeline_column_id straight back.
//
//   node scripts/restore-pipeline-clear.mjs pipeline-clear-backup-....json
//   node scripts/restore-pipeline-clear.mjs pipeline-clear-backup-....json --apply
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
const file = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!file) { console.error('give me the backup file name'); process.exit(1) }

const rows = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'))
const byCol = {}
for (const r of rows) byCol[r.column_name] = (byCol[r.column_name] || 0) + 1
console.log(`${rows.length} contacts in ${path.basename(file)}`)
for (const [k, n] of Object.entries(byCol)) console.log(`   ${String(n).padStart(5)}  back to ${k}`)

if (!APPLY) { console.log('\nDRY RUN. Add --apply to restore.'); process.exit(0) }

// Group by target column so each update is one call per column, not per row.
const groups = {}
for (const r of rows) (groups[r.pipeline_column_id] ||= []).push(r.id)
let done = 0
for (const [colId, ids] of Object.entries(groups)) {
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200)
    const { error } = await db.from('wk_contacts')
      .update({ pipeline_column_id: colId }).in('id', batch)
    if (error) { console.error('  batch failed:', error.message); process.exit(1) }
    done += batch.length
    process.stdout.write(`\r  restored ${done}/${rows.length}`)
  }
}
console.log(`\n\ndone. ${done} contacts put back where they were.`)
