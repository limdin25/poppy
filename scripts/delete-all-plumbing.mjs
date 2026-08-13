// Delete everything plumbing from the CRM, permanently.
//
// Hugo, 2026-08-13: "delete forever anuthing plumbing"
// (after: "this business is gone, stop with this i said many times")
//
// ⚠️ THIS IS A REAL, PERMANENT DELETE OF THOUSANDS OF RECORDS.
// The only undo is the backup file written before anything is touched. If the
// backup cannot be written, nothing is deleted.
//
// WHAT COUNTS AS PLUMBING. Being exact matters here, because a sloppy match
// destroys the wrong records. A first pass matched the word "plumb" anywhere in
// a contact's fields and caught 919 PEST CONTROL leads whose `competitor_1`
// field happened to name a plumber. A competitor is not a trade. So a contact is
// plumbing only if:
//
//   1. it is queued in a campaign whose name contains "plumb", OR
//   2. its OWN trade says so: niche / category / trade / lead_type, OR
//   3. its business NAME says so.
//
// Website addresses, Google URLs and competitor fields are deliberately ignored.
//
// NEVER DELETED, whatever else matches:
//   - anything in the 'Houses - Pedro' property campaign
//   - Hugo's own contact record
//
// OTHER TRADES ARE LEFT ALONE. Pest control, locksmiths, electricians and the
// Didsbury leaflet list are a different dead business and were not what was
// asked for. They are counted and reported at the end.
//
//   node scripts/delete-all-plumbing.mjs            # dry run
//   node scripts/delete-all-plumbing.mjs --apply
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

const PROPERTY_CAMPAIGN = 'Houses - Pedro'
const TRADE = /plumb|heating|boiler|drain|bathroom|gas\s*(safe|engineer)/i
const TRADE_FIELDS = ['niche', 'category', 'trade', 'lead_type', 'industry']
const PROTECT_NAME = /hugo|de\s*souza/i

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

const camps = await all('wk_dialer_campaigns')
const campName = Object.fromEntries(camps.map((c) => [c.id, c.name]))
const plumbCampIds = new Set(camps.filter((c) => /plumb/i.test(c.name)).map((c) => c.id))
const propCampId = camps.find((c) => c.name === PROPERTY_CAMPAIGN)?.id
if (!propCampId) { console.error('property campaign not found, refusing to run'); process.exit(1) }

const queue = await all('wk_dialer_queue')
const inPlumbCamp = new Set()
const inPropCamp = new Set()
for (const r of queue) {
  if (!r.contact_id) continue
  if (plumbCampIds.has(r.campaign_id)) inPlumbCamp.add(r.contact_id)
  if (r.campaign_id === propCampId) inPropCamp.add(r.contact_id)
}

const contacts = await all('wk_contacts')
const why = {}
const doomed = contacts.filter((c) => {
  if (inPropCamp.has(c.id)) return false                 // property, never
  if (PROTECT_NAME.test(String(c.name || ''))) return false // Hugo's own record
  const cf = c.custom_fields || {}
  if (inPlumbCamp.has(c.id)) { why[c.id] = 'in a Plumbers campaign'; return true }
  for (const k of TRADE_FIELDS) {
    if (cf[k] && TRADE.test(String(cf[k]))) { why[c.id] = `${k} = ${cf[k]}`; return true }
  }
  if (TRADE.test(String(c.name || ''))) { why[c.id] = 'business name'; return true }
  return false
})
const doomedIds = new Set(doomed.map((c) => c.id))
if (!doomed.length) { console.log('nothing plumbing left.'); process.exit(0) }

const calls = (await all('wk_calls')).filter((r) => doomedIds.has(r.contact_id))
const qRows = queue.filter((r) => doomedIds.has(r.contact_id) || plumbCampIds.has(r.campaign_id))
const tags = (await all('wk_contact_tags')).filter((r) => doomedIds.has(r.contact_id))
const tasks = (await all('wk_tasks')).filter((r) => doomedIds.has(r.contact_id))

console.log(`DELETING FOREVER: ${doomed.length} plumbing contacts\n`)
const byWhy = {}
for (const c of doomed) byWhy[why[c.id]?.split(' = ')[0] || '?'] = (byWhy[why[c.id]?.split(' = ')[0] || '?'] || 0) + 1
console.log('  matched because:')
for (const [k, n] of Object.entries(byWhy).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`)
console.log('\n  and with them:')
console.log(`  ${String(calls.length).padStart(5)}  call records`)
console.log(`  ${String(qRows.length).padStart(5)}  dialer queue rows`)
console.log(`  ${String(tags.length).padStart(5)}  tags`)
console.log(`  ${String(tasks.length).padStart(5)}  tasks`)
console.log(`  ${String(plumbCampIds.size).padStart(5)}  campaigns: ${camps.filter((c) => plumbCampIds.has(c.id)).map((c) => c.name).join(', ')}`)

console.log('\n  sample of what goes:')
for (const c of doomed.slice(0, 8)) console.log(`    ${String(c.name).slice(0, 40).padEnd(42)} ${why[c.id]}`)

// What survives, proved by counting rather than asserted.
const survivors = contacts.filter((c) => !doomedIds.has(c.id))
console.log(`\n  SURVIVING CONTACTS: ${survivors.length}`)
const sTally = {}
for (const c of survivors) {
  const cf = c.custom_fields || {}
  const k = inPropCamp.has(c.id) ? 'PROPERTY (Houses - Pedro)'
    : cf.niche ? `niche: ${cf.niche}`
    : cf.category ? `category: ${String(cf.category).slice(0, 24)}`
    : PROTECT_NAME.test(String(c.name || '')) ? 'Hugo, protected'
    : '(no trade recorded)'
  sTally[k] = (sTally[k] || 0) + 1
}
for (const [k, n] of Object.entries(sTally).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(5)}  ${k}`)
}

if (!APPLY) { console.log('\nDRY RUN. Nothing deleted. Add --apply to do it.'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(ROOT, `backup-plumbing-deleted-${stamp}.json`)
fs.writeFileSync(backup, JSON.stringify(
  { deleted_at: stamp, contacts: doomed, calls, dialer_queue: qRows,
    contact_tags: tags, tasks,
    campaigns: camps.filter((c) => plumbCampIds.has(c.id)) }, null, 1))
const kb = fs.statSync(backup).size / 1024
if (kb < 100) { console.error('backup looks too small, refusing to delete'); process.exit(1) }
console.log(`\nbackup written: ${path.basename(backup)}  (${kb.toFixed(0)} KB)`)

async function wipe(table, col, ids) {
  if (!ids.length) return
  let done = 0
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const { error } = await db.from(table).delete().in(col, batch)
    if (error) { console.error(`  ${table} failed: ${error.message}`); process.exit(1) }
    done += batch.length
    process.stdout.write(`\r  ${table.padEnd(20)} ${done}/${ids.length}`)
  }
  console.log(`\r  ${table.padEnd(20)} ${done} removed          `)
}

// Children first, parents last. wk_call_timeline is a VIEW and clears itself
// when the calls underneath it go.
await wipe('wk_calls', 'id', calls.map((r) => r.id))
await wipe('wk_dialer_queue', 'id', qRows.map((r) => r.id))
await wipe('wk_contact_tags', 'id', tags.map((r) => r.id))
await wipe('wk_tasks', 'id', tasks.map((r) => r.id))
await wipe('wk_contacts', 'id', doomed.map((c) => c.id))
await wipe('wk_dialer_campaigns', 'id', [...plumbCampIds])

const after = await all('wk_contacts', 'id,name,custom_fields')
const leftover = after.filter((c) => {
  const cf = c.custom_fields || {}
  return TRADE_FIELDS.some((k) => cf[k] && TRADE.test(String(cf[k]))) || TRADE.test(String(c.name || ''))
})
console.log(`\ndone. ${after.length} contacts left in the CRM.`)
console.log(`plumbing records still findable: ${leftover.length}`)
for (const c of leftover.slice(0, 5)) console.log(`   still there: ${c.name}`)
console.log(`\nbackup, if it is ever needed: ${path.basename(backup)}`)
