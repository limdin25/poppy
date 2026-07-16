import type { VercelRequest, VercelResponse } from '@vercel/node'
import { validatePhone, ValidationResult } from '../lib/phone-validation.js'
import { enrichResults } from '../lib/phone-enrich.js'
import { requireAdminNode } from '../lib/require-admin.js'

// Node runtime: libphonenumber-geo-carrier ships ~13MB of metadata (too big for edge)
export const config = { runtime: 'nodejs' }

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
  const { results, enrichment_errors } = await enrichResults(validated)

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
  }

  return res.status(200).json({ summary, results })
}
