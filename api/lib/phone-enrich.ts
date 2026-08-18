import { parsePhoneNumber } from 'libphonenumber-js'
import { carrier as metaCarrier, geocoder as metaGeocoder } from 'libphonenumber-geo-carrier'
import { nanpaPrefixTypeToLineType, type ValidationResult } from './phone-validation.js'

// Supabase PostgREST caps responses at 1000 rows; each NPA-NXX has up to 11 rows (base + 10 blocks)
const PAIRS_PER_REQUEST = 90

interface NanpaRow {
  npa: string
  nxx: string
  thousands: string
  prefix_type: string
  company: string | null
  state: string | null
  ratecenter: string | null
}

async function nanpaBatchLookup(
  pairs: Array<{ npa: string; nxx: string }>,
): Promise<{ map: Map<string, NanpaRow>; failed_lookups: number }> {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const map = new Map<string, NanpaRow>()
  if (pairs.length === 0) return { map, failed_lookups: 0 }
  // Misconfigured env = every pair fails; report it rather than silently
  // returning confident-but-unenriched results.
  if (!supabaseUrl || !supabaseKey) return { map, failed_lookups: pairs.length }

  const chunks: Array<Array<{ npa: string; nxx: string }>> = []
  for (let i = 0; i < pairs.length; i += PAIRS_PER_REQUEST) {
    chunks.push(pairs.slice(i, i + PAIRS_PER_REQUEST))
  }

  let failed_lookups = 0
  await Promise.all(chunks.map(async (chunk) => {
    // PostgREST or filter requires outer parens: (and(npa.eq.212,nxx.eq.260),and(...))
    const orFilter = `(${chunk.map(p => `and(npa.eq.${p.npa},nxx.eq.${p.nxx})`).join(',')})`
    const url = `${supabaseUrl}/rest/v1/nanpa_prefixes?select=npa,nxx,thousands,prefix_type,company,state,ratecenter&or=${encodeURIComponent(orFilter)}&limit=1000`
    try {
      const res = await fetch(url, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      })
      if (!res.ok) {
        failed_lookups += chunk.length
        return
      }
      const rows = await res.json() as NanpaRow[]
      for (const row of rows) {
        map.set(`${row.npa}:${row.nxx}:${row.thousands}`, row)
      }
    } catch {
      failed_lookups += chunk.length
    }
  }))

  return { map, failed_lookups }
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s,\-/])[a-z]/g, (c) => c.toUpperCase())
}

function prettyRatecenter(rc: string): string {
  // NYC rate centers are CLLI zone codes ("NWYRCYZN01"), not real place names
  if (/^NWYRCYZN/i.test(rc)) return 'New York'
  return titleCase(rc)
}

export interface EnrichOutcome {
  results: ValidationResult[]
  /** How many US prefix lookups failed (Supabase unreachable / misconfigured).
   *  Affected numbers keep libphonenumber's FIXED_LINE_OR_MOBILE — treat their
   *  mobile/landline split as unreliable when this is non-zero. */
  enrichment_errors: number
}

/**
 * Enrich validated results in place:
 * - US numbers: NANPA thousands-block lookup → line type, carrier (company), location (ratecenter, state)
 * - Non-US numbers: Google libphonenumber metadata → carrier (e.g. 'O2'), location (geocoder)
 */
export async function enrichResults(results: ValidationResult[]): Promise<EnrichOutcome> {
  // --- US: NANPA ---
  const pairSet = new Map<string, { npa: string; nxx: string }>()
  for (const r of results) {
    if (!r.valid || r.country !== 'US' || !r.normalized_e164) continue
    const digits = r.normalized_e164.replace(/\D/g, '') // 11 digits: 1 NPA NXX XXXX
    if (digits.length === 11) {
      const npa = digits.slice(1, 4)
      const nxx = digits.slice(4, 7)
      pairSet.set(`${npa}:${nxx}`, { npa, nxx })
    }
  }

  const { map: nanpaMap, failed_lookups } = await nanpaBatchLookup(Array.from(pairSet.values()))

  // --- Non-US: Google metadata (dedupe per E.164) ---
  const nonUs = results.filter((r) => r.valid && r.country && r.country !== 'US' && r.normalized_e164)
  const metaCache = new Map<string, { carrier: string | null; location: string | null }>()
  await Promise.all(
    Array.from(new Set(nonUs.map((r) => r.normalized_e164!))).map(async (e164) => {
      try {
        const parsed = parsePhoneNumber(e164)
        const [c, g] = await Promise.all([metaCarrier(parsed), metaGeocoder(parsed)])
        metaCache.set(e164, { carrier: c ?? null, location: g ?? null })
      } catch {
        metaCache.set(e164, { carrier: null, location: null })
      }
    })
  )

  const enriched = results.map((r) => {
    if (!r.valid || !r.normalized_e164) return r

    if (r.country === 'US') {
      const digits = r.normalized_e164.replace(/\D/g, '')
      if (digits.length !== 11) return r
      const npa = digits.slice(1, 4)
      const nxx = digits.slice(4, 7)
      const thousands = digits.slice(7, 8)
      // Prefer the 1,000-block row (36% of blocks differ from base), fall back to exchange base
      const row = nanpaMap.get(`${npa}:${nxx}:${thousands}`) ?? nanpaMap.get(`${npa}:${nxx}:`)
      if (!row) return r
      const location = row.ratecenter ? `${prettyRatecenter(row.ratecenter)}, ${row.state ?? ''}`.replace(/, $/, '') : (row.state ?? null)
      return {
        ...r,
        line_type: nanpaPrefixTypeToLineType(row.prefix_type),
        nanpa_prefix_type: row.prefix_type,
        carrier: row.company ? titleCase(row.company) : null,
        location,
        source_provider: 'nanpa' as const,
        confidence: 1.0,
        confidence_label: 'prefix_valid' as const,
      }
    }

    const meta = metaCache.get(r.normalized_e164)
    if (!meta) return r
    return {
      ...r,
      carrier: meta.carrier,
      location: meta.location ?? r.country_name,
    }
  })

  return { results: enriched, enrichment_errors: failed_lookups }
}
