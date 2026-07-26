// prep-lead — builds everything per-lead the render needs (HANDOFF §4).
//
//   node video/scripts/prep-lead.mjs <wk_contacts id>
//
// 1. Fetches the contact row (website/phone/custom_fields) + the live pack
//    from /api/leads/rank-frame (real Google Places competitors).
// 2. Builds the 23-row SERP pack with the lead at index 18 — exactly 5
//    audio-locked down-flicks reach it — padded with locale-plausible names.
// 3. Measures the selection width of the lead's name at 27px Arial
//    (Liberation Sans on Linux — metric-compatible; that's also the font
//    headless Chrome substitutes for Arial, so measure == render).
// 4. Derives the ghost listings' phone area code from the lead's own
//    landline, falling back to a seeded UK-mobile prefix.
// 5. Captures the lead's mobile site (unless no_website) via
//    capture-mobile-site.mjs and records its height for the scroll clamp.
// 6. Writes src/data/lead-gen.json (+ public/client-mobile-gen.png).
//
// Deterministic per contact — same input, same video (Remotion render
// workers require it; seeded rng mirrors src/lib/human.ts mulberry32).

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import opentype from 'opentype.js'
import { safeWebsiteUrl } from './lead-url.mjs'

const VIDEO_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const APP = process.env.APP_URL || 'https://app.heyelsie.com'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required (load the repo .env)')
  process.exit(1)
}

const contactId = process.argv[2]
if (!contactId) { console.error('usage: prep-lead.mjs <contact_id>'); process.exit(1) }

// ---------- deterministic rng (mulberry32, seeded from the contact id) ----------
function seedFrom(str) {
  let h = 2166136261
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(seedFrom(contactId))

// ---------- 1. contact + live pack ----------
async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`supabase ${path}: ${res.status}`)
  return res.json()
}

const [contact] = await sb(`wk_contacts?id=eq.${contactId}&select=id,name,phone,custom_fields`)
if (!contact) { console.error(`contact ${contactId} not found`); process.exit(1) }
const cf = contact.custom_fields || {}

// cache-bust so a retry after a data fix never reuses the 24h-cached pack
const rfRes = await fetch(`${APP}/api/leads/rank-frame?contact=${contactId}&_r=${Date.now()}`)
if (!rfRes.ok) { console.error(`rank-frame ${rfRes.status}`); process.exit(1) }
const rf = await rfRes.json()
if (!rf?.ok || !rf.lead) { console.error('rank-frame returned no lead'); process.exit(1) }

// Fail loudly on degraded data — never render a broken pack (HANDOFF §4.5).
if (!rf.lead.town || !rf.lead.rank) {
  console.error(`lead is missing town/rank (town="${rf.lead.town}" rank=${rf.lead.rank}) — only plumber-import leads render`)
  process.exit(1)
}

// ---------- 2. the 23-row pack, lead at index 18 ----------
const LEAD_INDEX = 18
const TOTAL = 23
const real = rf.pack || []
const leadIdx = real.findIndex((r) => r.isLead)
const leadRow = (leadIdx >= 0 && real[leadIdx]) ||
  { name: rf.lead.business, rating: rf.lead.rating, reviews: rf.lead.reviews, isLead: true }
const realAbove = leadIdx >= 0 ? real.slice(0, leadIdx) : real.filter((r) => !r.isLead)
const realBelow = leadIdx >= 0 ? real.slice(leadIdx + 1).filter((r) => !r.isLead) : []

// Truthfulness guard (adversarial review 2026-07-26): the video tells the lead
// "these are the businesses in your area" and "there you are, near the bottom".
// If Google Places returned almost no real competitors above them, padding
// would fabricate the whole story. Require a real spine or fail the render.
if (realAbove.length < 3) {
  console.error(`only ${realAbove.length} real competitors above the lead — refusing to render a mostly-fabricated SERP (lead ${rf.lead.business}, ${rf.lead.town})`)
  process.exit(1)
}

const SURNAMES = ['Whitfield', 'Ashworth', 'Hughes', 'McCabe', 'Cooper', 'Barlow', 'Kendall', 'Slater', 'Booth', 'Hartley', 'Ogden', 'Farrell']
const PATTERNS = [
  (t, s) => `${t} Plumbing Services`,
  (t, s) => `${s} Plumbing & Heating`,
  (t, s) => `${t} Boiler Care`,
  (t, s) => `${s.charAt(0)}. ${s} & Son`,
  (t, s) => `${t} Heating Solutions`,
  (t, s) => `${s} & Sons`,
  (t, s) => `${t} Gas Services`,
  (t, s) => `J ${s} Plumbing & Heating`,
  (t, s) => `${s.charAt(0)}&${SURNAMES[Math.floor(rand() * SURNAMES.length)].charAt(0)} Plumbing`,
  (t, s) => `Rapid Response Plumbing ${t}`,
]
const taken = new Set(real.map((r) => r.name.toLowerCase()))
function padName(town) {
  for (let i = 0; i < 40; i++) {
    const s = SURNAMES[Math.floor(rand() * SURNAMES.length)]
    const name = PATTERNS[Math.floor(rand() * PATTERNS.length)](town, s)
    if (!taken.has(name.toLowerCase())) { taken.add(name.toLowerCase()); return name }
  }
  return `${town} Plumbing Co.`
}

// Above: real rows first (their Google order tells the true story), padded to
// LEAD_INDEX with inventions INTERLEAVED at seeded positions. Pad counts sit
// between their neighbours so the column reads naturally.
const above = [...realAbove]
while (above.length < LEAD_INDEX) {
  const pos = 1 + Math.floor(rand() * Math.max(1, above.length)) // never displace the #1 giant
  const prev = above[pos - 1]?.reviews ?? 150
  const next = above[pos]?.reviews ?? Math.max(6, Math.floor((leadRow.reviews ?? 10) * 0.4))
  const hi = Math.max(prev ?? 60, 8)
  const lo = Math.max(next ?? 4, 3)
  const reviews = Math.max(3, Math.floor(lo + rand() * Math.max(1, Math.min(hi, 200) - lo)))
  above.splice(pos, 0, {
    name: padName(rf.lead.town),
    rating: Math.round((4.3 + rand() * 0.7) * 10) / 10,
    reviews,
    isLead: false,
  })
}

// Below: 2–4 rows so the lead is never visibly last — real ones first.
const below = [...realBelow]
while (below.length < TOTAL - LEAD_INDEX - 1) {
  below.push(below.length >= 3 && rand() < 0.5
    ? { name: `Plumbers in ${rf.lead.town}`, rating: null, reviews: null, isLead: false }
    : { name: padName(rf.lead.town), rating: 5, reviews: 1 + Math.floor(rand() * 2), isLead: false })
}

const rows = [
  ...above.slice(0, LEAD_INDEX),
  { name: leadRow.name, rating: leadRow.rating, reviews: leadRow.reviews, isLead: true },
  ...below.slice(0, TOTAL - LEAD_INDEX - 1),
]

// ---------- 3. SEL_W — the lead name's width at 27px Arial ----------
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', // Linux (metric = Arial)
  '/System/Library/Fonts/Supplemental/Arial.ttf',                    // macOS
]
const fontPath = FONT_CANDIDATES.find((p) => existsSync(p))
if (!fontPath) { console.error('no Arial-metric font found (apt install fonts-liberation)'); process.exit(1) }
const font = opentype.parse(readFileSync(fontPath).buffer.slice(0))
// Clamp to the card's 850px name ellipsis (GoogleScrollV maxWidth:850) — a very
// long name truncates on screen, so the blue selection must not sweep past it.
const selW = Math.min(850, Math.round(font.getAdvanceWidth(leadRow.name, 27)))

// ---------- 4. phone numbers ----------
const nat = (() => {
  const p = String(contact.phone || '').replace(/[^\d+]/g, '')
  return p.startsWith('+44') ? '0' + p.slice(3) : p
})()
function areaCode() {
  if (/^02\d/.test(nat)) return nat.slice(0, 3)    // 020 / 0121 style (3-digit area)
  if (/^01\d1/.test(nat)) return nat.slice(0, 4)   // 0121 / 0161 (4-digit area)
  if (/^01\d{3}/.test(nat)) return nat.slice(0, 5) // classic 01xxx STD (5-digit)
  // mobile-only lead — seeded plausible UK mobile prefix for the ghosts
  return `07${Math.floor(400 + rand() * 500)}`
}
// The lead's OWN card shows their REAL number (they scrutinise it) — a
// fabricated phone on "their" Google listing kills credibility instantly.
// Formatted, or null → the comp hides the phone rather than invent one.
function fmtReal() {
  if (!/^0\d{9,10}$/.test(nat)) return null
  if (nat.startsWith('07')) return `${nat.slice(0, 5)} ${nat.slice(5, 8)} ${nat.slice(8)}`
  if (/^02/.test(nat)) return `${nat.slice(0, 3)} ${nat.slice(3, 7)} ${nat.slice(7)}`
  return `${nat.slice(0, 5)} ${nat.slice(5, 8)} ${nat.slice(8)}`
}

// ---------- 5. website capture (skipped for no-website leads) ----------
// One rule for "do they have a capturable website?", shared with the API's
// isCapturableWebsite so the SMS variant matches the video scene. Social-only
// / private / junk URLs → treated as no-website (search scene + free offer).
const safeSite = safeWebsiteUrl(cf.website)
const noWebsite = !safeSite
let siteImage = 'client-mobile.png'
let siteImageHeight = 0
let siteUrl = ''

if (!noWebsite) {
  siteUrl = safeSite.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  siteImage = 'client-mobile-gen.png'
  const out = join(VIDEO_DIR, 'public', siteImage)
  execFileSync('node', [join(VIDEO_DIR, 'capture-mobile-site.mjs'), safeSite, out], {
    stdio: 'inherit', timeout: 180000,
  })
  const meta = JSON.parse(readFileSync(`${out}.json`, 'utf8'))
  siteImageHeight = meta.imageHeight // px in the 780-wide capture space
}

// ---------- 6. write lead-gen.json ----------
const gen = {
  business: leadRow.name,
  town: rf.lead.town,
  rating: leadRow.rating,
  reviews: leadRow.reviews,
  no_website: noWebsite,
  site_url: siteUrl,
  site_image: siteImage,
  site_image_height: siteImageHeight,
  sel_w: selW,
  area_code: areaCode(),
  lead_phone: fmtReal(), // real number on the lead's own card, or null → hidden
  rows,
}
writeFileSync(join(VIDEO_DIR, 'src', 'data', 'lead-gen.json'), JSON.stringify(gen, null, 2) + '\n')
console.log(JSON.stringify({ ok: true, business: gen.business, town: gen.town, no_website: noWebsite, sel_w: selW, rows: rows.length, lead_index: rows.findIndex((r) => r.isLead) }))
