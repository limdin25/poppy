// Twilio Lookup v2 line_type_intelligence — per-number live check ($0.008/lookup).
// Catches numbers ported off their NANPA wireless block (the blindspot of the
// self-hosted prefix classifier — see docs/INTEGRATIONS.md "SMS geo-permissions"
// neighbour section and the 2026-07-17 deliverability audit).
// Results are cached in Supabase (phone_lti_cache) so re-validating a list is free.

const LTI_CACHE_TTL_DAYS = 90
const LOOKUP_CONCURRENCY = 20

export interface LtiResult {
  lti_type: string | null
  carrier_name: string | null
  /** true = lookup (or cache) answered; false = lookup failed, fields are null */
  ok: boolean
}

export interface SmsCheck {
  /** false = do not text this number; null = check failed, unknown */
  sms_deliverable: boolean | null
  sms_check_reason:
    | 'mobile'
    | 'voip_sms_enabled'
    | 'voip_no_sms_route'
    | 'landline'
    | 'non_mobile'
    | 'lookup_failed'
  lti_type: string | null
  lti_carrier: string | null
}

// VoIP numbers whose carrier record names an SMS messaging partner DO deliver
// (audit 2026-07-17: 7/7 delivered VoIP had one; 3/3 failed VoIP were bare CLECs).
// Expandable allowlist — add tokens only with evidence.
const SMS_ROUTE_TOKENS = ['SINCH', 'INFOBIP', 'TWILIO', 'SMS', 'MMS', 'MESSAGING']

/** Pure decision: can this number receive SMS, given its Lookup line type + carrier? */
export function smsTextability(ltiType: string | null, carrierName: string | null): SmsCheck {
  const base = { lti_type: ltiType, lti_carrier: carrierName }
  if (!ltiType) return { ...base, sms_deliverable: null, sms_check_reason: 'lookup_failed' }
  if (ltiType === 'mobile') return { ...base, sms_deliverable: true, sms_check_reason: 'mobile' }
  if (ltiType === 'fixedVoip' || ltiType === 'nonFixedVoip') {
    const c = (carrierName ?? '').toUpperCase()
    const hasRoute = SMS_ROUTE_TOKENS.some((t) => c.includes(t))
    return hasRoute
      ? { ...base, sms_deliverable: true, sms_check_reason: 'voip_sms_enabled' }
      : { ...base, sms_deliverable: false, sms_check_reason: 'voip_no_sms_route' }
  }
  if (ltiType === 'landline') return { ...base, sms_deliverable: false, sms_check_reason: 'landline' }
  return { ...base, sms_deliverable: false, sms_check_reason: 'non_mobile' }
}

function supabaseHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

async function cacheRead(e164s: string[]): Promise<Map<string, LtiResult>> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const map = new Map<string, LtiResult>()
  if (!url || !key || e164s.length === 0) return map
  const cutoff = Date.now() - LTI_CACHE_TTL_DAYS * 86400_000
  for (let i = 0; i < e164s.length; i += 100) {
    const chunk = e164s.slice(i, i + 100)
    const filter = `in.(${chunk.map((n) => `"${n}"`).join(',')})`
    try {
      const res = await fetch(
        `${url}/rest/v1/phone_lti_cache?select=e164,lti_type,carrier_name,checked_at&e164=${encodeURIComponent(filter)}`,
        { headers: supabaseHeaders(key) },
      )
      if (!res.ok) continue
      const rows: Array<{ e164: string; lti_type: string | null; carrier_name: string | null; checked_at: string }> = await res.json()
      for (const row of rows) {
        if (new Date(row.checked_at).getTime() < cutoff) continue
        map.set(row.e164, { lti_type: row.lti_type, carrier_name: row.carrier_name, ok: true })
      }
    } catch {
      // cache is best-effort; misses just cost a lookup
    }
  }
  return map
}

async function cacheWrite(entries: Array<{ e164: string; lti_type: string | null; carrier_name: string | null }>): Promise<void> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || entries.length === 0) return
  const now = new Date().toISOString()
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100).map((e) => ({ ...e, checked_at: now }))
    try {
      await fetch(`${url}/rest/v1/phone_lti_cache?on_conflict=e164`, {
        method: 'POST',
        headers: { ...supabaseHeaders(key), Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(chunk),
      })
    } catch {
      // best-effort
    }
  }
}

async function lookupOne(e164: string, sid: string, token: string): Promise<LtiResult> {
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: auth } })
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      if (!res.ok) return { lti_type: null, carrier_name: null, ok: false }
      const json = await res.json() as { line_type_intelligence?: { type?: string | null; carrier_name?: string | null } }
      return {
        lti_type: json.line_type_intelligence?.type ?? null,
        carrier_name: json.line_type_intelligence?.carrier_name ?? null,
        ok: true,
      }
    } catch {
      // network hiccup — retry once
    }
  }
  return { lti_type: null, carrier_name: null, ok: false }
}

/**
 * Live SMS-deliverability check for a set of E.164 numbers.
 * Cache-first (Supabase phone_lti_cache), then Twilio Lookup for misses.
 * Returns a map of e164 → SmsCheck. Lookup failures come back as
 * sms_deliverable=null ('lookup_failed') — callers should fail OPEN on those
 * (don't drop a whole list because Lookup had an outage), but surface the count.
 */
export async function checkSmsDeliverability(e164s: string[]): Promise<Map<string, SmsCheck>> {
  const unique = Array.from(new Set(e164s))
  const out = new Map<string, SmsCheck>()
  if (unique.length === 0) return out

  const cached = await cacheRead(unique)
  const misses = unique.filter((n) => !cached.has(n))

  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const fresh = new Map<string, LtiResult>()
  if (sid && token && misses.length > 0) {
    let cursor = 0
    async function worker() {
      while (cursor < misses.length) {
        const n = misses[cursor++]
        fresh.set(n, await lookupOne(n, sid!, token!))
      }
    }
    await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, misses.length) }, worker))
    await cacheWrite(
      misses
        .map((n) => ({ n, r: fresh.get(n) }))
        .filter((x): x is { n: string; r: LtiResult } => Boolean(x.r?.ok))
        .map(({ n, r }) => ({ e164: n, lti_type: r.lti_type, carrier_name: r.carrier_name })),
    )
  }

  for (const n of unique) {
    const r = cached.get(n) ?? fresh.get(n)
    out.set(n, r?.ok ? smsTextability(r.lti_type, r.carrier_name) : smsTextability(null, null))
  }
  return out
}
