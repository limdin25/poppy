// Twilio Lookup v2 line_type_intelligence — per-number live check ($0.008/lookup).
// Catches numbers ported off their NANPA wireless block (the blindspot of the
// self-hosted prefix classifier — see docs/INTEGRATIONS.md "SMS geo-permissions"
// neighbour section and the 2026-07-17 deliverability audit).
// Results are cached in Supabase (phone_lti_cache) so re-validating a list is free.

export const LTI_CACHE_TTL_DAYS = 90
const LOOKUP_CONCURRENCY = 20

// Line STATUS is a different kind of fact from line TYPE, so it gets its own
// cache table and its own, much shorter TTL. 90 days is right for a line type:
// mobile-vs-landline is a property of the numbering plan and effectively never
// changes. A line status is live state. A subscription that answers today can be
// cut off next week, so a 90-day-old "reachable" would quietly re-open the exact
// hole this screen exists to close. 7 days is one working week: re-running a
// list mid-campaign is free, and nothing older than a week is ever trusted.
export const LINE_STATUS_CACHE_TTL_DAYS = 7

// Measured on Hugo's own account 2026-07-28, Twilio usage category
// "line-status-lookups": 114 lookups billed GBP 0.60306, i.e. GBP 0.00529 each.
// About half a penny a number, GBP 5.29 per 1,000 leads.
export const LINE_STATUS_GBP_PER_LOOKUP = 0.0053

// Spend cap and answer-rate floor. Same numbers as the script twin
// (scripts/lib/line-status.mjs), asserted equal in tests/line-status.test.ts so
// the two cannot drift. GBP 15 is about 2,830 numbers.
export const LINE_STATUS_MAX_SPEND_GBP = 15
export const LINE_STATUS_MIN_ANSWER_RATE = 0.5

export interface SpendCheck {
  lookups: number
  estimateGbp: number
  capGbp: number
  over: boolean
  suggestGbp: number
}

/** Pure: is this run about to spend more than the cap allows? `lookups` counts
 *  only the PAID lookups, cache hits are free and excluded. */
export function spendCheck(lookups: number, capGbp: number = LINE_STATUS_MAX_SPEND_GBP): SpendCheck {
  const estimateGbp = lookups * LINE_STATUS_GBP_PER_LOOKUP
  return {
    lookups,
    estimateGbp,
    capGbp,
    over: estimateGbp > capGbp,
    suggestGbp: Math.max(1, Math.ceil(estimateGbp)),
  }
}

export interface AnswerVerdict {
  attempted: number
  answered: number
  rate: number
  ok: boolean
  reason: 'nothing_to_look_up' | 'ok' | 'too_few_answered'
}

/**
 * Pure: did enough lookups actually answer for the screen to count as run?
 *
 * Each individual failure fails open, which is right for one number and wrong
 * for all of them: with bad credentials or a Twilio outage every number comes
 * back "unknown", every lead is kept, and a totally broken screen is
 * indistinguishable from a clean one.
 *
 * ZERO ATTEMPTED IS NOT A FAILURE. A fully cached list asks nothing and so
 * answers nothing, and that is the cheapest possible good outcome.
 */
export function answerVerdict(
  attempted: number,
  answered: number,
  minRate: number = LINE_STATUS_MIN_ANSWER_RATE,
): AnswerVerdict {
  if (attempted <= 0) return { attempted: 0, answered: 0, rate: 1, ok: true, reason: 'nothing_to_look_up' }
  const rate = answered / attempted
  return { attempted, answered, rate, ok: rate >= minRate, reason: rate >= minRate ? 'ok' : 'too_few_answered' }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Line status, the LIVE mobile-network screen (GBP 0.0053 a number)
//
// WHY. Hugo, 2026-07-28: Maria cold-texted 100 UK plumbers, 5 numbers were dead
// on the network. Our own check is libphonenumber, an OFFLINE rulebook. It
// proves a number is a well-formed, allocated GB mobile; it cannot know whether
// the subscription is still alive (api/lib/phone-validation.ts hardcodes
// active_status:'unknown'). line_type_intelligence, above, is no help either:
// all 8 dead numbers came back valid:true, type:mobile, on real carriers.
// line_status asks the subscriber's own operator, and on those same numbers it
// was right. 7 of 8 dead came back "inactive", and all 91 that delivered came
// back "reachable", zero false positives. This protects the sender reputation of
// a brand-new UK long code; the wasted 4p of texts is not the point.
//
// REAL RESPONSE SHAPE, confirmed against the live API 2026-07-28, not guessed:
//   GET https://lookups.twilio.com/v2/PhoneNumbers/{E164}?Fields=line_status
//   { "phone_number": "+447969101205", "valid": true, "country_code": "GB",
//     "line_status": { "status": "inactive", "error_code": null },
//     "line_type_intelligence": null, ... }
// `line_status` is null (with HTTP 200, valid:false) when the number is not a
// real number at all, and can be null when Twilio has no data for that operator.
// ─────────────────────────────────────────────────────────────────────────────

/** The five values Twilio documents for line_status.status. */
export type LineStatus = 'active' | 'reachable' | 'unreachable' | 'inactive' | 'unknown'

export interface LineStatusCheck {
  /** false = dead subscription, do not text; null = no answer, treat as alive */
  line_alive: boolean | null
  line_status_reason: 'inactive' | 'reachable' | 'active' | 'unreachable' | 'unknown' | 'lookup_failed'
  line_status: string | null
}

/**
 * Pure decision: should this number be screened out of a campaign?
 *
 * WE SCREEN ON EXACTLY ONE STATUS: "inactive". Twilio returns five.
 *
 *   inactive    : the operator has no subscriber on this number, or it is not a
 *                 real number. Dead. This is the only one we drop.
 *
 *   unreachable : a REAL, PAYING subscriber whose handset is switched off or out
 *                 of signal RIGHT NOW. NEVER screen these out. A plumber under a
 *                 floor, in a basement, on a plane or on a flat battery is a live
 *                 lead: the network queues the SMS and delivers it when the phone
 *                 comes back. Dropping "unreachable" would destroy good leads for
 *                 nothing, and it would do it silently.
 *
 *   active      : alive on the network (not necessarily reachable this second).
 *   reachable   : alive and connected right now.
 *   unknown     : Twilio could not reach the operator. That is an absence of
 *                 evidence, not evidence of death. Keep the lead.
 */
export function lineAlive(status: string | null): LineStatusCheck {
  if (!status) return { line_alive: null, line_status_reason: 'lookup_failed', line_status: null }
  const s = status.toLowerCase()
  // The one and only screen-out.
  if (s === 'inactive') return { line_alive: false, line_status_reason: 'inactive', line_status: s }
  if (s === 'reachable') return { line_alive: true, line_status_reason: 'reachable', line_status: s }
  if (s === 'active') return { line_alive: true, line_status_reason: 'active', line_status: s }
  // Switched off right now. Alive. Keep.
  if (s === 'unreachable') return { line_alive: true, line_status_reason: 'unreachable', line_status: s }
  // 'unknown', or anything Twilio adds later: fail OPEN, keep the lead.
  return { line_alive: null, line_status_reason: 'unknown', line_status: s }
}

interface LineStatusRow {
  status: string | null
  error_code: number | null
  /** true = lookup (or cache) answered; false = lookup failed, fields are null */
  ok: boolean
}

async function lineStatusCacheRead(e164s: string[]): Promise<Map<string, LineStatusRow>> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const map = new Map<string, LineStatusRow>()
  if (!url || !key || e164s.length === 0) return map
  const cutoff = Date.now() - LINE_STATUS_CACHE_TTL_DAYS * 86400_000
  for (let i = 0; i < e164s.length; i += 100) {
    const chunk = e164s.slice(i, i + 100)
    const filter = `in.(${chunk.map((n) => `"${n}"`).join(',')})`
    try {
      const res = await fetch(
        `${url}/rest/v1/phone_line_status_cache?select=e164,line_status,error_code,checked_at&e164=${encodeURIComponent(filter)}`,
        { headers: supabaseHeaders(key) },
      )
      if (!res.ok) continue
      const rows = await res.json() as Array<{ e164: string; line_status: string | null; error_code: number | null; checked_at: string }>
      for (const row of rows) {
        if (new Date(row.checked_at).getTime() < cutoff) continue
        map.set(row.e164, { status: row.line_status, error_code: row.error_code, ok: true })
      }
    } catch {
      // cache is best-effort; a miss just costs one lookup
    }
  }
  return map
}

async function lineStatusCacheWrite(entries: Array<{ e164: string; line_status: string | null; error_code: number | null }>): Promise<void> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || entries.length === 0) return
  const now = new Date().toISOString()
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100).map((e) => ({ ...e, checked_at: now }))
    try {
      await fetch(`${url}/rest/v1/phone_line_status_cache?on_conflict=e164`, {
        method: 'POST',
        headers: { ...supabaseHeaders(key), Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(chunk),
      })
    } catch {
      // best-effort
    }
  }
}

async function lineStatusOne(e164: string, sid: string, token: string): Promise<LineStatusRow> {
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_status`
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: auth } })
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      if (!res.ok) return { status: null, error_code: null, ok: false }
      const json = await res.json() as { line_status?: { status?: string | null; error_code?: number | null } | null }
      const ls = json.line_status
      // A 200 with line_status:null means Twilio has no answer for this number.
      // That is not "dead", it is "no data", so it must fail OPEN.
      if (!ls || !ls.status) return { status: null, error_code: ls?.error_code ?? null, ok: false }
      return { status: ls.status, error_code: ls.error_code ?? null, ok: true }
    } catch {
      // network hiccup, retry once
    }
  }
  return { status: null, error_code: null, ok: false }
}

/**
 * Live mobile-network screen for a set of E.164 numbers.
 * Cache-first (Supabase phone_line_status_cache, 7-day TTL), then Twilio Lookup
 * for the misses. A repeat run inside the TTL re-bills nothing.
 *
 * FAILS OPEN on any INDIVIDUAL number: no Twilio credentials, a non-200, a
 * network error, a 200 with no line_status all come back line_alive=null, which
 * callers treat as "keep the lead and warn". Twilio having a bad minute must
 * never silently delete somebody's list.
 *
 * IT DOES NOT FAIL OPEN ON THE WHOLE SCREEN. Two guards throw instead, matching
 * the script twin (which prints a banner and exits, because a script can):
 *   - over the spend cap: throws BEFORE buying a single lookup
 *   - fewer than half the attempted lookups answered: throws, because a screen
 *     that answered nothing is an outage, not a result, and returning
 *     all-null here would look exactly like a clean run
 * Pass maxSpendGbp: Infinity / minAnswerRate: 0 to opt a caller out.
 */
export async function checkLineStatus(
  e164s: string[],
  opts: { maxSpendGbp?: number; minAnswerRate?: number } = {},
): Promise<Map<string, LineStatusCheck>> {
  const unique = Array.from(new Set(e164s))
  const out = new Map<string, LineStatusCheck>()
  if (unique.length === 0) return out

  const cached = await lineStatusCacheRead(unique)
  const misses = unique.filter((n) => !cached.has(n))

  const spend = spendCheck(misses.length, opts.maxSpendGbp ?? LINE_STATUS_MAX_SPEND_GBP)
  if (spend.over) {
    throw new Error(
      `line_status spend cap: ${spend.lookups} lookup(s) = about GBP ${spend.estimateGbp.toFixed(2)}, `
      + `cap GBP ${spend.capGbp.toFixed(2)}. Nothing was spent.`,
    )
  }

  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const fresh = new Map<string, LineStatusRow>()
  let answeredCount = 0
  if (sid && token && misses.length > 0) {
    let cursor = 0
    async function worker() {
      while (cursor < misses.length) {
        const n = misses[cursor++]
        fresh.set(n, await lineStatusOne(n, sid!, token!))
      }
    }
    await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, misses.length) }, worker))
    const answered = misses
      .map((n) => ({ n, r: fresh.get(n) }))
      .filter((x): x is { n: string; r: LineStatusRow } => Boolean(x.r?.ok))
    answeredCount = answered.length
    await lineStatusCacheWrite(
      answered.map(({ n, r }) => ({ e164: n, line_status: r.status, error_code: r.error_code })),
    )
  }

  const verdict = answerVerdict(misses.length, answeredCount, opts.minAnswerRate ?? LINE_STATUS_MIN_ANSWER_RATE)
  if (!verdict.ok) {
    throw new Error(
      `line_status screen did not run: asked about ${verdict.attempted} number(s), `
      + `only ${verdict.answered} answered. Check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN and status.twilio.com. `
      + 'Refusing to return an unscreened list that looks screened.',
    )
  }

  for (const n of unique) {
    const r = cached.get(n) ?? fresh.get(n)
    out.set(n, lineAlive(r?.ok ? r.status : null))
  }
  return out
}
