// Take the houses that cannot prove a 20% discount out of Pedro's call queue.
//
// Hugo, 2026-08-19: "clean existing call list if not ready."
//
// The queue was filled before the comp-set fix, so every branch on it was
// chosen on a discount computed from comparables matched on bedroom count but
// NOT on floor area, allowing sales up to 24 months old. Re-run through the
// fixed engine, 30 of the 65 pending calls still clear 20 percent. The rest are
// either genuinely under the rule or cannot be valued honestly at all.
//
// THE RULE HERE IS STRICTER THAN ON THE RAW-LEADS PAGE, ON PURPOSE. There, an
// unexamined house is left alone, because that page is a list Hugo reads and a
// house sitting on it costs nothing. Here it is a call Pedro is about to make,
// and a branch is burned for fourteen days the moment he makes it. So anything
// not positively proven at 20 percent is held back: "we could not check it" and
// "it is fine" are not the same sentence.
//
// HELD, NOT DELETED. The queue row goes to 'skipped', which is the same state
// the raw-leads reject button produces, and the contact and its property facts
// are untouched. Re-queueing is a status update if a house later earns its way
// back.
//
//   scp margarita-server:/tmp/pending_result.json /tmp/pending_result.json
//   node scripts/hold-unproven-queue-calls.mjs                  # dry run
//   node scripts/hold-unproven-queue-calls.mjs --apply
//
// DRY BY DEFAULT. Without --apply nothing is written.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
for (const line of readFileSync(resolve(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const APPLY = process.argv.includes('--apply')
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const verdicts = JSON.parse(readFileSync(arg('verdicts', '/tmp/pending_result.json'), 'utf8'))

// THE SAME BAND THE POOL BUILDER USES, both ends of it. The recheck only
// answered "is it at least 20 percent", and the engine also refuses anything
// over 45, on the grounds that past that the usual cause is not a desperate
// vendor but a comp set that does not belong to the house. Leaving a 50 percent
// house in the queue would have Pedro ringing about a deal the engine would now
// refuse to publish, which is the same inconsistency that started all this.
const MIN_DISCOUNT = 0.20
const MAX_DISCOUNT = 0.45
const proven = (v) => Boolean(v && v.keep && typeof v.discount === 'number'
  && v.discount >= MIN_DISCOUNT && v.discount <= MAX_DISCOUNT)

const { data: queue, error } = await db.from('wk_dialer_queue')
  .select('id, contact_id, status').eq('status', 'pending')
if (error) { console.error(error); process.exit(1) }

const { data: contacts, error: cErr } = await db.from('wk_contacts')
  .select('id, name, custom_fields').in('id', queue.map((q) => q.contact_id).filter(Boolean))
if (cErr) { console.error(cErr); process.exit(1) }
const byId = new Map(contacts.map((c) => [c.id, c]))

const rows = queue.map((q) => {
  const c = byId.get(q.contact_id)
  const cf = (c && c.custom_fields) || {}
  const pid = (String(cf.property_url || '').match(/properties\/(\d+)/) || [])[1]
  return { q, name: (c && c.name) || '?', address: cf.property_address || '', pid, v: pid ? verdicts[pid] : null }
})

const keep = rows.filter((r) => proven(r.v))
const hold = rows.filter((r) => !proven(r.v))

console.log(`${queue.length} calls waiting in the queue`)
console.log(APPLY ? 'APPLY\n' : 'DRY RUN\n')
console.log(`HOLDING BACK ${hold.length}:`)
for (const r of hold) {
  const why = !r.v ? 'never checked'
    : r.v.discount == null ? r.v.why
    : r.v.discount > MAX_DISCOUNT
      ? `${Math.round(r.v.discount * 100)}%, over the ${Math.round(MAX_DISCOUNT * 100)}% ceiling`
      : `really ${Math.round(r.v.discount * 100)}%`
  console.log(`   ${String(r.address || r.name).slice(0, 44).padEnd(46)} ${why}`)
}
console.log(`\nSTAYING (${keep.length}):`)
for (const r of keep.sort((a, b) => b.v.discount - a.v.discount)) {
  console.log(`   ${String(Math.round(r.v.discount * 100)).padStart(3)}%  ${String(r.address || r.name).slice(0, 46)}`)
}

if (!APPLY) { console.log('\nDRY RUN. Add --apply to write.'); process.exit(0) }

let held = 0
for (const r of hold) {
  const { error: uErr } = await db.from('wk_dialer_queue')
    .update({ status: 'skipped' }).eq('id', r.q.id).eq('status', 'pending')
  if (uErr) { console.error(`  ${r.address}:`, uErr.message); continue }
  held++
}
console.log(`\nheld back ${held}, ${keep.length} calls left in the queue`)
