// Put the priced 4/5 bed conversions on Pedro's screen, in batches.
//
// Reads exports/pedro_priced_list.json, built on the VPS by build_pedro_list.py.
// Every property in it has, on file:
//   - a 2 or 3 bed HOUSE, not a flat, not an auction, not tenanted
//   - a floor plan read TWICE, both reads agreeing the kitchen is its own room
//     with a window, so the kitchen becomes a bedroom and the lounge takes the
//     kitchen
//   - a second room the plan proves can become a bedroom
//   - REAL sold prices of 4 or 5 bed houses nearby, which is the evidence this
//     strategy always needed and did not have until 2026-08-12
//
// The offer ladder is Hugo's, 2026-08-12: open at 15% below asking on every
// call, climb, and the ceiling is the most we can pay while still clearing 20%
// below market value. On some the ceiling IS the asking price, and those are
// the best calls on the sheet: there is no negotiation to win, only a number to
// agree.
//
//   node scripts/push-priced-properties-to-pedro.mjs --limit=50          # dry run
//   node scripts/push-priced-properties-to-pedro.mjs --limit=50 --apply
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
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) || 50)
const FILE = process.argv.find((a) => a.startsWith('--file='))?.slice(7)
  || path.join(ROOT, 'pedro_priced_list.json')

const list = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const { data: existing } = await db.from('brrr_properties').select('source_property_id')
const have = new Set((existing || []).map((r) => r.source_property_id))
const fresh = list.filter((p) => !have.has(String(p.property_id))).slice(0, LIMIT)

console.log(`${list.length} priced properties on file, ${have.size} already in the CRM`)
console.log(`pushing ${fresh.length} (limit ${LIMIT})`)
console.log(`  payable at FULL ASKING: ${fresh.filter((p) => p.full_asking_ok).length}`)
console.log(`  branches: ${new Set(fresh.map((p) => p.agent)).size}`)
console.log()
fresh.slice(0, 12).forEach((p) => console.log(
  `  ${String(p.address).slice(0, 42).padEnd(44)}`
  + `ask ${String(p.asking).padStart(7)}  open ${String(p.open).padStart(7)}`
  + `  ceiling ${String(p.ceiling).padStart(7)}  ${p.beds}->${p.to_beds}`
  + (p.full_asking_ok ? '  FULL ASKING OK' : '')))

if (!APPLY) { console.log('\nDRY RUN. Add --apply to write.'); process.exit(0) }

// The scraper stores floor areas as free text and some rows hold junk like "."
// or "". Postgres rejects those on a numeric column, and the whole batch fails
// on one bad row, so coerce here rather than trusting the source.
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

const rows = fresh.map((p) => {
  const band = p.bmv_at_open >= 0.25 ? 'strong'
    : p.bmv_at_open >= 0.20 ? 'meets criteria' : 'thin'
  const why = `${p.beds} bed becomes ${p.to_beds} bed. The kitchen is its own room `
    + `with a window, so it becomes a bedroom and the lounge takes the kitchen. `
    + `${p.second_room}. Priced on ${p.comps} sold ${p.to_beds} bed houses nearby, `
    + `median £${Number(p.gdv).toLocaleString()}.`
    + (p.full_asking_ok ? ' WORKS AT FULL ASKING PRICE.' : '')
  return {
    source: 'rightmove',
    source_property_id: String(p.property_id),
    listing_url: p.url,
    address: p.address,
    price_text: `£${Number(p.asking).toLocaleString()}`,
    asking_price: p.asking,
    price_qualifier: p.price_qualifier || null,
    bedrooms: p.beds,
    property_type: p.type,
    floor_area_sqm: num(p.floor_area_sqm),
    floor_area_sqft: num(p.floor_area_sqft),
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
      cmv: { estimate: p.cmv, confidence: p.comps_same >= 4 ? 'medium' : 'low',
             comps: p.comps_same },
      gdv: { estimate: p.gdv, flags: [], comps: p.comps },
      // What Pedro opens with, and the number he must never say out loud.
      offer: { open: p.open, max: p.ceiling, ceiling: p.ceiling,
               mode: 'negotiated', verdict: band,
               ladder: [p.open, Math.round(p.asking * 0.90),
                        Math.round(p.asking * 0.95), p.asking]
                 .filter((v) => v <= p.ceiling),
               flags: p.full_asking_ok ? ['works_at_full_asking'] : [] },
      audit: { reasons: [] },
      evidence: p.evidence || [],
      // brrr-deal-facts.ts looks these up BY NAME anywhere in the blob, so they
      // sit at the top level where nothing nested can shadow them.
      strategy: 'brrr_btl',
      bmv_band: band,
      condition_band: 'unknown',
      why,
      tmv: p.tmv,
      bmv: p.bmv_at_open,
      refurb_low: p.refurb,
      second_room: p.second_room,
      target_bedrooms: p.to_beds,
    },
  }
})

let done = 0
for (let i = 0; i < rows.length; i += 50) {
  const { error } = await db.from('brrr_properties').insert(rows.slice(i, i + 50))
  if (error) { console.error('push failed:', error); process.exit(1) }
  done += rows.slice(i, i + 50).length
}
console.log(`\npushed ${done} properties to Pedro`)
console.log('now run: node scripts/assign-properties-to-pedro-houses.mjs --refresh --apply')
