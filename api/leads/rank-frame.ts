import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// rank-frame — feeds the personalised "you're buried on Google" video frame.
//
// Given a CRM contact id, returns the lead's own Google stats (real, from the
// leads pipeline: rating, reviews, rank, town) PLUS the LIVE local pack for
// "plumbers in {town}" pulled fresh from Google Places (real competitor names,
// star ratings and review counts). The frame page lays these out like Google's
// local results with the lead sat down at its real rank — so the video shows
// the truth, styled like Google, never fabricated numbers.
//
// Public GET (no auth): the frame page and the headless video renderer both hit
// it. It only ever READS a contact's public-facing business stats.
export const config = { runtime: 'nodejs', maxDuration: 30 }

const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY || process.env.VITE_GOOGLE_PLACES_KEY || ''
// The Places key is referer-restricted to this origin — send it server-side too.
const REFERER = 'https://poppy-henna.vercel.app/'

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
}

// Loose name match — "24/7 Fast Flow Plumbing Ltd" vs Google's "24/7 Fast Flow
// Plumbing" — so we don't double-list the lead if Google already returned it.
function norm(s: string): string {
  return s.toLowerCase().replace(/\b(ltd|limited|plc|the)\b/g, '').replace(/[^a-z0-9]/g, '')
}

async function localPack(town: string, query: string): Promise<PackEntry[]> {
  if (!GOOGLE_KEY) return []
  const q = encodeURIComponent(query || `plumbers in ${town}`)
  const url =
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&region=uk&key=${GOOGLE_KEY}`
  const res = await fetch(url, { headers: { Referer: REFERER } })
  const json = (await res.json()) as {
    status?: string
    results?: Array<{ name?: string; rating?: number; user_ratings_total?: number }>
  }
  if (json.status !== 'OK' || !json.results) return []
  return json.results
    .filter((r) => r.name)
    .map((r) => ({
      name: r.name!,
      rating: typeof r.rating === 'number' ? r.rating : null,
      reviews: typeof r.user_ratings_total === 'number' ? r.user_ratings_total : null,
      isLead: false,
    }))
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

  // Query Google with the same search the ranking came from, if we have it.
  const searchQuery =
    (cf.google_search_url?.match(/search\/([^/?]+)/)?.[1]?.replace(/\+/g, ' ') || '')
    || `plumbers in ${lead.town}`

  let pack = await localPack(lead.town, searchQuery)

  // Order the real competitors by review count (Google's #1 factor) so the
  // top of the list = the businesses eating the lead's jobs.
  pack.sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))

  // Drop the lead's own listing if Google returned it — we place our own card
  // (with the stored stats) at the real rank so the "you're on page 3" beat lands.
  const leadNorm = norm(lead.business)
  pack = pack.filter((p) => norm(p.name) !== leadNorm)

  // Insert the lead at its real rank (1-based). Clamp into the list we have.
  const leadCard: PackEntry = {
    name: lead.business,
    rating: lead.rating,
    reviews: lead.reviews,
    isLead: true,
  }
  const at = Math.max(0, Math.min((lead.rank ?? pack.length + 1) - 1, pack.length))
  pack.splice(at, 0, leadCard)

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
  return res.status(200).json({ ok: true, lead, pack })
}
