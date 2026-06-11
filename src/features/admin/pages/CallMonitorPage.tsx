import { useEffect, useRef, useState } from 'react'
import { Search, PhoneIncoming, PhoneMissed, Phone, PhoneOutgoing, Play, Clock, ExternalLink, X } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { AdminError } from '../components/AdminError'
import { useAdminApi } from '../hooks/useAdminApi'

interface TranscriptTurn {
  speaker: string
  text: string
}

interface AdminCall {
  id: string
  source: 'business' | 'brrr_property'
  status: string | null
  duration_seconds?: number | null
  ai_summary: string | null
  started_at?: string | null
  created_at: string
  updated_at?: string | null
  recording_url: string | null
  transcript?: TranscriptTurn[] | null
  businesses?: { name: string } | null
  contacts?: { phone: string | null } | null
  extracted_info?: Record<string, unknown> | null
  // BRRR property-call fields
  property_address?: string | null
  listing_url?: string | null
  agent_name?: string | null
  agent_phone?: string | null
  qualification?: Record<string, unknown> | null
  attempts?: number | null
  next_attempt_at?: string | null
  retell_call_id?: string | null
  cost_usd?: number | null
}

const STATUS_ICON: Record<string, { icon: typeof Phone; color: string }> = {
  completed: { icon: PhoneIncoming, color: 'text-success' },
  missed: { icon: PhoneMissed, color: 'text-danger' },
  no_answer: { icon: PhoneMissed, color: 'text-danger' },
  failed: { icon: PhoneMissed, color: 'text-danger' },
  ringing: { icon: Phone, color: 'text-warning' },
  in_progress: { icon: Phone, color: 'text-brand' },
  dialing: { icon: PhoneOutgoing, color: 'text-brand' },
  pending: { icon: Clock, color: 'text-warning' },
}

const FILTERS = ['All', 'Live', 'Qualified', 'Completed', 'Missed', 'Failed'] as const

const LIVE_STATUSES = ['dialing', 'in_progress', 'ringing']

// One label per call telling Hugo what happened and what it means for the
// pipeline — mirrors the stages deals land in (Viewing / Qualified / Monitoring).
function outcomeChip(c: AdminCall): { label: string; cls: string } | null {
  const s = c.status || ''
  if (LIVE_STATUSES.includes(s)) {
    return { label: 'LIVE', cls: 'bg-danger/10 text-danger' }
  }
  if (s === 'pending') {
    return (c.attempts || 0) > 0
      ? { label: 'Retrying', cls: 'bg-amber-100 text-amber-700' }
      : { label: 'Queued', cls: 'bg-elevated text-ink-muted' }
  }
  if (s === 'no_answer') return { label: 'No answer', cls: 'bg-danger/10 text-danger' }
  if (s === 'failed') return { label: 'Failed', cls: 'bg-danger/10 text-danger' }
  if (s === 'missed') return { label: 'Missed', cls: 'bg-danger/10 text-danger' }

  if (c.source === 'brrr_property') {
    const q = (c.qualification || {}) as Record<string, unknown>
    const outcome = q.outcome as string | undefined
    const next = q.next_step as string | undefined
    if (outcome === 'qualified') {
      if (next === 'book_viewing') return { label: 'Qualified · viewing', cls: 'bg-success/10 text-success' }
      if (next === 'make_offer') return { label: 'Qualified · offer', cls: 'bg-success/10 text-success' }
      return { label: 'Qualified', cls: 'bg-success/10 text-success' }
    }
    if (outcome === 'not_qualified') {
      if (next === 'monitor_backup') return { label: 'Backup · monitoring', cls: 'bg-violet-100 text-violet-700' }
      return { label: 'Not suitable', cls: 'bg-elevated text-ink-muted' }
    }
    if (outcome === 'callback') return { label: 'Call back', cls: 'bg-amber-100 text-amber-700' }
  }
  if (s === 'completed') return { label: 'Completed', cls: 'bg-success/10 text-success' }
  return null
}

function matchesFilter(c: AdminCall, filter: string): boolean {
  const s = c.status || ''
  const outcome = ((c.qualification || {}) as Record<string, unknown>).outcome
  switch (filter) {
    case 'Live': return LIVE_STATUSES.includes(s)
    case 'Qualified': return outcome === 'qualified'
    case 'Completed': return s === 'completed'
    case 'Missed': return s === 'missed' || s === 'no_answer'
    case 'Failed': return s === 'failed'
    default: return true
  }
}

function callPhone(c: AdminCall): string | null {
  if (c.source === 'brrr_property') return c.agent_phone || null
  const info = (c.extracted_info || {}) as Record<string, unknown>
  return c.contacts?.phone || (info.caller_phone as string) || null
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function liveSummary(c: AdminCall): string {
  const last = c.transcript?.[c.transcript.length - 1]
  if (!last) return 'Call in progress…'
  return `${last.speaker === 'agent' ? 'Elsie' : 'Agent'}: ${last.text}`
}

function rowSummary(c: AdminCall): string {
  if (LIVE_STATUSES.includes(c.status || '')) return liveSummary(c)
  if (c.status === 'pending') return c.ai_summary || 'Queued — dials at the next slot'
  return c.ai_summary || '—'
}

// BRRR rows are reused across retries — created_at goes stale, updated_at is
// when the latest attempt actually happened.
function rowTime(c: AdminCall): string | null | undefined {
  if (c.source === 'brrr_property') return c.updated_at || c.created_at
  return c.started_at || c.created_at
}

function statusLabel(c: AdminCall): string {
  if (c.status === 'dialing') return 'Live now'
  if (c.status === 'pending') return 'Queued'
  if (c.status === 'no_answer') return 'No answer'
  return (c.status || '—').replace('_', ' ')
}

const QUAL_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'outcome', label: 'Outcome' },
  { key: 'next_step', label: 'Next step' },
  { key: 'still_available', label: 'Still available' },
  { key: 'occupancy', label: 'Occupancy' },
  { key: 'tenure', label: 'Tenure' },
  { key: 'chain', label: 'Chain' },
  { key: 'condition_notes', label: 'Condition' },
  { key: 'interest_level', label: 'Interest level' },
  { key: 'offer_reaction', label: 'Offer reaction' },
  { key: 'best_price_indicated', label: 'Agent hinted' },
  { key: 'viewing_availability', label: 'Viewings' },
  { key: 'action_required', label: 'Action required' },
]

export default function CallMonitorPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: calls, error, refetch } = useAdminApi<AdminCall[]>('calls', [])

  const hasLive = calls.some((c) => LIVE_STATUSES.includes(c.status || ''))

  // Live monitor: tight poll while a call is in progress, relaxed otherwise.
  useEffect(() => {
    const interval = setInterval(refetch, hasLive ? 4000 : 15000)
    return () => clearInterval(interval)
  }, [refetch, hasLive])

  const filtered = calls.filter((c) => {
    if (!matchesFilter(c, filter)) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = [
        c.businesses?.name, c.ai_summary, c.property_address, c.agent_name,
        callPhone(c), outcomeChip(c)?.label,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  // Derived from the freshest fetch so an open modal streams live updates.
  const selected = selectedId ? calls.find((c) => c.id === selectedId) || null : null

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-ink">Call Monitor</h1>
        {hasLive && (
          <span className="flex items-center gap-1.5 rounded-full bg-danger/10 px-2.5 py-1 text-[11px] font-semibold text-danger">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
            LIVE
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] text-ink-muted">All calls — businesses and property qualifier</p>
      {error && <AdminError error={error} />}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search property, business, number, outcome..."
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] font-medium transition',
                filter === f ? 'bg-brand/10 text-brand' : 'text-ink-muted hover:bg-elevated'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {filtered.length === 0 && (
          <p className="p-6 text-center text-[13px] text-ink-muted">No calls match your filters</p>
        )}
        {filtered.map((c) => {
          const s = STATUS_ICON[c.status || 'missed'] || STATUS_ICON.missed
          const Icon = s.icon
          const chip = outcomeChip(c)
          const phone = callPhone(c)
          const duration = formatDuration(c.duration_seconds)
          return (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="block w-full px-3 py-2 text-left transition hover:bg-elevated/60"
            >
              <div className="flex items-center gap-2">
                <Icon size={13} className={cn('shrink-0', s.color, LIVE_STATUSES.includes(c.status || '') && 'animate-pulse')} />
                {c.source === 'brrr_property' && (
                  <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold uppercase leading-none text-violet-700">BRRR</span>
                )}
                <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">
                  {c.source === 'brrr_property' ? c.property_address || 'Property call' : c.businesses?.name || '—'}
                </span>
                {chip && (
                  <span className={cn('ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none', chip.cls)}>
                    {chip.label}
                  </span>
                )}
                <span className={cn('shrink-0 text-right text-[11px] tabular-nums text-ink-subtle', !chip && 'ml-auto')}>
                  {timeAgo(rowTime(c))}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 pl-[21px]">
                {phone && <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">{phone}</span>}
                {duration && <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">· {duration}</span>}
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-muted">{rowSummary(c)}</span>
                {c.recording_url && <Play size={11} className="shrink-0 text-brand" />}
              </div>
            </button>
          )
        })}
      </div>

      {selected && <CallDetailModal call={selected} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function CallDetailModal({ call, onClose }: { call: AdminCall; onClose: () => void }) {
  const isLive = LIVE_STATUSES.includes(call.status || '')
  const transcript = call.transcript || []
  const transcriptBox = useRef<HTMLDivElement>(null)

  // Keep the newest turn in view while the live transcript streams in.
  useEffect(() => {
    const el = transcriptBox.current
    if (el && isLive) el.scrollTop = el.scrollHeight
  }, [transcript.length, isLive])

  const qual = (call.qualification || {}) as Record<string, unknown>
  const qualRows = QUAL_FIELDS
    .map(({ key, label }) => ({ label, value: qual[key] }))
    .filter((r) => r.value !== null && r.value !== undefined && r.value !== '')
  const chip = outcomeChip(call)
  const phone = callPhone(call)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {call.source === 'brrr_property' && (
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700">BRRR</span>
              )}
              {isLive && (
                <span className="flex items-center gap-1.5 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                  LIVE
                </span>
              )}
              {chip && !isLive && (
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', chip.cls)}>{chip.label}</span>
              )}
              <span className="text-[12px] capitalize text-ink-muted">{statusLabel(call)}</span>
            </div>
            <h2 className="mt-1 truncate text-base font-semibold text-ink">
              {call.source === 'brrr_property'
                ? call.property_address || 'Property call'
                : call.businesses?.name || 'Call'}
            </h2>
            {(() => {
              const subtitle = [
                call.source === 'brrr_property' ? call.agent_name : null,
                phone,
                typeof call.attempts === 'number' && call.attempts > 0 ? `attempt ${call.attempts}` : null,
                typeof call.cost_usd === 'number' ? `$${call.cost_usd.toFixed(2)}` : null,
              ].filter(Boolean).join(' · ')
              return subtitle ? <p className="mt-0.5 text-[12px] text-ink-muted">{subtitle}</p> : null
            })()}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-subtle hover:bg-elevated hover:text-ink">
            <X size={16} />
          </button>
        </div>

        {isLive && (
          <a
            href="https://dashboard.retellai.com"
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-[12px] text-ink-muted hover:text-ink"
          >
            <ExternalLink size={13} />
            Listen to live audio in the Retell dashboard (Call History → newest call)
          </a>
        )}

        {call.listing_url && (
          <a href={call.listing_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-brand hover:underline">
            <ExternalLink size={12} /> View listing on Rightmove
          </a>
        )}

        {call.ai_summary && !isLive && (
          <div className="mt-4 rounded-xl bg-elevated p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Summary</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink">{call.ai_summary}</p>
          </div>
        )}

        {call.recording_url && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Recording</p>
            <audio controls src={call.recording_url} className="mt-2 w-full" />
          </div>
        )}

        {qualRows.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Qualification</p>
            <div className="mt-2 space-y-1.5">
              {qualRows.map((r) => (
                <div key={r.label} className="flex gap-2 text-[13px]">
                  <span className="w-32 shrink-0 text-ink-subtle">{r.label}</span>
                  <span className="min-w-0 break-words text-ink">{String(r.value).replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(transcript.length > 0 || isLive) && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {isLive ? 'Live transcript' : 'Transcript'}
            </p>
            <div ref={transcriptBox} className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-xl bg-elevated p-3">
              {transcript.length === 0 && (
                <p className="text-[13px] text-ink-muted">Waiting for the first words…</p>
              )}
              {transcript.map((t, i) => (
                <p key={i} className="text-[13px] leading-relaxed">
                  <span className={cn('font-semibold', t.speaker === 'agent' ? 'text-brand' : 'text-ink')}>
                    {t.speaker === 'agent' ? 'Elsie' : 'Agent'}:
                  </span>{' '}
                  <span className="text-ink-muted">{t.text}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
