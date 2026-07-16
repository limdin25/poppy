import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

export interface NumberRow {
  phone: string
  country: string
  sources: string[]          // 'twilio' | 'retell'
  assigned: string | null    // business name (+ channel label)
  status: string | null      // channel status, if a channel uses this number
  routes: string[]           // human-readable voice/SMS destinations
  note: string
}

async function requireAdminEmail(req: Request): Promise<string | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
  if (!user?.email) return new Response('Unauthorized', { status: 401 })

  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('email')
    .eq('email', user.email)
    .single()
  if (!admin) return new Response('Forbidden', { status: 403 })
  return user.email
}

function describeUrl(kind: string, url: string | null | undefined): string | null {
  if (!url) return null
  if (url.includes('demo.twilio.com')) return `${kind}: unconfigured (Twilio demo)`
  const fn = url.match(/functions\/v1\/([\w-]+)/)
  if (fn) return `${kind}: Supabase fn ${fn[1]}`
  try {
    const u = new URL(url)
    return `${kind}: ${u.hostname}${u.pathname}`
  } catch {
    return `${kind}: ${url}`
  }
}

function countryOf(phone: string): string {
  if (phone.startsWith('+44')) return 'UK'
  if (phone.startsWith('+1')) return 'US'
  return '—'
}

async function fetchTwilioNumbers() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return []
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=100`,
    { headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` } },
  )
  if (!res.ok) return []
  const json = (await res.json()) as {
    incoming_phone_numbers?: Array<{
      phone_number: string
      voice_url: string | null
      sms_url: string | null
      trunk_sid: string | null
    }>
  }
  return json.incoming_phone_numbers || []
}

async function fetchRetellNumbers() {
  const key = process.env.RETELL_API_KEY
  if (!key) return []
  const res = await fetch('https://api.retellai.com/list-phone-numbers', {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) return []
  return (await res.json()) as Array<{
    phone_number: string
    phone_number_type: string
    inbound_agents?: Array<{ agent_id: string }>
  }>
}

export default async function handler(req: Request) {
  const gate = await requireAdminEmail(req)
  if (gate instanceof Response) return gate

  if (req.method === 'POST') {
    const { phone, note } = (await req.json().catch(() => ({}))) as { phone?: unknown; note?: unknown }
    if (typeof phone !== 'string' || !phone || typeof note !== 'string') {
      return Response.json({ error: 'phone and note required' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('number_notes')
      .upsert({ phone, note, updated_at: new Date().toISOString() })
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  const [twilio, retell, channelsRes, notesRes] = await Promise.all([
    fetchTwilioNumbers(),
    fetchRetellNumbers(),
    supabaseAdmin
      .from('channels')
      .select('config, status, label, businesses(name)')
      .in('type', ['voice', 'sms']),
    supabaseAdmin.from('number_notes').select('phone, note'),
  ])

  const channels = (channelsRes.data || []) as unknown as Array<{
    config: Record<string, unknown> | null
    status: string | null
    label: string | null
    businesses: { name: string } | null
  }>
  const notes = new Map((notesRes.data || []).map((n) => [n.phone, n.note]))

  const rows = new Map<string, NumberRow>()
  const rowFor = (phone: string): NumberRow => {
    let row = rows.get(phone)
    if (!row) {
      row = { phone, country: countryOf(phone), sources: [], assigned: null, status: null, routes: [], note: notes.get(phone) || '' }
      rows.set(phone, row)
    }
    return row
  }

  for (const n of twilio) {
    const row = rowFor(n.phone_number)
    row.sources.push('twilio')
    if (n.trunk_sid) row.routes.push('Voice: SIP trunk → Retell')
    else {
      const v = describeUrl('Voice', n.voice_url)
      if (v) row.routes.push(v)
    }
    const s = describeUrl('SMS', n.sms_url)
    if (s) row.routes.push(s)
  }

  for (const n of retell) {
    const row = rowFor(n.phone_number)
    row.sources.push('retell')
    const agent = n.inbound_agents?.[0]?.agent_id
    if (agent) row.routes.push(`Inbound agent: ${agent}`)
  }

  for (const ch of channels) {
    const phone = typeof ch.config?.phone === 'string' ? ch.config.phone : null
    if (!phone) continue
    const row = rowFor(phone)
    const name = [ch.businesses?.name, ch.label].filter(Boolean).join(' — ')
    if (name && !row.assigned?.includes(name)) {
      row.assigned = row.assigned ? `${row.assigned}; ${name}` : name
    }
    if (!row.status) row.status = ch.status
  }

  const sorted = [...rows.values()].sort((a, b) => a.phone.localeCompare(b.phone))
  return Response.json(sorted)
}
