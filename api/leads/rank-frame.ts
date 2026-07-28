import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { normBusinessName } from '../lib/vsl-settings.js'
import { resolveTrade } from '../lib/trades.js'
import { MIN_REAL_ABOVE, realCompetitors, splitByReviews, type PlaceRow } from '../lib/uk-places.js'

// rank-frame — feeds the personalised "you're buried on Google" video frame.
//
// Given a CRM contact id, returns the lead's own Google stats (real, from the
// leads pipeline: rating, reviews, rank, town) PLUS the LIVE local pack for
// "{trade} in {town}" pulled fresh from Google Places (real competitor names,
// star ratings and review counts). The frame page lays these out like Google's
// local results with the lead sat at its real rank — so the video shows the
// truth, styled like Google, never fabricated numbers.
//
// WHAT "ABOVE THE LEAD" MEANS HERE (rewritten 2026-07-28, see api/lib/uk-places.ts)
//
// The baked voiceover says "the only reason they're up there is more reviews",
// and GoogleScrollV prints each row's review count beside its name. So a
// business may only sit above the lead if it genuinely has more reviews. When
// the lead's own town cannot supply MIN_REAL_ABOVE such businesses, we widen to
// REAL businesses in nearby UK towns rather than invent names (Hugo 2026-07-28:
// "put business with more reviews above from cities near by"). That is also
// what Google itself does for a small town: the live Bridlington search already
// returns firms from Beverley and Hull.
//
// Public GET (no auth): the frame page and the headless video renderer both hit
// it. It only ever READS a contact's public-facing business stats.
export const config = { runtime: 'nodejs', maxDuration: 30 }

const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY || process.env.VITE_GOOGLE_PLACES_KEY || ''
// The Places key is referer-restricted to this origin — send it server-side too.
const REFERER = 'https://poppy-henna.vercel.app/'

// How far "nearby" reaches, in metres, tried in order. 40km is a tradesman's
// normal travel-to-work area; 80km is the last resort before refusing. Only
// used when the lead's own town is too thin to fill the rows above them.
const NEARBY_RADII = [40_000, 80_000]

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

interface PackEntry {
  name: string
  rating: number | null
  reviews: number | null
  isLead: boolean
  /** true when this business trades in a nearby town rather than the lead's own */
  nearby?: boolean
}

// Loose name match — "24/7 Fast Flow Plumbing Ltd" vs Google's "24/7 Fast Flow
// Plumbing" — so we don't double-list the lead if Google already returned it.
// Lives in lib/vsl-settings so api/vsl/page.ts dedupes its examples the same way.
const norm = normBusinessName

async function places(path: string, params: Record<string, string>): Promise<{
  status?: string
  results?: Array<{
    name?: string
    rating?: number
    user_ratings_total?: number
    formatted_address?: string
    vicinity?: string
    types?: string[]
  }>
}> {
  const url = `https://maps.googleapis.com/maps/api/place/${path}/json?${new URLSearchParams({ ...params, key: GOOGLE_KEY })}`
  const res = await fetch(url, { headers: { Referer: REFERER } })
  return res.json() as never
}

const toRows = (json: Awaited<ReturnType<typeof places>>): PlaceRow[] =>
  (json.status === 'OK' && json.results ? json.results : [])
    .filter((r) => r.name)
    .map((r) => ({
      name: r.name!,
      // Nearby Search returns `vicinity` instead of `formatted_address`. It is
      // radius-bounded around a GB point, so it is UK by construction anyway.
      address: r.formatted_address || r.vicinity || '',
      rating: typeof r.rating === 'number' ? r.rating : null,
      reviews: typeof r.user_ratings_total === 'number' ? r.user_ratings_total : null,
      types: r.types ?? [],
    }))

/** The lead's town search — the one whose query string goes on screen. */
async function townPack(query: string): Promise<PlaceRow[]> {
  if (!GOOGLE_KEY) return []
  return toRows(await places('textsearch', { query, region: 'uk' }))
}

/**
 * A UK-only anchor point for the town.
 *
 * `components=country:GB` is a hard restriction on the Geocoding API (unlike
 * `region` on a Places search, which is only a bias), so this cannot resolve
 * Scarborough to Ontario.
 */
async function ukTownAnchor(town: string): Promise<string | null> {
  if (!GOOGLE_KEY) return null
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({
    address: town, components: 'country:GB', key: GOOGLE_KEY,
  })}`
  const res = await fetch(url, { headers: { Referer: REFERER } })
  const json = (await res.json()) as {
    status?: string
    results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>
  }
  const loc = json.status === 'OK' ? json.results?.[0]?.geometry?.location : null
  return loc ? `${loc.lat},${loc.lng}` : null
}

/** Real businesses within `radius` metres of a UK point. The radius is a hard
 *  bound on Nearby Search, which is what keeps foreign towns of the same name
 *  out of the results. */
async function nearbyPack(anchor: string, radius: number, keyword: string): Promise<PlaceRow[]> {
  return toRows(await places('nearbysearch', { location: anchor, radius: String(radius), keyword }))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const contactId = String(req.query.contact || '').trim()
  if (!contactId) return res.status(400).json({ ok: false, error: 'contact query param required' })

  const { data: contact, error } = await supabase
    .from('wk_contacts')
    .select('name, custom_fields')
    .eq('id', contactId)
    .maybeSingle()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  if (!contact) return res.status(404).json({ ok: false, error: 'contact not found' })

  const cf = (contact.custom_fields ?? {}) as Record<string, string>
  const num = (v: string | undefined) => {
    const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? n : null
  }

  const lead = {
    business: contact.name || cf.business_name || 'Your business',
    owner: (cf.owner_name || '').split(/\s+/)[0] || '',
    town: cf.town || '',
    rating: num(cf.rating),
    reviews: num(cf.reviews),
    rank: num(cf.rank),
    plumbers_ahead: num(cf.plumbers_ahead),
    total_plumbers: num(cf.total_plumbers),
  }

  // The trade drives the search, and the SAME string goes on screen in the
  // video — so what we query Google for and what the lead sees are never
  // different. (Previously this parsed the stored google_search_url, which for
  // the 11k list always said "plumbers" — including for the ~950 leads Google
  // files as electricians or builders.)
  const trade = resolveTrade(cf, lead.town, lead.business)

  const leadNorm = norm(lead.business)
  const isLead = (name: string) => norm(name) === leadNorm

  // 1. The lead's own town. Filtered to real UK traders: `region=uk` is only a
  //    bias, so an unfiltered search puts Toronto firms in a Yorkshire SERP.
  const townRows = realCompetitors(await townPack(trade.search_term), isLead)
  const split = splitByReviews(townRows, lead.reviews)
  let above = split.above
  const below = split.below

  // 2. Too thin to tell the story truthfully with this town alone? Widen to
  //    real businesses in nearby UK towns before considering a refusal. Only
  //    businesses that genuinely out-review the lead are eligible, so every row
  //    the video places above them earns its place.
  // Tracked by name rather than by position: `above` is re-sorted by review
  // count after each widen, so the businesses from out of town end up
  // interleaved with the local ones exactly as Google interleaves them.
  const nearbyNames = new Set<string>()
  if (above.length < MIN_REAL_ABOVE && lead.town) {
    const anchor = await ukTownAnchor(lead.town)
    if (anchor) {
      const seen = new Set(townRows.map((r) => norm(r.name)))
      for (const radius of NEARBY_RADII) {
        // radiusBounded: these rows carry `vicinity`, which has no postcode, so
        // the address test would reject all of them. The radius around a
        // GB-restricted geocode is the geography guarantee here.
        const fresh = realCompetitors(await nearbyPack(anchor, radius, trade.plural), isLead, { radiusBounded: true })
          .filter((r) => (r.reviews ?? 0) > (lead.reviews ?? 0))
          .filter((r) => !seen.has(norm(r.name)))
        for (const r of fresh) { seen.add(norm(r.name)); nearbyNames.add(norm(r.name)) }
        above = [...above, ...fresh].sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))
        if (above.length >= MIN_REAL_ABOVE) break
      }
    }
  }
  const fromNearby = nearbyNames.size
  const entry = (r: PlaceRow): PackEntry => ({
    name: r.name,
    rating: r.rating,
    reviews: r.reviews,
    isLead: false,
    ...(nearbyNames.has(norm(r.name)) ? { nearby: true } : {}),
  })

  const pack: PackEntry[] = [
    ...above.map(entry),
    { name: lead.business, rating: lead.rating, reviews: lead.reviews, isLead: true },
    ...below.map(entry),
  ]

  // Why a render may refuse, decided HERE so the render, the CRM card and this
  // API can never disagree about it. 'no_results' means Google gave us nothing
  // to build from; 'thin_market' means it gave us plenty and the lead simply
  // out-reviews their whole area, which is a fact about the lead, not a fault.
  const refusal =
    above.length >= MIN_REAL_ABOVE ? null
    : townRows.length === 0 ? 'no_results'
    : 'thin_market'

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
  return res.status(200).json({
    ok: true,
    lead: { ...lead, rank_source: 'reviews', shown_rank: above.length + 1 },
    trade,
    serp: {
      real_above: above.length,
      from_nearby: fromNearby,
      town_results: townRows.length,
      min_required: MIN_REAL_ABOVE,
      refusal,
    },
    pack,
  })
}
