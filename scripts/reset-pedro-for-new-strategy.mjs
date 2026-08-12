// Clear Pedro's world of the OLD strategy, keep anything a branch actually
// responded to, and leave the queue ready for a fresh priced list.
//
// Why, Hugo 2026-08-12:
//
//   "The ones that is death for Pedro, that was the old method. We have to
//    remove those properties from there. Only leave there the ones that's
//    interested on and the ones that are on the ballpark."
//
// Every property in the CRM was queued on 10-11 August under the old gate,
// which offered 25-30% below asking and heard "a million miles off" nearly
// every time. Those numbers are not merely stale, they are the numbers we have
// since measured as wrong. A branch rung once is not dealt again, so leaving
// them on his screen spends branches we cannot get back.
//
// WHAT IS KEPT, and nothing else:
//   - any property with a logged call, whatever the outcome. That is real
//     information paid for with a real conversation and it is never thrown
//     away. Two exist today and BOTH are worth more under the new strategy
//     than the old one:
//       Wootton Street CV12  the branch named 140,000, which is the full
//                            asking price. We walked because the old ceiling
//                            was 134,200. Under the new strategy a property
//                            that works at full asking IS a deal, so this is
//                            a re-call, not a dead lead.
//       Whitman Street L15   79,500 floated, reply was one word, "yeah", and
//                            the call ended nine seconds later. Ambiguous and
//                            never resolved. Needs a clear answer.
//
// WHAT IS REMOVED:
//   - every property with no call history, whatever its status. 153 are
//     already auditor_killed and 107 are 'new' carrying old-strategy numbers.
//   - pending dialer queue rows for branches left with nothing to ring about.
//     In-progress, done and missed rows are left alone: they are history.
//
// Nothing is lost. send_to_elsie.py rebuilds any property from the scraper
// database in one run. A JSON backup of every row touched is written first.
//
//   node scripts/reset-pedro-for-new-strategy.mjs            # dry run
//   node scripts/reset-pedro-for-new-strategy.mjs --apply
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

const { data: props, error: pe } = await db.from('brrr_properties').select('*')
if (pe) { console.error(pe); process.exit(1) }
const { data: calls, error: ce } = await db.from('brrr_property_calls').select('property_id')
if (ce) { console.error(ce); process.exit(1) }

const hasHistory = new Set((calls || []).map((c) => c.property_id))
const keep = (props || []).filter((p) => hasHistory.has(p.id))
const drop = (props || []).filter((p) => !hasHistory.has(p.id))

console.log(`brrr_properties: ${props.length} total`)
console.log(`  KEEP (a branch actually answered): ${keep.length}`)
keep.forEach((p) => console.log(`     ${p.status.padEnd(16)} ${p.address}  ask ${p.asking_price}`))
const byStatus = {}
drop.forEach((p) => { byStatus[p.status || 'null'] = (byStatus[p.status || 'null'] || 0) + 1 })
console.log(`  REMOVE (never answered, old-strategy numbers): ${drop.length}`)
Object.entries(byStatus).forEach(([s, n]) => console.log(`     ${s.padEnd(16)} ${n}`))

// Branch queue rows that would be left with nothing behind them.
const keepContacts = new Set(keep.map((p) => p.contact_id).filter(Boolean))
const { data: queue } = await db.from('wk_dialer_queue').select('id,contact_id,status')
const pending = (queue || []).filter((q) => q.status === 'pending')
const queueDrop = pending.filter((q) => !keepContacts.has(q.contact_id))
console.log(`\nwk_dialer_queue: ${pending.length} pending`)
console.log(`  REMOVE (branch has nothing left to ring about): ${queueDrop.length}`)
console.log(`  keep: ${pending.length - queueDrop.length}`)

if (!APPLY) {
  console.log('\nDRY RUN. Nothing changed. Add --apply to do it.')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(ROOT, `backup-pedro-reset-${stamp}.json`)
fs.writeFileSync(backup, JSON.stringify({ dropped: drop, queueDrop }, null, 1))
console.log(`\nbackup written to ${backup}`)

for (let i = 0; i < drop.length; i += 100) {
  const ids = drop.slice(i, i + 100).map((p) => p.id)
  const { error } = await db.from('brrr_properties').delete().in('id', ids)
  if (error) { console.error('delete failed:', error); process.exit(1) }
}
console.log(`deleted ${drop.length} properties`)

for (let i = 0; i < queueDrop.length; i += 100) {
  const ids = queueDrop.slice(i, i + 100).map((q) => q.id)
  const { error } = await db.from('wk_dialer_queue').delete().in('id', ids)
  if (error) { console.error('queue delete failed:', error); process.exit(1) }
}
console.log(`removed ${queueDrop.length} pending queue rows`)
console.log(`\nKept ${keep.length} properties with real call history. Pedro's screen`)
console.log('is now empty of old-strategy numbers and ready for the fresh list.')
