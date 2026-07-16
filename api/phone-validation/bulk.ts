import { validatePhone, nanpaPrefixTypeToLineType, ValidationResult } from '../lib/phone-validation.js'

export const config = { runtime: 'edge' }

const MAX_BATCH = 500
// Supabase PostgREST caps responses at 1000 rows; each NPA-NXX has up to 11 rows (base + 10 blocks)
const PAIRS_PER_REQUEST = 90

interface NanpaRow { npa: string; nxx: string; thousands: string; prefix_type: string }

async function nanpaBatchLookup(pairs: Array<{ npa: string; nxx: string }>): Promise<Map<string, string>> {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const map = new Map<string, string>()
  if (!supabaseUrl || !supabaseKey || pairs.length === 0) return map

  const chunks: Array<Array<{ npa: string; nxx: string }>> = []
  for (let i = 0; i < pairs.length; i += PAIRS_PER_REQUEST) {
    chunks.push(pairs.slice(i, i + PAIRS_PER_REQUEST))
  }

  await Promise.all(chunks.map(async (chunk) => {
    // PostgREST or filter requires outer parens: (and(npa.eq.212,nxx.eq.260),and(...))
    const orFilter = `(${chunk.map(p => `and(npa.eq.${p.npa},nxx.eq.${p.nxx})`).join(',')})`
    const url = `${supabaseUrl}/rest/v1/nanpa_prefixes?select=npa,nxx,thousands,prefix_type&or=${encodeURIComponent(orFilter)}&limit=1000`
    const res = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    })
    if (!res.ok) return
    const rows: NanpaRow[] = await res.json()
    for (const row of rows) {
      map.set(`${row.npa}:${row.nxx}:${row.thousands}`, row.prefix_type)
    }
  }))

  return map
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const body = await req.json().catch(() => ({})) as {
    numbers?: string[]
    default_country?: string
  }

  const numbers = body.numbers ?? []
  const country = (body.default_country ?? '').toUpperCase() || undefined

  if (!Array.isArray(numbers)) {
    return new Response(JSON.stringify({ error: 'numbers must be an array' }), { status: 400 })
  }

  if (numbers.length > MAX_BATCH) {
    return new Response(
      JSON.stringify({ error: `Maximum ${MAX_BATCH} numbers per request` }),
      { status: 400 }
    )
  }

  // Phase 1: libphonenumber validation
  let results: ValidationResult[] = numbers.map((n) => validatePhone(String(n), country))

  // Phase 2: NANPA enrichment for valid US numbers (thousands-block granularity, base fallback)
  const usValid = results.filter((r) => r.valid && r.country === 'US' && r.normalized_e164)

  if (usValid.length > 0) {
    const pairSet = new Map<string, { npa: string; nxx: string }>()
    for (const r of usValid) {
      const digits = r.normalized_e164!.replace(/\D/g, '') // 11 digits: 1 NPA NXX XXXX
      if (digits.length === 11) {
        const npa = digits.slice(1, 4)
        const nxx = digits.slice(4, 7)
        pairSet.set(`${npa}:${nxx}`, { npa, nxx })
      }
    }

    const nanpaMap = await nanpaBatchLookup(Array.from(pairSet.values()))

    results = results.map((r) => {
      if (!r.valid || r.country !== 'US' || !r.normalized_e164) return r
      const digits = r.normalized_e164.replace(/\D/g, '')
      if (digits.length !== 11) return r
      const npa = digits.slice(1, 4)
      const nxx = digits.slice(4, 7)
      const thousands = digits.slice(7, 8)
      // Prefer the 1,000-block row (36% of blocks differ from base), fall back to exchange base
      const prefixType = nanpaMap.get(`${npa}:${nxx}:${thousands}`) ?? nanpaMap.get(`${npa}:${nxx}:`)
      if (!prefixType) return r
      return {
        ...r,
        line_type: nanpaPrefixTypeToLineType(prefixType),
        nanpa_prefix_type: prefixType,
        source_provider: 'nanpa' as const,
        confidence: 1.0,
        confidence_label: 'prefix_valid' as const,
      }
    })
  }

  const summary = {
    total: results.length,
    valid: results.filter((r) => r.valid).length,
    invalid: results.filter((r) => !r.valid).length,
    mobile: results.filter((r) => r.line_type === 'MOBILE').length,
    fixed_line: results.filter((r) => r.line_type === 'FIXED_LINE').length,
    fixed_line_or_mobile: results.filter((r) => r.line_type === 'FIXED_LINE_OR_MOBILE').length,
    voip: results.filter((r) => r.line_type === 'VOIP').length,
    toll_free: results.filter((r) => r.line_type === 'TOLL_FREE').length,
    unknown_type: results.filter((r) => r.line_type === 'UNKNOWN' && r.valid).length,
    empty: results.filter((r) => r.confidence_label === 'empty').length,
    malformed: results.filter((r) => r.confidence_label === 'malformed').length,
    impossible: results.filter((r) => r.confidence_label === 'impossible').length,
  }

  return new Response(JSON.stringify({ summary, results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
