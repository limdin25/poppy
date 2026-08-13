// Delete the pest control leads and the Didsbury leaflet list, permanently.
//
// Hugo, 2026-08-13: "350 pest control leads and 123 Didsbury delete all,
//                    we are on the real estae business now"
//
// ⚠️ PERMANENT. The only undo is the backup written before anything is touched.
//
// SCOPE IS EXACTLY THE TWO GROUPS HE NAMED:
//   1. contacts whose own `niche` field says pest control
//   2. contacts queued in the 'Leaflets - Didsbury' campaign
//
// ⚠️ WHAT IS DELIBERATELY LEFT ALONE, because "we are on the real estate
// business now" is a reason to KEEP these, not to delete them:
//
//   - 233 contacts in the 'Houses - Pedro' property campaign
//   - 97 contacts whose lead_type is `estate_agent` but who are NOT currently
//     queued. These are estate agents from an earlier property push. They are
//     real estate. A sweep of "everything not in the campaign" would destroy
//     them, which is the opposite of what was asked.
//   - 1,467 HeyPubli funnel signups and inbound WhatsApp/SMS contacts. Different
//     product entirely, nothing to do with trades or property.
//   - Hugo's own contact record.
//
//   node scripts/delete-pest-and-leaflets.mjs            # dry run
//   node scripts/delete-pest-and-leaflets.mjs --apply
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

const PEST = /pest|wasp|vermin|rodent|rat\b|mice|insect/i
const LEAFLET_CAMPAIGN = 'Leaflets - Didsbury'
const PROPERTY_CAMPAIGN = 'Houses - Pedro'

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
const leafletId = camps.find((c) => c.name === LEAFLET_CAMPAIGN)?.id
const propId = camps.find((c) => c.name === PROPERTY_CAMPAIGN)?.id
if (!propId) { console.error('property campaign missing, refusing to run'); process.exit(1) }

const queue = await all('wk_dialer_queue')
const inLeaflet = new Set(), inProp = new Set()
for (const r of queue) {
  if (!r.contact_id) continue
  if (r.campaign_id === leafletId) inLeaflet.add(r.contact_id)
  if (r.campaign_id === propId) inProp.add(r.contact_id)
}

const contacts = await all('wk_contacts')
const why = {}
const doomed = contacts.filter((c) => {
  if (inProp.has(c.id)) return false
  const cf = c.custom_fields || {}
  if (String(cf.lead_type || '') === 'estate_agent') return false   // real estate, keep
  if (/hugo|de\s*souza/i.test(String(c.name || '')) && !PEST.test(String(c.name || ''))) return false
  if (cf.niche && PEST.test(String(cf.niche))) { why[c.id] = 'pest control'; return true }
  if (inLeaflet.has(c.id)) { why[c.id] = 'Didsbury leaflet list'; return true }
  return false
})
const ids = new Set(doomed.map((c) => c.id))
if (!doomed.length) { console.log('nothing to delete.'); process.exit(0) }

const calls = (await all('wk_calls')).filter((r) => ids.has(r.contact_id))
const qRows = queue.filter((r) => ids.has(r.contact_id) || r.campaign_id === leafletId)
const tags = (await all('wk_contact_tags')).filter((r) => ids.has(r.contact_id))
const tasks = (await all('wk_tasks')).filter((r) => ids.has(r.contact_id))

const t = {}
for (const c of doomed) t[why[c.id]] = (t[why[c.id]] || 0) + 1
console.log(`DELETING FOREVER: ${doomed.length} contacts`)
for (const [k, n] of Object.entries(t)) console.log(`  ${String(n).padStart(5)}  ${k}`)
console.log('\n  and with them:')
console.log(`  ${String(calls.length).padStart(5)}  call records`)
console.log(`  ${String(qRows.length).padStart(5)}  dialer queue rows`)
console.log(`  ${String(tags.length).padStart(5)}  tags`)
console.log(`  ${String(tasks.length).padStart(5)}  tasks`)
console.log(`      1  campaign: ${LEAFLET_CAMPAIGN}`)

const survivors = contacts.filter((c) => !ids.has(c.id))
console.log(`\n  SURVIVING: ${survivors.length}`)
const s = {}
for (const c of survivors) {
  const cf = c.custom_fields || {}
  const k = inProp.has(c.id) ? 'PROPERTY, in the campaign'
    : String(cf.lead_type || '') === 'estate_agent' ? 'ESTATE AGENTS, kept on purpose'
    : cf.source ? `${cf.source}` : '(other)'
  s[k] = (s[k] || 0) + 1
}
for (const [k, n] of Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(n).padStart(5)}  ${k}`)

if (!APPLY) { console.log('\nDRY RUN. Nothing deleted. Add --apply to do it.'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(ROOT, `backup-pest-leaflets-deleted-${stamp}.json`)
fs.writeFileSync(backup, JSON.stringify({ deleted_at: stamp, contacts: doomed, calls,
  dialer_queue: qRows, contact_tags: tags, tasks,
  campaigns: camps.filter((c) => c.id === leafletId) }, null, 1))
const kb = fs.statSync(backup).size / 1024
if (kb < 20) { console.error('backup too small, refusing'); process.exit(1) }
console.log(`\nbackup written: ${path.basename(backup)}  (${kb.toFixed(0)} KB)`)

async function wipe(table, col, list) {
  if (!list.length) return
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await db.from(table).delete().in(col, list.slice(i, i + 100))
    if (error) { console.error(`  ${table} failed: ${error.message}`); process.exit(1) }
  }
  console.log(`  ${table.padEnd(20)} ${list.length} removed`)
}

await wipe('wk_calls', 'id', calls.map((r) => r.id))
await wipe('wk_dialer_queue', 'id', qRows.map((r) => r.id))
await wipe('wk_contact_tags', 'id', tags.map((r) => r.id))
await wipe('wk_tasks', 'id', tasks.map((r) => r.id))
await wipe('wk_contacts', 'id', doomed.map((c) => c.id))
if (leafletId) await wipe('wk_dialer_campaigns', 'id', [leafletId])

const after = await all('wk_contacts', 'id,custom_fields')
console.log(`\ndone. ${after.length} contacts left in the CRM.`)
console.log(`pest control still findable: ${after.filter((c) => PEST.test(String((c.custom_fields || {}).niche || ''))).length}`)
console.log(`backup: ${path.basename(backup)}`)
