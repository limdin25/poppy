// enrich-owner-names.mjs — fill custom_fields.owner_name from Companies House.
//
//   node scripts/enrich-owner-names.mjs --niche=electrician [--limit=200] [--apply]
//
// Google Places never returns an owner name, so a scraped trade list opens
// "Hi," instead of "Hi Dave,". Companies House is the free UK gov register of
// company directors and it is where the plumber list's owner names came from.
//
// THE RULE THAT SHAPES ALL OF THIS (docs/PLUMBER_LEADS_PIPELINE.md): a WRONG
// first name in the opener is worse than no name at all. So this is deliberately
// conservative — it would rather leave a lead blank than guess.
//
// What it will NOT do:
//   - accept a fuzzy/partial name match (only exact once normalised)
//   - accept a dissolved company
//   - pick between two same-named active companies without a town tiebreak
//   - use a corporate officer (a company acting as director) as a person
//
// What it deliberately DOESN'T require: the registered address matching the
// lead's town. Small trades register at their accountant's office — "ALB
// Electrical Ltd" trades in Winchester and is registered in Eastleigh. Requiring
// a town match throws away most genuine matches, so the town is a tiebreaker,
// not a gate.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
for (const line of readFileSync(resolve(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const CH_KEY = process.env.COMPANIES_HOUSE_KEY || 'f6459073-a09d-48c2-a382-c49d86de4556'
const CH = 'https://api.company-information.service.gov.uk'
const AUTH = `Basic ${Buffer.from(`${CH_KEY}:`).toString('base64')}`

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const NICHE = arg('niche', 'electrician')
const LIMIT = parseInt(arg('limit', '500'), 10)
const APPLY = process.argv.includes('--apply')

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 600 requests / 5 min = 2/sec. Two calls per lead, so pace at ~350ms.
const PACE = 350

async function ch(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${CH}${path}`, {
      headers: { Authorization: AUTH },
      signal: AbortSignal.timeout(15000),
    }).catch(() => null)
    if (!res) { await sleep(1000 * (attempt + 1)); continue }
    if (res.status === 429) { await sleep(20000); continue }   // rate limited — back right off
    if (res.status === 404) return null
    if (!res.ok) { await sleep(800 * (attempt + 1)); continue }
    return res.json()
  }
  return null
}

/** "ALB Electrical Ltd" and "ALB ELECTRICAL LIMITED" must compare equal. */
const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\b(ltd|limited|plc|llp|the|co|company)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

/** Companies House gives "WHITFIELD, David John" — the opener wants "David". */
function personName(officerName) {
  const raw = String(officerName || '').trim()
    if (!raw.includes(',')) return raw
  const [surname, rest] = raw.split(',')
  const forenames = (rest || '').trim()
  if (!forenames) return surname.trim()
  // Title-case the SHOUTED surname; keep the forenames as given.
  const sur = surname.trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
  return `${forenames} ${sur}`.replace(/\s+/g, ' ').trim()
}

async function findOwner(businessName, town) {
  const target = norm(businessName)
  if (!target) return null

  const search = await ch(`/search/companies?q=${encodeURIComponent(businessName)}&items_per_page=20`)
  await sleep(PACE)
  if (!search?.items?.length) return null

  // exact name match, active only
  let hits = search.items.filter(
    (i) => norm(i.title) === target && i.company_status === 'active',
  )
  let confidence = 'high'
  if (hits.length > 1) {
    // same name, several live companies — only a town agreement can break it
    const inTown = hits.filter((i) => (i.address_snippet || '').toLowerCase().includes(String(town || '').toLowerCase()))
    if (inTown.length !== 1) return { ambiguous: hits.length }
    hits = inTown
    confidence = 'medium'
  }
  if (!hits.length) return null

  const co = hits[0]
  const officers = await ch(`/company/${co.company_number}/officers?items_per_page=50`)
  await sleep(PACE)
  if (!officers?.items?.length) return null

  const directors = officers.items.filter(
    (o) =>
      /director/i.test(o.officer_role || '') &&
      !o.resigned_on &&
      o.date_of_birth,           // a corporate officer has no DOB — skip those
  )
  if (!directors.length) return null

  // Several directors: the earliest appointed is almost always the founder,
  // and the founder is who answers the phone at a business this size.
  directors.sort((a, b) => String(a.appointed_on || '').localeCompare(String(b.appointed_on || '')))
  const name = personName(directors[0].name)
  if (!name) return null

  return {
    owner_name: name,
    company_number: co.company_number,
    confidence: directors.length > 1 ? (confidence === 'high' ? 'medium' : 'low') : confidence,
    directors: directors.length,
  }
}

const { data: leads, error } = await supa
  .from('wk_contacts')
  .select('id, name, custom_fields')
  .filter('custom_fields->>niche', 'eq', NICHE)
  .limit(LIMIT)
if (error) { console.error(error.message); process.exit(1) }

const todo = leads.filter((l) => !l.custom_fields?.owner_name)
console.log(`${leads.length} ${NICHE} leads, ${todo.length} missing an owner name\n`)

const found = []
const stats = { high: 0, medium: 0, low: 0, none: 0, ambiguous: 0 }
for (const l of todo) {
  const town = l.custom_fields?.town || ''
  const hit = await findOwner(l.name, town)
  if (!hit) { stats.none++; continue }
  if (hit.ambiguous) { stats.ambiguous++; continue }
  stats[hit.confidence]++
  found.push({ id: l.id, name: l.name, town, ...hit })
  console.log(`  ${hit.confidence.padEnd(6)} ${l.name.slice(0, 34).padEnd(36)} -> ${hit.owner_name}`)
}

console.log(`\nmatched ${found.length}/${todo.length}  ${JSON.stringify(stats)}`)
if (!APPLY) { console.log('\ndry run — re-run with --apply to write'); process.exit(0) }

// Only HIGH and MEDIUM go in. A low-confidence guess in the opener is worse
// than no name — the agent can just ask who they're speaking to.
let wrote = 0, vanished = 0
for (const f of found.filter((x) => x.confidence !== 'low')) {
  // Re-read the row immediately before writing rather than spreading the copy
  // in `leads`. That snapshot was taken BEFORE the lookup loop, which costs
  // ~700ms a lead — over 3,000 plumbers that's half an hour, and a whole-column
  // write built on a 30-minute-old spread silently reverts anything changed in
  // the meantime. Agents write custom_fields.notes from the dialer all day
  // (DialerProPage.tsx saveNotes), so a call note taken during a long run is
  // exactly what would disappear.
  const { data: fresh } = await supa
    .from('wk_contacts').select('custom_fields').eq('id', f.id).maybeSingle()
  if (!fresh) { vanished++; continue }   // deleted mid-run — don't resurrect it
  const cf = { ...(fresh.custom_fields || {}), owner_name: f.owner_name, owner_source: 'companies_house', company_number: f.company_number }
  const { error: e } = await supa.from('wk_contacts').update({ custom_fields: cf }).eq('id', f.id)
  if (e) { console.warn(`  ! ${f.name}: ${e.message}`); continue }
  wrote++
}
if (vanished) console.log(`${vanished} lead(s) disappeared mid-run — skipped`)
console.log(`wrote ${wrote} owner names (low-confidence matches deliberately skipped)`)
