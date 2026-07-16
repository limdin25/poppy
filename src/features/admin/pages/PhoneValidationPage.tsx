import { useState, useRef } from 'react'
import { Phone, Upload, CheckCircle2, XCircle, Smartphone, PhoneCall, Wifi, HelpCircle, AlertTriangle, Download } from 'lucide-react'

interface ValidationResult {
  input_number: string
  normalized_e164: string | null
  country: string | null
  line_type: string | null
  active_status: string
  confidence: number
  confidence_label: string
  reason: string | null
  valid: boolean
  source_provider: string
  nanpa_prefix_type?: string
  checked_at: string
  cache_ttl: number
}

interface BulkResult {
  summary: {
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
  }
  results: ValidationResult[]
}

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
  )
}

function parseCsvNumbers(csv: string): string[] {
  const lines = csv.split('\n')
  if (lines.length < 2) return []
  const header = lines[0].split(',').map((h) => h.replace(/["﻿]/g, '').trim().toLowerCase())
  const phoneIdx = header.findIndex((h) => h === 'phone')
  if (phoneIdx === -1) return []
  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(',')
      return (cols[phoneIdx] ?? '').replace(/"/g, '').trim()
    })
    .filter(Boolean)
}

export default function PhoneValidationPage() {
  const [data, setData] = useState<BulkResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'valid' | 'invalid' | 'mobile' | 'landline'>('all')
  const fileRef = useRef<HTMLInputElement>(null)

  async function runBulk(numbers: string[], country?: string) {
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const chunks: ValidationResult[] = []
      const summary = { total: 0, valid: 0, invalid: 0, mobile: 0, fixed_line: 0, fixed_line_or_mobile: 0, voip: 0, toll_free: 0, unknown_type: 0, empty: 0, malformed: 0, impossible: 0 }

      // Process in batches of 500
      for (let i = 0; i < numbers.length; i += 500) {
        const batch = numbers.slice(i, i + 500)
        const res = await fetch('/api/phone-validation/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ numbers: batch, default_country: country }),
        })
        if (!res.ok) throw new Error(await res.text())
        const json: BulkResult = await res.json()
        chunks.push(...json.results)
        Object.keys(summary).forEach((k) => {
          (summary as Record<string, number>)[k] += (json.summary as Record<string, number>)[k] ?? 0
        })
      }
      setData({ summary, results: chunks })
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function loadPlumbers() {
    try {
      const res = await fetch('/api/phone-validation/plumber-sample')
      if (!res.ok) throw new Error('Could not load plumber data')
      const numbers: string[] = await res.json()
      await runBulk(numbers, 'US')
    } catch {
      // Fallback: fetch the CSV from the known path won't work in browser — use paste flow
      setError('Plumber CSV not accessible from browser. Use Upload CSV instead.')
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const numbers = parseCsvNumbers(text)
    if (!numbers.length) {
      setError('No "phone" column found in CSV, or file is empty.')
      return
    }
    await runBulk(numbers, 'US')
  }

  function exportCsv() {
    if (!data) return
    const rows = [
      ['input_number', 'normalized_e164', 'country', 'line_type', 'nanpa_prefix_type', 'source', 'valid', 'reason', 'confidence_label'],
      ...data.results.map((r) => [
        r.input_number,
        r.normalized_e164 ?? '',
        r.country ?? '',
        r.line_type ?? '',
        r.nanpa_prefix_type ?? '',
        r.source_provider,
        r.valid ? 'true' : 'false',
        r.reason ?? '',
        r.confidence_label,
      ]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'phone-validation-results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = data?.results.filter((r) => {
    if (filter === 'valid') return r.valid
    if (filter === 'invalid') return !r.valid
    if (filter === 'mobile') return r.line_type === 'MOBILE'
    if (filter === 'landline') return r.line_type === 'FIXED_LINE' || r.line_type === 'FIXED_LINE_OR_MOBILE'
    return true
  }) ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Phone Validator</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            libphonenumber + NANPA prefix database — classifies US mobile vs landline at zero marginal cost.
          </p>
        </div>
        {data && (
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-hover"
          >
            <Download size={14} />
            Export CSV
          </button>
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

        <button
          onClick={loadPlumbers}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-hover disabled:opacity-50"
        >
          <Phone size={14} />
          Load USA Plumbers (2,200)
        </button>

        {loading && (
          <span className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            Validating…
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard label="Total" value={data.summary.total} />
            <MetricCard label="Valid" value={data.summary.valid} sub={`${Math.round(data.summary.valid / data.summary.total * 100)}%`} />
            <MetricCard label="Invalid" value={data.summary.invalid} sub={`${Math.round(data.summary.invalid / data.summary.total * 100)}%`} />
            <MetricCard label="Mobile" value={data.summary.mobile} />
            <MetricCard label="Landline" value={data.summary.fixed_line + data.summary.fixed_line_or_mobile} />
            <MetricCard label="Malformed" value={data.summary.malformed + data.summary.impossible + data.summary.empty} />
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 border-b border-border">
            {(['all', 'valid', 'invalid', 'mobile', 'landline'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-[13px] font-medium capitalize transition ${
                  filter === f
                    ? 'border-b-2 border-brand text-brand'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {f}
              </button>
            ))}
            <span className="ml-auto self-center text-[12px] text-ink-muted">{filtered.length.toLocaleString()} rows</span>
          </div>

          {/* Results table */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-hover">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Input</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">E.164</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Country</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Type</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Source</th>
                  <th className="px-3 py-2 text-left font-medium text-ink-muted">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.slice(0, 500).map((r, i) => (
                  <tr key={i} className={r.valid ? '' : 'bg-red-50/40'}>
                    <td className="px-3 py-2 font-mono text-ink">{r.input_number || <em className="text-ink-muted">empty</em>}</td>
                    <td className="px-3 py-2 font-mono text-ink-muted">{r.normalized_e164 ?? '—'}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.country ?? '—'}</td>
                    <td className="px-3 py-2"><LineTypeBadge type={r.line_type} /></td>
                    <td className="px-3 py-2">
                      {r.source_provider === 'nanpa'
                        ? <span className="text-[11px] font-medium text-indigo-600">NANPA{r.nanpa_prefix_type ? ` · ${r.nanpa_prefix_type}` : ''}</span>
                        : <span className="text-[11px] text-ink-muted">libphone</span>}
                    </td>
                    <td className="px-3 py-2"><StatusBadge valid={r.valid} reason={r.reason} /></td>
                  </tr>
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

      {!data && !loading && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <Phone size={32} className="text-ink-muted/40" />
          <p className="mt-3 text-sm font-medium text-ink-muted">No data yet</p>
          <p className="mt-1 text-[12px] text-ink-muted">Upload a CSV with a "phone" column, or load the USA Plumbers test set.</p>
        </div>
      )}
    </div>
  )
}
