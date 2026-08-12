// Put back the plumber queue rows that reset-pedro-for-new-strategy.mjs
// deleted by mistake on 2026-08-12.
//
// WHAT WENT WRONG, written down so it is not repeated:
//
//   The reset script was meant to clear PROPERTY rows only. It read
//   wk_dialer_queue with a plain .select() and no campaign filter. PostgREST
//   silently caps a select at 1000 rows, so it saw the first 1000 rows of a
//   4641-row table, and those happened to be almost entirely the PLUMBER
//   campaigns. It then deleted every 'pending' row whose contact was not one
//   of the two property contacts being kept: 396 plumber rows and 13 others.
//   The property rows it was actually aiming at were not even in the page it
//   read.
//
//   Two lessons, both cheap:
//     1. NEVER select-then-delete across a shared table without filtering to
//        the thing you own. wk_dialer_queue serves the plumber campaigns AND
//        the property room.
//     2. A silent 1000-row cap looks exactly like "that is all there is".
//        Page explicitly, or use a count to prove you read everything.
//
// The restore reads the backup written by the reset (id, contact_id, status),
// works out which campaign each contact belongs to from its owner_agent_id
// mapped against SURVIVING queue rows, and re-inserts with the ORIGINAL row id
// so nothing is duplicated if this is run twice.
//
//   node scripts/restore-plumber-queue-rows.mjs           # dry run
//   node scripts/restore-plumber-queue-rows.mjs --apply
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
const BACKUP = process.argv.find((a) => a.startsWith('--backup='))?.slice(9)
  || 'backup-pedro-reset-2026-08-12T08-06-14-358Z.json'

const bk = JSON.parse(fs.readFileSync(path.join(ROOT, BACKUP), 'utf8'))
const dropped = bk.queueDrop || []
console.log(`backup holds ${dropped.length} deleted queue rows`)

// Read the WHOLE queue, paging, because the 1000 cap is what caused this.
let queue = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('wk_dialer_queue')
    .select('id,contact_id,campaign_id').range(from, from + 999)
  if (error) { console.error(error); process.exit(1) }
  queue = queue.concat(data || [])
  if (!data || data.length < 1000) break
}
console.log(`queue currently holds ${queue.length} rows (paged, not capped)`)

const already = new Set(queue.map((q) => q.id))
const todo = dropped.filter((d) => !already.has(d.id))
console.log(`${dropped.length - todo.length} already back, ${todo.length} to restore`)
if (!todo.length) { console.log('nothing to do'); process.exit(0) }

// contact -> owner_agent_id, for every contact still on the queue AND for the
// ones being restored.
const allContactIds = [...new Set([...queue.map((q) => q.contact_id),
                                   ...todo.map((d) => d.contact_id)])]
const owner = new Map()
for (let i = 0; i < allContactIds.length; i += 200) {
  const { data } = await db.from('wk_contacts').select('id,owner_agent_id')
    .in('id', allContactIds.slice(i, i + 200))
  ;(data || []).forEach((c) => owner.set(c.id, c.owner_agent_id))
}

// owner_agent_id -> the campaign its surviving rows sit on (the most common one).
const tally = new Map()
queue.forEach((q) => {
  const o = owner.get(q.contact_id)
  if (!o || !q.campaign_id) return
  const m = tally.get(o) || new Map()
  m.set(q.campaign_id, (m.get(q.campaign_id) || 0) + 1)
  tally.set(o, m)
})
const campaignFor = new Map()
for (const [o, m] of tally) {
  campaignFor.set(o, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0])
}
console.log(`\nderived a campaign for ${campaignFor.size} agents:`)
for (const [o, c] of campaignFor) {
  console.log(`   agent ${o}  ->  campaign ${c}  (${tally.get(o).get(c)} surviving rows)`)
}

const rows = [], orphan = []
todo.forEach((d) => {
  const o = owner.get(d.contact_id)
  const camp = o ? campaignFor.get(o) : null
  if (!camp) { orphan.push(d); return }
  rows.push({ id: d.id, contact_id: d.contact_id, campaign_id: camp,
              status: d.status || 'pending' })
})
const byCamp = {}
rows.forEach((r) => { byCamp[r.campaign_id] = (byCamp[r.campaign_id] || 0) + 1 })
console.log(`\nrestoring ${rows.length} rows:`)
Object.entries(byCamp).forEach(([c, n]) => console.log(`   ${c}  ${n}`))
if (orphan.length) console.log(`   ${orphan.length} could not be mapped to a campaign`)

if (!APPLY) { console.log('\nDRY RUN. Add --apply to write.'); process.exit(0) }

let done = 0
for (let i = 0; i < rows.length; i += 100) {
  const { error } = await db.from('wk_dialer_queue').upsert(rows.slice(i, i + 100),
                                                            { onConflict: 'id' })
  if (error) { console.error('restore failed:', error); process.exit(1) }
  done += rows.slice(i, i + 100).length
}
console.log(`\nrestored ${done} queue rows`)
if (orphan.length) {
  fs.writeFileSync(path.join(ROOT, 'restore-orphans.json'), JSON.stringify(orphan, null, 1))
  console.log(`${orphan.length} unmapped rows written to restore-orphans.json`)
}
