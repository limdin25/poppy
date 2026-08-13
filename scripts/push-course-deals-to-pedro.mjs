// Put the course-rules deals on Pedro's screen.
//
// Reads pedro_course_list.json, built on the VPS by build_course_list.py. Every
// deal in it has, on file:
//   - a HOUSE, not a flat, not an auction, not tenanted, not shared ownership
//   - a phone number Pedro can actually ring
//   - at least THREE sold comparables that meet the Fontaine course's own
//     standard: similar style, similar square footage, within a quarter mile,
//     sold recently - and the TIER is recorded, so a deal resting on 24-month-
//     old evidence is never presented as if it rested on 6-month-old evidence
//   - a seller who looks motivated: price cut and still unsold, months on the
//     market past the 90-day agent contract, repossession, probate, no chain
//   - a real 10-25% negotiation to win. Deals that already work at the asking
//     price are deliberately EXCLUDED: when the arithmetic says a seller is
//     giving it away, the usual explanation is that our comps are wrong.
//
// THE NUMBERS ARE THE COURSE'S, not ours:
//     TMV        = GDV - (refurb + 5% contingency)
//     open at    = TMV x 0.75        "take 25 percent off that"
//     never above  TMV x 0.80        "20 percent below market value as a minimum"
//
// This replaces push-priced-properties-to-pedro.mjs, which read the old
// 4/5-bed kitchen-conversion list. That strategy was measured on 2026-08-12 and
// an extra bedroom is worth about 1% on the same street at the same size, so
// the conversion is no longer what makes a deal. The discount is.
//
//   node scripts/push-course-deals-to-pedro.mjs --limit=200          # dry run
//   node scripts/push-course-deals-to-pedro.mjs --limit=200 --apply
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
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) || 200)
const FILE = process.argv.find((a) => a.startsWith('--file='))?.slice(7)
  || path.join(ROOT, 'pedro_course_list.json')

const list = JSON.parse(fs.readFileSync(FILE, 'utf8'))

// PostgREST caps a select at 1000 rows and returns no warning. Page it, or a
// property already in the CRM looks new and gets inserted twice.
async function all(table, cols) {
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

const existing = await all('brrr_properties', 'source_property_id')
const have = new Set(existing.map((r) => String(r.source_property_id)))
const fresh = list.filter((p) => !have.has(String(p.pid))).slice(0, LIMIT)

const tierCount = {}
for (const p of fresh) tierCount[p.comps_tier] = (tierCount[p.comps_tier] || 0) + 1
console.log(`${list.length} deals on file, ${have.size} already in the CRM`)
console.log(`pushing ${fresh.length} (limit ${LIMIT})`)
console.log(`  branches to ring : ${new Set(fresh.map((p) => String(p.phone).replace(/\D/g, '').slice(-9))).size}`)
console.log(`  evidence tier    : ${Object.entries(tierCount).map(([k, v]) => `${k} ${v}`).join(', ')}`)
console.log(`  typical asking   : £${Math.round(fresh.map((p) => p.asking).sort((a, b) => a - b)[Math.floor(fresh.length / 2)] || 0).toLocaleString()}`)
console.log()
fresh.slice(0, 10).forEach((p) => console.log(
  `  ${String(p.address).slice(0, 40).padEnd(42)}`
  + `ask ${String(p.asking).padStart(7)}  open ${String(p.open_offer).padStart(7)}`
  + `  MAX ${String(p.walk_away).padStart(7)}  ${(p.off_asking * 100).toFixed(0)}% off  [${p.comps_tier}]`))

if (!APPLY) { console.log('\nDRY RUN. Add --apply to write.'); process.exit(0) }

// Floor areas arrive as free text and some rows hold "." or "". Postgres
// rejects those on a numeric column and one bad row fails the whole batch.
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

const rows = fresh.map((p) => {
  const bmvAtOpen = 1 - p.open_offer / p.tmv
  const band = bmvAtOpen >= 0.25 ? 'strong'
    : bmvAtOpen >= 0.20 ? 'meets criteria' : 'thin'
  const seller = (p.why || []).join('; ')
  const why = `Open at £${Number(p.open_offer).toLocaleString()}, never above `
    + `£${Number(p.walk_away).toLocaleString()}. Worth £${Number(p.gdv).toLocaleString()} `
    + `done up, less £${Number(p.refurb).toLocaleString()} refurb, so true value is `
    + `£${Number(p.tmv).toLocaleString()}. Evidence: ${p.comps_note}. `
    + `Seller looks ${p.band}: ${seller}.`

  return {
    source: 'rightmove',
    source_property_id: String(p.pid),
    listing_url: p.url,
    address: p.address,
    price_text: `£${Number(p.asking).toLocaleString()}`,
    asking_price: p.asking,
    price_qualifier: p.price_qualifier || null,
    bedrooms: p.beds,
    property_type: p.ptype,
    floor_area_sqm: num(p.floor_area_sqm),
    days_on_market: p.days_on_market ? String(p.days_on_market) : null,
    agent_name: p.agent,
    agent_phone: p.phone,
    agent_branch_url: p.agent_branch_url || null,
    floorplan_urls: p.floorplan_urls || [],
    comps: p.evidence || [],
    status: 'new',
    notes: p.description || null,
    deal: {
      pursue: true,
      is_auction: false,
      verdict: 'pass',
      // usePropertyListings reads cmv and gdv NESTED, with a confidence on cmv.
      // Confidence here is the COMPS TIER, not a guess: gold and strong mean
      // the course's own standard was met without widening.
      cmv: {
        estimate: p.tmv,
        confidence: ['gold', 'strong'].includes(p.comps_tier) ? 'high'
          : ['good', 'fair'].includes(p.comps_tier) ? 'medium' : 'low',
        comps: p.comps_used,
      },
      gdv: { estimate: p.gdv, flags: [], comps: p.comps_used },
      // What Pedro opens with, and the number he must never say out loud.
      // The ladder climbs from the opener toward the ceiling and STOPS there.
      offer: {
        open: p.open_offer,
        max: p.walk_away,
        ceiling: p.walk_away,
        mode: 'negotiated',
        verdict: band,
        ladder: [p.open_offer,
                 Math.round(p.open_offer + (p.walk_away - p.open_offer) * 0.5),
                 p.walk_away].filter((v) => v <= p.walk_away),
        flags: p.suspicious_too_good ? ['valuation_looks_too_good'] : [],
      },
      audit: { reasons: [] },
      evidence: p.evidence || [],
      // brrr-deal-facts.ts looks these up BY NAME anywhere in the blob, so they
      // sit at the top level where nothing nested can shadow them.
      strategy: 'brrr_btl',
      bmv_band: band,
      condition_band: 'unknown',
      why,
      tmv: p.tmv,
      bmv: Number(bmvAtOpen.toFixed(4)),
      refurb_low: p.refurb,
      discount_off_asking: p.off_asking,
      comps_tier: p.comps_tier,
      comps_note: p.comps_note,
      motivation_score: p.motivation,
      motivation_band: p.band,
      motivation_why: p.why || [],
    },
  }
})

let done = 0
for (let i = 0; i < rows.length; i += 50) {
  const slice = rows.slice(i, i + 50)
  const { error } = await db.from('brrr_properties').insert(slice)
  if (error) { console.error('push failed:', error); process.exit(1) }
  done += slice.length
  process.stdout.write(`\r  pushed ${done}/${rows.length}`)
}
console.log(`\n\ndone. ${done} deals on Pedro's screen.`)
