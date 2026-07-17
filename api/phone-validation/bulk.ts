import type { VercelRequest, VercelResponse } from '@vercel/node'
import { validatePhone, ValidationResult } from '../lib/phone-validation.js'
import { enrichResults } from '../lib/phone-enrich.js'
import { checkSmsDeliverability } from '../lib/twilio-lookup.js'
import { requireAdminNode } from '../lib/require-admin.js'

// Node runtime: libphonenumber-geo-carrier ships ~13MB of metadata (too big for edge).
// maxDuration: up to 500 Twilio lookups per batch (cache misses) at concurrency 20.
export const config = { runtime: 'nodejs', maxDuration: 60 }

const MAX_BATCH = 500

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdminNode(req)
  if ('status' in auth) {
    return res.status(auth.status).json({ error: auth.error })
  }

  const body = (req.body ?? {}) as { numbers?: string[]; default_country?: string }
  const numbers = body.numbers ?? []
  const country = (body.default_country ?? '').toUpperCase() || undefined

  if (!Array.isArray(numbers)) {
    return res.status(400).json({ error: 'numbers must be an array' })
  }

  if (numbers.length > MAX_BATCH) {
    return res.status(400).json({ error: `Maximum ${MAX_BATCH} numbers per request` })
  }

  const validated: ValidationResult[] = numbers.map((n) => validatePhone(String(n), country))
  const { results: enriched, enrichment_errors } = await enrichResults(validated)

  // Live Twilio Lookup on US mobiles only — the free classifier already rejects
  // landlines/VoIP/toll-free; this catches numbers ported OFF their wireless
  // block (invisible to block-level NANPA data — 2026-07-17 audit).
  const usMobiles = enriched.filter((r) => r.valid && r.country === 'US' && r.line_type === 'MOBILE' && r.normalized_e164)
  const smsChecks = await checkSmsDeliverability(usMobiles.map((r) => r.normalized_e164!))
  const results = enriched.map((r) => {
    if (!r.valid || r.country !== 'US' || r.line_type !== 'MOBILE' || !r.normalized_e164) return r
    const check = smsChecks.get(r.normalized_e164)
    return check ? { ...r, ...check } : r
  })

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
    enrichment_errors,
    sms_blocked: results.filter((r) => r.sms_deliverable === false).length,
    sms_lookup_errors: results.filter((r) => r.sms_check_reason === 'lookup_failed').length,
  }

  return res.status(200).json({ summary, results })
}
