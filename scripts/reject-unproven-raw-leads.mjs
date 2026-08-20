// Take the houses that cannot prove a 20% discount off Hugo's raw-leads page.
//
// Hugo, 2026-08-19, looking at /admin/crm/raw-leads: "are all deals here
// already min 20%?" They were not. The page was filled at 14:06 that day, before
// the comp-set fix, so every discount on it was a median over comparables
// matched on bedroom count but NOT on floor area, taking sales up to 24 months
// old. Re-run through the fixed engine, 11 of the 24 held up. Four were not
// discounts at all: Hands Road in Heanor read 37% under and is 6% OVER, and
// Park Crescent in Darlington read 35% under and is 6% over.
//
// WHAT THIS DOES, AND WHY IT IS THE SAME TWO WRITES THE UI MAKES. Rejecting is
// not deleting. api/crm/raw-leads.ts sets the dialer queue row to 'skipped' and
// the raw lead to 'rejected', and this does exactly that, so a rejected house
// looks identical whether a human pressed the button or this script ran. The
// row stays on file with its reason, which is what makes it reversible.
//
// It also CORRECTS the survivors rather than leaving them alone. A keeper still
// carrying its old discount is still a wrong number on the screen, just a wrong
// number that happens to be on the right house.
//
// Input is /tmp/recheck_result.json as written by recheck_rawleads.py on the
// scraper box, keyed by property_id. Fetch it first:
//
//   scp margarita-server:/tmp/recheck_result.json /tmp/recheck_result.json
//   node scripts/reject-unproven-raw-leads.mjs                  # dry run
//   node scripts/reject-unproven-raw-leads.mjs --apply
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
const VERDICTS = arg('verdicts', '/tmp/recheck_result.json')

const verdicts = JSON.parse(readFileSync(VERDICTS, 'utf8'))
console.log(`${Object.keys(verdicts).length} verdicts from ${VERDICTS}`)
console.log(APPLY ? 'APPLY\n' : 'DRY RUN\n')

const { data: leads, error } = await db.from('wk_raw_leads')
  .select('id, property_id, address, contact_id, discount, status')
  .eq('status', 'pending_review')
if (error) { console.error(error); process.exit(1) }

// A house with NO verdict is left exactly where it is. The recheck only covers
// what it was given, and "not mentioned" is not the same as "failed": silently
// rejecting an unexamined house is the same class of mistake as silently
// keeping a bad one.
const unseen = leads.filter((l) => !verdicts[String(l.property_id)])
if (unseen.length) {
  console.log(`${unseen.length} on the page were not in the recheck, left alone:`)
  unseen.forEach((l) => console.log(`   ${String(l.address).slice(0, 46)}`))
  console.log()
}

const toReject = leads.filter((l) => verdicts[String(l.property_id)]
  && !verdicts[String(l.property_id)].keep)
const toFix = leads.filter((l) => {
  const v = verdicts[String(l.property_id)]
  if (!v || !v.keep || v.discount == null) return false
  return Math.abs(Number(l.discount ?? 0) - v.discount) > 0.005
})

console.log(`REJECTING ${toReject.length}:`)
for (const l of toReject) {
  const v = verdicts[String(l.property_id)]
  const was = l.discount == null ? '?' : `${Math.round(l.discount * 100)}%`
  const now = v.discount == null ? v.why : `${Math.round(v.discount * 100)}%`
  console.log(`   ${String(l.address).slice(0, 40).padEnd(42)} said ${was.padStart(4)}, really ${now}`)
}
console.log(`\nCORRECTING the discount on ${toFix.length} keeper(s):`)
for (const l of toFix) {
  const v = verdicts[String(l.property_id)]
  console.log(`   ${String(l.address).slice(0, 40).padEnd(42)} ${Math.round((l.discount ?? 0) * 100)}% -> ${Math.round(v.discount * 100)}%`)
}
const keeping = leads.length - unseen.length - toReject.length
console.log(`\n${keeping} of ${leads.length - unseen.length} rechecked houses stay on the page.`)

if (!APPLY) { console.log('\nDRY RUN. Add --apply to write.'); process.exit(0) }

let rejected = 0
for (const l of toReject) {
  // Same order as the UI: stand the call down first, then mark the record. If
  // the second write fails the house is already out of the dialer, which is
  // the safe half to have done.
  if (l.contact_id) {
    const { error: qErr } = await db.from('wk_dialer_queue')
      .update({ status: 'skipped' })
      .eq('contact_id', l.contact_id).eq('status', 'review')
    if (qErr) { console.error(`  queue ${l.address}:`, qErr.message); continue }
  }
  const { error: rErr } = await db.from('wk_raw_leads')
    .update({ status: 'rejected' }).eq('id', l.id)
  if (rErr) { console.error(`  lead ${l.address}:`, rErr.message); continue }
  rejected++
}

let corrected = 0
for (const l of toFix) {
  const v = verdicts[String(l.property_id)]
  const { error: cErr } = await db.from('wk_raw_leads')
    .update({ discount: v.discount }).eq('id', l.id)
  if (cErr) { console.error(`  fix ${l.address}:`, cErr.message); continue }
  corrected++
}

console.log(`\nrejected ${rejected}, corrected ${corrected}`)
