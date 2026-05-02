import { useState } from 'react'
import { Search, PhoneIncoming, PhoneMissed, Phone, Play } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { DataTable } from '../components/DataTable'
import { useAdminApi } from '../hooks/useAdminApi'

interface AdminCall {
  id: string
  business_id: string
  status: string | null
  direction: string | null
  duration_seconds: number | null
  ai_summary: string | null
  started_at: string | null
  created_at: string
  recording_url: string | null
  contact_id: string | null
  businesses: { name: string } | null
}

const STATUS_ICON: Record<string, { icon: typeof Phone; color: string }> = {
  completed: { icon: PhoneIncoming, color: 'text-success' },
  missed: { icon: PhoneMissed, color: 'text-danger' },
  failed: { icon: PhoneMissed, color: 'text-danger' },
  ringing: { icon: Phone, color: 'text-warning' },
  in_progress: { icon: Phone, color: 'text-brand' },
}

const FILTERS = ['All', 'Completed', 'Missed', 'Failed'] as const

function formatDuration(seconds: number | null): string {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function CallMonitorPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('All')
  const { data: calls } = useAdminApi<AdminCall[]>('calls', [])

  const filtered = calls.filter((c) => {
    if (filter !== 'All' && c.status !== filter.toLowerCase()) return false
    if (search) {
      const q = search.toLowerCase()
      if (!(c.businesses?.name || '').toLowerCase().includes(q) && !(c.ai_summary || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Call Monitor</h1>
      <p className="mt-1 text-[13px] text-ink-muted">All calls across all businesses</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by business or summary..."
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className="flex gap-1">
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

      <div className="mt-4">
        <DataTable
          columns={[
            {
              key: 'status',
              header: '',
              render: (c) => {
                const s = STATUS_ICON[c.status || 'missed'] || STATUS_ICON.missed
                const Icon = s.icon
                return <Icon size={14} className={s.color} />
              },
              className: 'w-10',
            },
            {
              key: 'business',
              header: 'Business',
              render: (c) => <span className="font-medium text-ink">{c.businesses?.name || '—'}</span>,
            },
            {
              key: 'summary',
              header: 'Summary',
              render: (c) => <span className="truncate text-ink-muted">{c.ai_summary || '—'}</span>,
            },
            {
              key: 'duration',
              header: 'Duration',
              render: (c) => formatDuration(c.duration_seconds),
              className: 'w-20',
            },
            {
              key: 'time',
              header: 'Time',
              render: (c) => <span className="text-ink-muted">{timeAgo(c.started_at || c.created_at)}</span>,
            },
            {
              key: 'play',
              header: '',
              render: (c) =>
                c.recording_url ? (
                  <button className="rounded-full bg-brand/10 p-1.5 text-brand hover:bg-brand/20">
                    <Play size={10} className="ml-px" />
                  </button>
                ) : null,
              className: 'w-10',
            },
          ]}
          data={filtered}
          keyExtractor={(c) => c.id}
          emptyMessage="No calls match your filters"
        />
      </div>
    </div>
  )
}
