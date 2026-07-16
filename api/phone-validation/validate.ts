import { validatePhone } from '../lib/phone-validation.js'

export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const body = await req.json().catch(() => ({})) as { number?: string; default_country?: string }
  const raw = (body.number ?? '').trim()
  const country = (body.default_country ?? '').toUpperCase() || undefined

  const result = validatePhone(raw, country)

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
