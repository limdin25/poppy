import type { VercelRequest, VercelResponse } from '@vercel/node'
import { validatePhone } from '../lib/phone-validation.js'
import { enrichResults } from '../lib/phone-enrich.js'
import { checkSmsDeliverability } from '../lib/twilio-lookup.js'
import { requireAdminNode } from '../lib/require-admin.js'

// Node runtime: libphonenumber-geo-carrier ships ~13MB of metadata (too big for edge)
export const config = { runtime: 'nodejs' }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdminNode(req)
  if ('status' in auth) {
    return res.status(auth.status).json({ error: auth.error })
  }

  const body = (req.body ?? {}) as { number?: string; default_country?: string }
  const raw = (body.number ?? '').trim()
  const country = (body.default_country ?? '').toUpperCase() || undefined

  const { results: [result], enrichment_errors } = await enrichResults([validatePhone(raw, country)])

  // Live Twilio Lookup for US mobiles (same rule as bulk — see twilio-lookup.ts)
  let final = result
  if (result.valid && result.country === 'US' && result.line_type === 'MOBILE' && result.normalized_e164) {
    const check = (await checkSmsDeliverability([result.normalized_e164])).get(result.normalized_e164)
    if (check) final = { ...result, ...check }
  }

  return res.status(200).json({ ...final, enrichment_errors })
}
