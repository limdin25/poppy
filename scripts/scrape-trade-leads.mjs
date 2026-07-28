// scrape-trade-leads.mjs — build a REAL per-trade lead list from Google.
//
//   node scripts/scrape-trade-leads.mjs --trade=electrician --count=100 [--apply]
//
// Why this exists: the 11k plumber CSV was scraped entirely from PLUMBER
// searches, so every row's rank / competitors-ahead is a fact about the plumber
// SERP — even the rows Google files as "Electrician". Rendering one of those a
// video shows an electrician buried among plumbers. To go multi-trade we need
// leads whose rank came from their OWN trade's search.
//
// For each town we run the same Places text search the video will later show on
// screen ("electricians in Bath"), so the lead's rank, the businesses above them
// and the competitor names are all from one consistent, real search.
//
// Keepers mirror the plumber pipeline's durable rules (docs/PLUMBER_LEADS_PIPELINE.md):
//   - reviews 1..65   (enough of a gap to be worth pitching, low enough to be true)
//   - rank >= 4       (needs >=3 real businesses above them or the SERP is invented)
//   - has a website   (scene 1 films their site; no-site leads use the search scene)
//
// Writes nothing without --apply.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTextableUkMobile } from './lib/verify-phone.mjs'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
for (const line of readFileSync(resolve(REPO, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const KEY = process.env.GOOGLE_PLACES_KEY || process.env.VITE_GOOGLE_PLACES_KEY
// the key is referer-restricted; send the allowed referer server-side (same
// trick as scripts/enrich-plumber-reviews.mjs and api/leads/rank-frame.ts)
const REFERER = 'https://poppy-henna.vercel.app/'
if (!KEY) { console.error('no GOOGLE_PLACES_KEY / VITE_GOOGLE_PLACES_KEY'); process.exit(2) }

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const TRADE = arg('trade', 'electrician')
const WANT = parseInt(arg('count', '100'), 10)
const MAX_REVIEWS = parseInt(arg('max-reviews', '65'), 10)
const APPLY = process.argv.includes('--apply')
// A no-website lead still renders fine (prep-lead.mjs falls back to the
// search-scene opening instead of the site-capture scene) — the website
// requirement only exists to prefer the nicer variant. Off by default so
// established trades keep their current pool; opt in per run for a volume top-up.
const ALLOW_NO_WEBSITE = process.argv.includes('--allow-no-website')

// The search stem per trade — this exact string is what the video puts on
// screen, so it has to read like something a real customer would type.
const SEARCH = {
  electrician: 'electricians in',
  builder: 'builders in',
  roofer: 'roofers in',
  carpenter: 'carpenters in',
  plasterer: 'plasterers in',
  plumber: 'plumbers in',
  locksmith: 'locksmiths in',
  'pest-control': 'pest control in',
}
const CATEGORY_LABEL = {
  electrician: 'Electrician', builder: 'Home builder', roofer: 'Roofing Service',
  carpenter: 'Carpenter', plasterer: 'Plasterer', plumber: 'Plumber',
  locksmith: 'Locksmith', 'pest-control': 'Pest control service',
}
const stem = SEARCH[TRADE]
if (!stem) { console.error(`unknown trade "${TRADE}" — one of ${Object.keys(SEARCH).join(', ')}`); process.exit(2) }

// UK towns/cities to sweep. Big enough to have a real local pack, small enough
// that a business with <65 reviews is genuinely competing rather than invisible.
// Expanded 2026-07-27 (locksmith/pest-control are far rarer per-town than
// plumbers, so hitting 1,000 clean leads needs a much wider sweep than 55 towns).
const TOWNS = [
  // original 55
  'Basingstoke', 'Crawley', 'Chester', 'Wakefield', 'Grantham', 'Kidderminster',
  'Chatham', 'Winchester', 'Havant', 'Haywards Heath', 'Great Yarmouth', 'Wickford',
  'Macclesfield', 'Redruth', 'Skipton', 'Buckingham', 'Northampton', 'Warrington',
  'Doncaster', 'Scunthorpe', 'Carlisle', 'Lancaster', 'Taunton', 'Yeovil',
  'Bridgwater', 'Trowbridge', 'Chippenham', 'Andover', 'Aldershot', 'Farnborough',
  'Bracknell', 'Wokingham', 'Dunstable', 'Kettering', 'Corby', 'Rugby',
  'Nuneaton', 'Tamworth', 'Burton upon Trent', 'Loughborough', 'Mansfield',
  'Chesterfield', 'Rotherham', 'Barnsley', 'Halifax', 'Keighley', 'Accrington',
  'Burnley', 'Blackburn', 'Chorley', 'Widnes', 'Runcorn', 'Crewe', 'Stafford',
  // south east
  'Guildford', 'Woking', 'Reigate', 'Redhill', 'Horsham', 'Tonbridge', 'Tunbridge Wells',
  'Maidstone', 'Ashford', 'Canterbury', 'Dover', 'Folkestone', 'Margate', 'Ramsgate',
  'Sittingbourne', 'Gravesend', 'Dartford', 'Sevenoaks', 'Epsom', 'Leatherhead',
  'Staines', 'Slough', 'High Wycombe', 'Amersham', 'Aylesbury', 'Bicester', 'Banbury',
  'Thame', 'Newbury', 'Fareham', 'Gosport', 'Petersfield', 'Alton', 'Bognor Regis',
  'Worthing', 'Chichester', 'Burgess Hill', 'East Grinstead', 'Lewes', 'Eastbourne',
  'Hastings', 'Bexhill',
  // south west
  'Bath', 'Frome', 'Shepton Mallet', 'Wells', 'Glastonbury', 'Street', 'Weston-super-Mare',
  'Yate', 'Thornbury', 'Cheltenham', 'Gloucester', 'Stroud', 'Cirencester', 'Tewkesbury',
  'Swindon', 'Salisbury', 'Devizes', 'Marlborough', 'Melksham', 'Warminster', 'Exeter',
  'Exmouth', 'Newton Abbot', 'Torquay', 'Paignton', 'Barnstaple', 'Bideford', 'Truro',
  'Falmouth', 'Penzance', 'St Austell', 'Bodmin', 'Launceston', 'Poole', 'Christchurch',
  'Ferndown', 'Wimborne', 'Blandford Forum', 'Dorchester', 'Weymouth', 'Bridport',
  // east of england
  'Cambridge', 'Ely', 'Huntingdon', 'St Neots', 'Peterborough', 'Wisbech', "King's Lynn",
  'Norwich', 'Ipswich', 'Colchester', 'Chelmsford', 'Braintree', "Bishop's Stortford",
  'Harlow', 'Stevenage', 'Hitchin', 'Letchworth', 'Bedford', 'Luton', 'St Albans',
  'Watford', 'Hemel Hempstead', 'Hatfield', 'Welwyn Garden City', 'Sudbury',
  'Bury St Edmunds', 'Newmarket', 'Thetford', 'Diss', 'Lowestoft',
  // east midlands
  'Leicester', 'Hinckley', 'Coalville', 'Melton Mowbray', 'Wigston', 'Derby',
  'Ilkeston', 'Long Eaton', 'Belper', 'Matlock', 'Worksop', 'Retford',
  'Newark-on-Trent', 'Lincoln', 'Boston', 'Sleaford', 'Spalding', 'Nottingham',
  'Beeston', 'Sutton-in-Ashfield', 'Kirkby-in-Ashfield',
  // west midlands
  'Coventry', 'Solihull', 'Sutton Coldfield', 'Walsall', 'Wolverhampton', 'Dudley',
  'Stourbridge', 'Halesowen', 'West Bromwich', 'Redditch', 'Bromsgrove', 'Worcester',
  'Malvern', 'Evesham', 'Droitwich', 'Telford', 'Shrewsbury', 'Newcastle-under-Lyme',
  'Stoke-on-Trent', 'Leek', 'Uttoxeter', 'Rugeley', 'Cannock', 'Lichfield', 'Bedworth',
  'Warwick', 'Leamington Spa', 'Stratford-upon-Avon',
  // yorkshire & humber
  'Leeds', 'Harrogate', 'York', 'Selby', 'Wetherby', 'Otley', 'Ilkley', 'Bradford',
  'Huddersfield', 'Dewsbury', 'Batley', 'Pontefract', 'Castleford', 'Normanton',
  'Sheffield', 'Goole', 'Beverley', 'Bridlington', 'Scarborough', 'Whitby', 'Hull',
  'Grimsby', 'Cleethorpes',
  // north west
  'Liverpool', 'Southport', 'St Helens', 'Wigan', 'Bolton', 'Bury', 'Rochdale',
  'Oldham', 'Stockport', 'Altrincham', 'Sale', 'Wilmslow', 'Northwich', 'Winsford',
  'Congleton', 'Nantwich', 'Ellesmere Port', 'Birkenhead', 'Wallasey', 'Preston',
  'Blackpool', 'Lytham St Annes', 'Fleetwood', 'Kendal', 'Barrow-in-Furness',
  'Workington', 'Whitehaven',
  // north east
  'Newcastle upon Tyne', 'Gateshead', 'Sunderland', 'Durham', 'Darlington',
  'Middlesbrough', 'Stockton-on-Tees', 'Hartlepool', 'Bishop Auckland', 'Consett',
  'Berwick-upon-Tweed', 'Morpeth', 'Hexham',
  // scotland
  'Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee', 'Stirling', 'Perth', 'Inverness',
  'Ayr', 'Kilmarnock', 'Paisley', 'East Kilbride', 'Livingston', 'Falkirk',
  'Dunfermline', 'Kirkcaldy', 'St Andrews', 'Motherwell', 'Hamilton', 'Dumfries',
  // wales
  'Cardiff', 'Swansea', 'Newport', 'Wrexham', 'Bangor', 'Aberystwyth', 'Carmarthen',
  'Llanelli', 'Bridgend', 'Merthyr Tydfil', 'Neath', 'Port Talbot', 'Barry',
  // northern ireland
  'Belfast', 'Lisburn', 'Derry', 'Newry',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function places(path, params) {
  const url = `https://maps.googleapis.com/maps/api/place/${path}/json?${new URLSearchParams({ ...params, key: KEY })}`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Referer: REFERER }, signal: AbortSignal.timeout(15000) })
      const j = await res.json()
      if (j.status === 'OK' || j.status === 'ZERO_RESULTS') return j
      if (j.status === 'OVER_QUERY_LIMIT') { await sleep(2000 * (attempt + 1)); continue }
      console.warn(`  ! ${path} ${j.status} ${j.error_message || ''}`)
      return j
    } catch (e) {
      if (attempt === 2) { console.warn(`  ! ${path} ${e.message}`); return { status: 'ERROR' } }
      await sleep(1000 * (attempt + 1))
    }
  }
  return { status: 'ERROR' }
}

// Reject obvious non-traders that pollute a trade search.
const JUNK = /\b(wholesal|merchant|supplies|supply|superstore|screwfix|toolstation|city electrical|edmundson|rexel|college|training|academy|council|jobcentre|recruit|timpson|mr minit|max spielmann|rentokil|terminix)\b/i

// Hugo's rule: mobile numbers only, never a landline. Checked here, straight
// off the Google Details response, so a landline-only business never makes
// it into the leads file at all. Uses the same libphonenumber-js validator
// as /admin/phone-validation (scripts/lib/verify-phone.mjs) rather than a
// hand-rolled regex, so scrape-time and send-time agree on what counts as
// a real mobile.
const isUkMobile = isTextableUkMobile

async function scrapeTown(town) {
  const query = `${stem} ${town}`
  const j = await places('textsearch', { query, region: 'uk' })
  const results = (j.results || []).filter((r) => r.name && !JUNK.test(r.name))
  if (results.length < 6) return []

  const total = results.length
  const out = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const reviews = typeof r.user_ratings_total === 'number' ? r.user_ratings_total : 0
    const rank = i + 1
    // the durable rules, same as the plumber pipeline
    if (reviews < 1 || reviews > MAX_REVIEWS) continue
    if (rank < 4) continue                       // needs >=3 real businesses above
    const above = results.slice(0, i)
    if (above.length < 3) continue

    const d = await places('details', { place_id: r.place_id, fields: 'website,formatted_phone_number,name' })
    const website = d.result?.website || ''
    const phone = d.result?.formatted_phone_number || ''
    if (!website && !ALLOW_NO_WEBSITE) continue    // scene 1 prefers a real site
    if (!isUkMobile(phone)) continue               // Hugo: mobile numbers only, no landlines

    out.push({
      name: r.name,
      town,
      rating: typeof r.rating === 'number' ? r.rating : null,
      reviews,
      rank,
      competitors_ahead: above.length,
      total_in_town: total,
      competitor_1: above[0]?.name || '',
      competitor_2: above[1]?.name || '',
      website,
      phone,
      place_id: r.place_id,
      google_search_url: `https://www.google.com/maps/search/${encodeURIComponent(query)}/`,
      category: CATEGORY_LABEL[TRADE] || 'Plumber',
    })
    await sleep(120)
  }
  return out
}

const leads = []
for (const town of TOWNS) {
  if (leads.length >= WANT) break
  const got = await scrapeTown(town)
  leads.push(...got)
  console.log(`${town.padEnd(20)} +${String(got.length).padStart(2)}  (total ${leads.length})`)
  await sleep(200)
}
const picked = leads.slice(0, WANT)

const outPath = resolve(REPO, `scripts/out-${TRADE}-leads.json`)
writeFileSync(outPath, JSON.stringify(picked, null, 2))
console.log(`\n${picked.length} ${TRADE} leads → ${outPath}`)
console.log(`  towns covered : ${new Set(picked.map((l) => l.town)).size}`)
console.log(`  reviews       : ${Math.min(...picked.map((l) => l.reviews))}–${Math.max(...picked.map((l) => l.reviews))}`)
console.log(`  ranks         : ${Math.min(...picked.map((l) => l.rank))}–${Math.max(...picked.map((l) => l.rank))}`)

if (!APPLY) { console.log('\ndry run — re-run with --apply to import'); process.exit(0) }

// ---- import ----------------------------------------------------------------
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const CAMPAIGN = `${TRADE.charAt(0).toUpperCase()}${TRADE.slice(1)}s - test`
const { data: existingCampaign } = await supa
  .from('wk_dialer_campaigns').select('id').eq('name', CAMPAIGN).maybeSingle()
let campaignId = existingCampaign?.id
if (!campaignId) {
  const { data, error } = await supa
    .from('wk_dialer_campaigns').insert({ name: CAMPAIGN }).select('id').single()
  if (error) { console.error('campaign insert failed:', error.message); process.exit(1) }
  campaignId = data.id
}

// UK landline -> E.164. These are business numbers straight from Google.
const e164 = (raw) => {
  const p = String(raw || '').replace(/[\s()-]/g, '')
  if (/^0\d{9,10}$/.test(p)) return `+44${p.slice(1)}`
  if (/^\+44\d{9,10}$/.test(p)) return p
  return null
}

// Existing contacts keyed by phone. The upsert below writes custom_fields as a
// WHOLE object, so without this a phone collision silently wipes keys we didn't
// scrape — owner_name in particular, which Companies House enrichment put there
// and Google Places can never give back.
const phones = picked.map((l) => e164(l.phone)).filter(Boolean)
const existingCf = new Map()
for (let i = 0; i < phones.length; i += 200) {
  const { data } = await supa
    .from('wk_contacts').select('phone, custom_fields').in('phone', phones.slice(i, i + 200))
  for (const r of data || []) existingCf.set(r.phone, r.custom_fields || {})
}

let imported = 0, skipped = 0
for (const l of picked) {
  const phone = e164(l.phone)
  if (!phone) { skipped++; continue }
  const custom_fields = {
    rating: String(l.rating ?? ''),
    reviews: String(l.reviews),
    rank: String(l.rank),
    plumbers_ahead: String(l.competitors_ahead),   // legacy key name, trade-neutral value
    total_plumbers: String(l.total_in_town),
    competitor_1: l.competitor_1,
    competitor_2: l.competitor_2,
    town: l.town,
    website: l.website,
    google_search_url: l.google_search_url,
    google_category: l.category,
    niche: TRADE,
    reviews_source: 'google',
  }
  for (const k of Object.keys(custom_fields)) if (!custom_fields[k]) delete custom_fields[k]
  // merge, don't clobber — scraped fields win, everything else survives
  const merged = { ...(existingCf.get(phone) || {}), ...custom_fields }

  const { error } = await supa
    .from('wk_contacts')
    .upsert({ name: l.name, phone, custom_fields: merged }, { onConflict: 'phone', ignoreDuplicates: false })
  if (error) { console.warn(`  ! ${l.name}: ${error.message}`); skipped++; continue }
  imported++
}
console.log(`\nimported ${imported}, skipped ${skipped} → campaign "${CAMPAIGN}" (${campaignId})`)
