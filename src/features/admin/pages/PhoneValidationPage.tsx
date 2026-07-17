import { useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  Phone, Upload, CheckCircle2, XCircle, Smartphone, PhoneCall, Wifi, HelpCircle,
  AlertTriangle, Download, ExternalLink, ChevronDown, ChevronRight, Send, X, Users,
  MessageSquareOff,
} from 'lucide-react'
import { supabase } from '@/integrations/supabase/browser'

interface ValidationResult {
  input_number: string
  normalized_e164: string | null
  international_format: string | null
  national_format: string | null
  national_number: string | null
  country: string | null
  country_name: string | null
  country_calling_code: string | null
  line_type: string | null
  carrier: string | null
  location: string | null
  active_status: string
  possible: boolean
  confidence: number
  confidence_label: string
  reason: string | null
  valid: boolean
  source_provider: string
  nanpa_prefix_type?: string
  checked_at: string
  cache_ttl: number
  sms_deliverable?: boolean | null
  sms_check_reason?: string
  lti_type?: string | null
  lti_carrier?: string | null
}

/** Extra columns carried through from the uploaded CSV, aligned by row. */
interface RowMeta {
  business_name: string
  website: string
  address: string
  location: string
  category: string
}

interface Row extends ValidationResult {
  meta: RowMeta
}

interface Summary {
  total: number
  valid: number
  invalid: number
  mobile: number
  fixed_line: number
  fixed_line_or_mobile: number
  voip: number
  toll_free: number
  unknown_type: number
  empty: number
  malformed: number
  impossible: number
  enrichment_errors: number
  sms_blocked: number
  sms_lookup_errors: number
}

const EMPTY_META: RowMeta = { business_name: '', website: '', address: '', location: '', category: '' }

const LINE_TYPE_LABELS: Record<string, { label: string; color: string; icon: typeof Phone }> = {
  MOBILE:                { label: 'Mobile',           color: 'text-green-600 bg-green-50',  icon: Smartphone },
  FIXED_LINE:            { label: 'Landline',          color: 'text-blue-600 bg-blue-50',   icon: PhoneCall },
  FIXED_LINE_OR_MOBILE:  { label: 'Mobile/Landline',   color: 'text-yellow-600 bg-yellow-50', icon: Phone },
  VOIP:                  { label: 'VoIP',              color: 'text-purple-600 bg-purple-50', icon: Wifi },
  TOLL_FREE:             { label: 'Toll-Free',         color: 'text-cyan-600 bg-cyan-50',   icon: Phone },
  UNKNOWN:               { label: 'Unknown',           color: 'text-gray-500 bg-gray-50',   icon: HelpCircle },
}

function LineTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs text-ink-muted">—</span>
  const meta = LINE_TYPE_LABELS[type] ?? { label: type, color: 'text-gray-500 bg-gray-50', icon: HelpCircle }
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.color}`}>
      <Icon size={10} />
      {meta.label}
    </span>
  )
}

const SMS_BLOCK_LABELS: Record<string, string> = {
  voip_no_sms_route: 'VoIP — no text route',
  landline: 'Ported to landline',
  non_mobile: 'Not a mobile',
}

/** Red flag shown when the live Twilio check says the number can't receive SMS. */
function NoTextBadge({ reason }: { reason?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700" title="Live Twilio Lookup: this number cannot receive SMS">
      <MessageSquareOff size={10} />
      {SMS_BLOCK_LABELS[reason ?? ''] ?? "Can't text"}
    </span>
  )
}

function StatusBadge({ valid, reason }: { valid: boolean; reason: string | null }) {
  if (valid) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
        <CheckCircle2 size={10} />
        Valid
      </span>
    )
  }
  const label = reason === 'empty' ? 'Empty' : reason === 'malformed' ? 'Malformed' : 'Invalid'
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
      <XCircle size={10} />
      {label}
    </span>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value.toLocaleString()}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-muted">{sub}</p>}
    </div>
  )}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <dt className="w-48 shrink-0 text-[12px] text-ink-muted">{label}</dt>
      <dd className="text-[13px] text-ink">{value ?? '—'}</dd>
    </div>
  )
}

/** Full "Numbering metadata" panel for one number. */
function NumberDetail({ row }: { row: Row }) {
  return (
    <div className="grid gap-x-8 gap-y-1 bg-surface-hover/40 px-6 py-4 sm:grid-cols-2">
      <dl>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Numbering metadata</p>
        <DetailRow label="International format" value={row.international_format} />
        <DetailRow label="E.164" value={<span className="font-mono">{row.normalized_e164 ?? '—'}</span>} />
        <DetailRow label="National format" value={row.national_format} />
        <DetailRow label="National number" value={<span className="font-mono">{row.national_number ?? '—'}</span>} />
        <DetailRow label="Country or numbering region" value={row.country_name ? `${row.country_name} (${row.country})` : row.country} />
        <DetailRow label="Country calling code" value={row.country_calling_code} />
        <DetailRow label="Number category" value={<LineTypeBadge type={row.line_type} />} />
        <DetailRow label="Metadata validity" value={row.valid ? 'Yes' : `No${row.reason ? ` (${row.reason})` : ''}`} />
        <DetailRow label="Possible length/pattern" value={row.possible ? 'Yes' : 'No'} />
        <DetailRow label="Numbering-plan location" value={row.location ?? row.country_name} />
        <DetailRow label="Metadata carrier" value={row.carrier} />
        {row.nanpa_prefix_type && <DetailRow label="NANPA prefix type" value={row.nanpa_prefix_type} />}
        <DetailRow label="Source" value={row.source_provider === 'nanpa' ? 'NANPA prefix database (self-hosted)' : 'libphonenumber'} />
        {row.sms_deliverable !== undefined && (
          <>
            <DetailRow
              label="Live SMS check (Twilio)"
              value={row.sms_deliverable === true
                ? <span className="text-green-700">Can receive texts</span>
                : row.sms_deliverable === false
                  ? <NoTextBadge reason={row.sms_check_reason} />
                  : <span className="text-amber-700">Check failed — unverified</span>}
            />
            {row.lti_type && <DetailRow label="Current line type" value={row.lti_type} />}
            {row.lti_carrier && <DetailRow label="Current carrier" value={row.lti_carrier} />}
          </>
        )}
      </dl>
      {(row.meta.business_name || row.meta.website || row.meta.address) && (
        <dl>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Business</p>
          <DetailRow label="Name" value={row.meta.business_name || '—'} />
          <DetailRow
            label="Website"
            value={row.meta.website
              ? <a href={row.meta.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">{row.meta.website}<ExternalLink size={11} /></a>
              : '—'}
          />
          <DetailRow label="Address" value={[row.meta.address, row.meta.location].filter(Boolean).join(', ') || '—'} />
          {row.meta.category && <DetailRow label="Category" value={row.meta.category} />}
        </dl>
      )}
    </div>
  )
}

const PHONE_KEYS = ['phone', 'mobile', 'number', 'tel', 'whatsapp']
const NAME_KEYS = ['name', 'business_name', 'business', 'company', 'full_name', 'contact_name']
const WEBSITE_KEYS = ['website', 'url', 'web', 'site', 'link']
const ADDRESS_KEYS = ['address', 'street_address', 'street']
const LOCATION_KEYS = ['location', 'city', 'area']
const CATEGORY_KEYS = ['category', 'type', 'keyword']

function pickCol(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.indexOf(c)
    if (i !== -1) return i
  }
  return -1
}

/** Parse CSV keeping business columns aligned with each phone. */
function parseCsvRows(csv: string): { numbers: string[]; metas: RowMeta[]; error?: string } {
  const parsed = Papa.parse<string[]>(csv.replace(/^﻿/, ''), { skipEmptyLines: true })
  const data = parsed.data
  if (data.length < 2) return { numbers: [], metas: [], error: 'CSV appears empty.' }
  const headers = data[0].map((h) => h.replace(/^﻿/, '').trim().toLowerCase())
  const phoneIdx = pickCol(headers, PHONE_KEYS)
  if (phoneIdx === -1) return { numbers: [], metas: [], error: 'No phone column found (looked for: phone, mobile, number, tel).' }
  const nameIdx = pickCol(headers, NAME_KEYS)
  const webIdx = pickCol(headers, WEBSITE_KEYS)
  const addrIdx = pickCol(headers, ADDRESS_KEYS)
  const locIdx = pickCol(headers, LOCATION_KEYS)
  const catIdx = pickCol(headers, CATEGORY_KEYS)

  const numbers: string[] = []
  const metas: RowMeta[] = []
  for (const cols of data.slice(1)) {
    const phone = (cols[phoneIdx] ?? '').trim()
    if (!phone) continue
    numbers.push(phone)
    metas.push({
      business_name: nameIdx !== -1 ? (cols[nameIdx] ?? '').trim() : '',
      website: webIdx !== -1 ? (cols[webIdx] ?? '').trim() : '',
      address: addrIdx !== -1 ? (cols[addrIdx] ?? '').trim() : '',
      location: locIdx !== -1 ? (cols[locIdx] ?? '').trim() : '',
      category: catIdx !== -1 ? (cols[catIdx] ?? '').trim() : '',
    })
  }
  return { numbers, metas }
}

type Filter = 'all' | 'valid' | 'invalid' | 'mobile' | 'landline' | 'voip'

function matchesFilter(r: Row, filter: Filter): boolean {
  if (filter === 'valid') return r.valid
  if (filter === 'invalid') return !r.valid
  if (filter === 'mobile') return r.line_type === 'MOBILE'
  if (filter === 'landline') return r.line_type === 'FIXED_LINE' || r.line_type === 'FIXED_LINE_OR_MOBILE'
  if (filter === 'voip') return r.line_type === 'VOIP'
  return true
}

/** Send the given rows to the CRM: upsert wk_contacts + tag them (new AND existing). */
async function sendToCrm(rows: Row[], tag: string, onProgress: (done: number, total: number) => void) {
  const { data: { user } } = await supabase.auth.getUser()
  const ownerAgentId = user?.id ?? null

  // Dedupe by E.164
  const seen = new Set<string>()
  const unique = rows.filter((r) => {
    if (!r.valid || !r.normalized_e164 || seen.has(r.normalized_e164)) return false
    seen.add(r.normalized_e164)
    return true
  })

  const inserts = unique.map((r) => ({
    name: r.meta.business_name || r.international_format || r.normalized_e164!,
    phone: r.normalized_e164!,
    email: null,
    owner_agent_id: ownerAgentId,
    pipeline_column_id: null,
    is_hot: false,
    custom_fields: {
      source: 'phone-validator',
      ...(r.meta.website ? { property_url: r.meta.website } : {}),
      ...(r.meta.address || r.meta.location
        ? { property_address: [r.meta.address, r.meta.location].filter(Boolean).join(', ') }
        : {}),
      ...(r.meta.category ? { category: r.meta.category } : {}),
      ...(r.line_type ? { line_type: r.line_type } : {}),
      ...(r.carrier ? { carrier: r.carrier } : {}),
    },
  }))

  const errors: string[] = []
  let inserted = 0
  const allPhones = inserts.map((i) => i.phone)
  const CHUNK = 50

  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('wk_contacts' as any) as any)
      .upsert(slice, { onConflict: 'phone', ignoreDuplicates: true })
      .select('id')
    if (error) { errors.push(error.message); continue }
    inserted += ((data ?? []) as unknown[]).length
    onProgress(Math.min(i + CHUNK, inserts.length), inserts.length)
  }

  // Tag every contact in this batch — including ones that already existed —
  // so the whole list is targetable in Broadcasts by this tag.
  let tagged = 0
  const tagName = tag.trim()
  if (tagName) {
    const ids: string[] = []
    for (let i = 0; i < allPhones.length; i += 100) {
      const slice = allPhones.slice(i, i + 100)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('wk_contacts' as any) as any)
        .select('id')
        .in('phone', slice)
      if (error) { errors.push(`lookup: ${error.message}`); continue }
      ids.push(...((data ?? []) as Array<{ id: string }>).map((r) => r.id))
    }
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100).map((id) => ({ contact_id: id, tag: tagName }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('wk_contact_tags' as any) as any)
        .upsert(slice, { onConflict: 'contact_id,tag', ignoreDuplicates: true })
      if (error) { errors.push(`tags: ${error.message}`); continue }
      tagged += slice.length
    }
  }

  return { total: unique.length, inserted, existing: unique.length - inserted, tagged, errors }
}

interface CrmModalState {
  open: boolean
  step: 'confirm' | 'sending' | 'done'
  tag: string
  progress: { done: number; total: number }
  result: { total: number; inserted: number; existing: number; tagged: number; errors: string[] } | null
}

export default function PhoneValidationPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [defaultCountry, setDefaultCountry] = useState<'US' | 'GB'>('US')
  const fileRef = useRef<HTMLInputElement>(null)
  const [crm, setCrm] = useState<CrmModalState>({
    open: false, step: 'confirm', tag: '', progress: { done: 0, total: 0 }, result: null,
  })

  async function runBulk(numbers: string[], metas: RowMeta[], country?: string) {
    setLoading(true)
    setError(null)
    setRows(null)
    setSummary(null)
    setExpanded(null)
    setProgress({ done: 0, total: numbers.length })
    try {
      const collected: Row[] = []
      const sum: Summary = { total: 0, valid: 0, invalid: 0, mobile: 0, fixed_line: 0, fixed_line_or_mobile: 0, voip: 0, toll_free: 0, unknown_type: 0, empty: 0, malformed: 0, impossible: 0, enrichment_errors: 0, sms_blocked: 0, sms_lookup_errors: 0 }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in — refresh and log in again.')

      for (let i = 0; i < numbers.length; i += 500) {
        const batch = numbers.slice(i, i + 500)
        const res = await fetch('/api/phone-validation/bulk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ numbers: batch, default_country: country }),
        })
        if (!res.ok) throw new Error(await res.text())
        const json: { summary: Summary; results: ValidationResult[] } = await res.json()
        json.results.forEach((r, j) => {
          collected.push({ ...r, meta: metas[i + j] ?? EMPTY_META })
        })
        ;(Object.keys(sum) as Array<keyof Summary>).forEach((k) => { sum[k] += json.summary[k] ?? 0 })
        setProgress({ done: Math.min(i + 500, numbers.length), total: numbers.length })
      }
      setRows(collected)
      setSummary(sum)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // allow re-uploading the same file
    const text = await file.text()
    const { numbers, metas, error: parseErr } = parseCsvRows(text)
    if (parseErr || !numbers.length) {
      setError(parseErr ?? 'No phone numbers found in CSV.')
      return
    }
    await runBulk(numbers, metas, defaultCountry)
  }

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => matchesFilter(r, filter)),
    [rows, filter],
  )
  // Numbers the live Twilio check proved can't receive SMS never go to the CRM.
  const sendable = useMemo(
    () => filtered.filter((r) => r.valid && r.normalized_e164 && r.sms_deliverable !== false),
    [filtered],
  )

  function exportCsv() {
    if (!rows) return
    const header = [
      'business_name', 'website', 'input_number', 'e164', 'international_format', 'national_number',
      'country', 'country_name', 'calling_code', 'line_type', 'carrier', 'location',
      'nanpa_prefix_type', 'source', 'valid', 'possible', 'reason',
      'sms_deliverable', 'sms_check_reason', 'current_line_type', 'current_carrier',
    ]
    const esc = (c: string) => `"${c.replace(/"/g, '""')}"`
    const csvRows = [header, ...filtered.map((r) => [
      r.meta.business_name, r.meta.website, r.input_number, r.normalized_e164 ?? '',
      r.international_format ?? '', r.national_number ?? '', r.country ?? '', r.country_name ?? '',
      r.country_calling_code ?? '', r.line_type ?? '', r.carrier ?? '', r.location ?? '',
      r.nanpa_prefix_type ?? '', r.source_provider, r.valid ? 'true' : 'false',
      r.possible ? 'true' : 'false', r.reason ?? '',
      r.sms_deliverable === undefined ? '' : String(r.sms_deliverable), r.sms_check_reason ?? '',
      r.lti_type ?? '', r.lti_carrier ?? '',
    ])]
    const csv = csvRows.map((r) => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `phone-validation-${filter}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function openCrmModal() {
    const today = new Date().toISOString().slice(0, 10)
    setCrm({
      open: true,
      step: 'confirm',
      tag: `validated-${filter}-${today}`,
      progress: { done: 0, total: 0 },
      result: null,
    })
  }

  async function runSendToCrm() {
    setCrm((c) => ({ ...c, step: 'sending' }))
    const result = await sendToCrm(sendable, crm.tag, (done, total) =>
      setCrm((c) => ({ ...c, progress: { done, total } })),
    )
    setCrm((c) => ({ ...c, step: 'done', result }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Phone Validator</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            libphonenumber + self-hosted NANPA prefix database (free) + live Twilio check on US mobiles
            (~$8/1,000, cached) — catches numbers ported to landline/VoIP that block data can't see.
          </p>
        </div>
        {rows && (
          <div className="flex items-center gap-2">
            <button
              onClick={exportCsv}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-hover"
            >
              <Download size={14} />
              Export CSV
            </button>
            <button
              onClick={openCrmModal}
              disabled={sendable.length === 0}
              className="flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
            >
              <Send size={14} />
              Send {sendable.length.toLocaleString()} to CRM
            </button>
          </div>
        )}
      </div>

      {/* Upload controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          <Upload size={14} />
          Upload CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          Numbers without +country code are
          <select
            value={defaultCountry}
            onChange={(e) => setDefaultCountry(e.target.value as 'US' | 'GB')}
            disabled={loading}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-[13px] text-ink"
          >
            <option value="US">🇺🇸 USA</option>
            <option value="GB">🇬🇧 UK</option>
          </select>
        </label>
        <span className="text-[12px] text-ink-muted">
          Needs a <code className="rounded bg-surface-hover px-1">phone</code> column · business name, website, address are picked up automatically
        </span>

        {loading && (
          <span className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            Validating {progress.done.toLocaleString()}/{progress.total.toLocaleString()}…
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {rows && summary && (
        <>
          {summary.enrichment_errors > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {summary.enrichment_errors.toLocaleString()} US prefix lookups failed — the mobile/landline split for some
              numbers may be wrong (they show source "libphonenumber" in the detail view). Re-run the file to retry.
            </div>
          )}
          {summary.sms_lookup_errors > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {summary.sms_lookup_errors.toLocaleString()} live Twilio checks failed — those mobiles are kept as sendable
              but weren't verified. Re-run the file to retry (verified numbers are cached, so retries are free).
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <MetricCard label="Total" value={summary.total} />
            <MetricCard label="Valid" value={summary.valid} sub={`${Math.round(summary.valid / Math.max(1, summary.total) * 100)}%`} />
            <MetricCard label="Mobile" value={summary.mobile} />
            <MetricCard label="Landline" value={summary.fixed_line + summary.fixed_line_or_mobile} />
            <MetricCard label="VoIP" value={summary.voip} />
            <MetricCard label="Bad numbers" value={summary.malformed + summary.impossible + summary.empty} sub="malformed / impossible" />
            <MetricCard label="Can't text" value={summary.sms_blocked} sub="live Twilio check" />
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 border-b border-border">
            {(['all', 'valid', 'invalid', 'mobile', 'landline', 'voip'] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setExpanded(null) }}
                className={`px-3 py-1.5 text-[13px] font-medium capitalize transition ${
                  filter === f
                    ? 'border-b-2 border-brand text-brand'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {f}
              </button>
            ))}
            <span className="ml-auto self-center text-[12px] text-ink-muted">{filtered.length.toLocaleString()} rows · click a row for full details</span>
          </div>

          {/* Results table */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-hover">
                <tr>
                  <th className="w-6 px-2 py-2" />
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Business</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Number</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Type</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Carrier</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Location</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Status</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.slice(0, 500).map((r, i) => (
                  <>
                    <tr
                      key={i}
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      className={`cursor-pointer transition hover:bg-surface-hover/60 ${r.valid ? '' : 'bg-red-50/40'}`}
                    >
                      <td className="px-2 py-2 text-ink-muted">
                        {expanded === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-ink" title={r.meta.business_name}>
                        {r.meta.business_name || <span className="text-ink-muted">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-ink">
                        {r.international_format ?? r.input_number ?? <em className="text-ink-muted">empty</em>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <LineTypeBadge type={r.line_type} />
                        {r.sms_deliverable === false && <span className="ml-1"><NoTextBadge reason={r.sms_check_reason} /></span>}
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2 text-ink-muted" title={r.carrier ?? ''}>{r.carrier ?? '—'}</td>
                      <td className="max-w-[140px] truncate px-3 py-2 text-ink-muted" title={r.location ?? ''}>{r.location ?? '—'}</td>
                      <td className="px-3 py-2"><StatusBadge valid={r.valid} reason={r.reason} /></td>
                      <td className="px-2 py-2">
                        {r.meta.website && (
                          <a
                            href={r.meta.website}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-ink-muted hover:text-brand"
                            title={r.meta.website}
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </td>
                    </tr>
                    {expanded === i && (
                      <tr key={`${i}-detail`}>
                        <td colSpan={8} className="p-0">
                          <NumberDetail row={r} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <div className="border-t border-border px-3 py-2 text-center text-[12px] text-ink-muted">
                Showing 500 of {filtered.length.toLocaleString()} — export CSV to see all
              </div>
            )}
          </div>
        </>
      )}

      {!rows && !loading && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <Phone size={32} className="text-ink-muted/40" />
          <p className="mt-3 text-sm font-medium text-ink-muted">No data yet</p>
          <p className="mt-1 text-[12px] text-ink-muted">Upload a CSV with a "phone" column — business name, website and address columns are carried through.</p>
        </div>
      )}

      {/* Send-to-CRM modal */}
      {crm.open && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <Users size={16} />
                Send to CRM contacts
              </h3>
              <button onClick={() => setCrm((c) => ({ ...c, open: false }))} className="rounded p-1 text-ink-muted hover:bg-surface-hover">
                <X size={16} />
              </button>
            </div>

            {crm.step === 'confirm' && (
              <div className="space-y-4 p-5">
                <p className="text-sm text-ink">
                  <strong>{sendable.length.toLocaleString()}</strong> valid numbers from the current
                  {' '}<strong className="capitalize">{filter}</strong> filter will be added to CRM contacts.
                  Numbers already in the CRM are skipped but still tagged.
                </p>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    Tag (use this to pick them in Broadcasts)
                  </label>
                  <input
                    value={crm.tag}
                    onChange={(e) => setCrm((c) => ({ ...c, tag: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
                  />
                </div>
                <button
                  onClick={() => void runSendToCrm()}
                  disabled={!crm.tag.trim()}
                  className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
                >
                  Add {sendable.length.toLocaleString()} contacts
                </button>
              </div>
            )}

            {crm.step === 'sending' && (
              <div className="p-10 text-center">
                <span className="mx-auto mb-3 block h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                <p className="text-sm text-ink-muted">
                  Adding contacts… {crm.progress.done.toLocaleString()}/{crm.progress.total.toLocaleString()}
                </p>
              </div>
            )}

            {crm.step === 'done' && crm.result && (
              <div className="space-y-4 p-5 text-center">
                <CheckCircle2 size={32} className="mx-auto text-green-600" />
                <div>
                  <p className="text-[15px] font-semibold text-ink">{crm.result.inserted.toLocaleString()} contacts added</p>
                  <p className="mt-1 text-[12px] text-ink-muted">
                    {crm.result.existing > 0 && `${crm.result.existing.toLocaleString()} already existed · `}
                    {crm.result.tagged.toLocaleString()} tagged "{crm.tag}"
                    {crm.result.errors.length > 0 && ` · ${crm.result.errors.length} errors`}
                  </p>
                  {crm.result.errors.length > 0 && (
                    <details className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-left text-[11px] text-red-700">
                      <summary className="cursor-pointer">View errors</summary>
                      <ul className="mt-1 max-h-24 list-inside list-disc overflow-y-auto">
                        {crm.result.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
                <div className="flex gap-2">
                  <a
                    href="/admin/crm/contacts"
                    className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-hover"
                  >
                    View contacts
                  </a>
                  <a
                    href="/admin/crm/broadcasts"
                    className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
                  >
                    Create broadcast
                  </a>
                </div>
                <p className="text-[11px] text-ink-muted">
                  In Broadcasts, choose "By tag(s)" and enter <code className="rounded bg-surface-hover px-1">{crm.tag}</code>
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
