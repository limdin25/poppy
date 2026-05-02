import { useState } from 'react'
import { Search, PhoneIncoming, PhoneMissed, Phone, Play } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { DataTable } from '../components/DataTable'

interface AdminCall {
  id: string
  business: string
  caller: string
  phone: string
  status: 'completed' | 'missed' | 'voicemail'
  duration: string
  time: string
  date: string
  summary: string
}

const MOCK_CALLS: AdminCall[] = [
  { id: '1', business: 'Smith & Sons Plumbing', caller: 'John Peterson', phone: '07912 345678', status: 'completed', duration: '3:24', time: '09:14', date: 'Today', summary: 'Emergency plumbing callout — burst pipe' },
  { id: '2', business: 'Smith & Sons Plumbing', caller: 'Sarah Mitchell', phone: '07834 567890', status: 'completed', duration: '1:52', time: '08:42', date: 'Today', summary: 'Boiler service pricing enquiry' },
  { id: '3', business: 'Brighton Heating Co', caller: 'Tom Brown', phone: '07555 123456', status: 'completed', duration: '2:45', time: '10:30', date: 'Today', summary: 'Central heating quote request' },
  { id: '4', business: 'D&M Electrical', caller: 'Unknown', phone: '07700 900111', status: 'missed', duration: '0:12', time: '09:55', date: 'Today', summary: 'Caller hung up' },
  { id: '5', business: "Sarah's Salon", caller: 'Emma White', phone: '07111 222333', status: 'completed', duration: '1:18', time: '11:20', date: 'Today', summary: 'Haircut booking for Saturday' },
  { id: '6', business: 'Smith & Sons Plumbing', caller: 'David Chen', phone: '07456 789012', status: 'completed', duration: '4:11', time: '17:22', date: 'Yesterday', summary: 'Bathroom refit consultation' },
]

const STATUS_ICON = {
  completed: { icon: PhoneIncoming, color: 'text-success' },
  missed: { icon: PhoneMissed, color: 'text-danger' },
  voicemail: { icon: Phone, color: 'text-warning' },
}

const FILTERS = ['All', 'Completed', 'Missed', 'Voicemail'] as const

export default function CallMonitorPage() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('All')

  const filtered = MOCK_CALLS.filter((c) => {
    if (filter !== 'All' && c.status !== filter.toLowerCase()) return false
    if (search && !c.caller.toLowerCase().includes(search.toLowerCase()) && !c.business.toLowerCase().includes(search.toLowerCase())) return false
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
            placeholder="Search by caller or business..."
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
                const s = STATUS_ICON[c.status]
                const Icon = s.icon
                return <Icon size={14} className={s.color} />
              },
              className: 'w-10',
            },
            {
              key: 'caller',
              header: 'Caller',
              render: (c) => (
                <div>
                  <p className="font-medium text-ink">{c.caller}</p>
                  <p className="text-[11px] text-ink-muted">{c.phone}</p>
                </div>
              ),
            },
            {
              key: 'business',
              header: 'Business',
              render: (c) => <span className="text-ink-muted">{c.business}</span>,
            },
            {
              key: 'summary',
              header: 'Summary',
              render: (c) => <span className="truncate text-ink-muted">{c.summary}</span>,
            },
            {
              key: 'duration',
              header: 'Duration',
              render: (c) => c.duration,
              className: 'w-20',
            },
            {
              key: 'time',
              header: 'Time',
              render: (c) => (
                <span className="text-ink-muted">
                  {c.date} {c.time}
                </span>
              ),
            },
            {
              key: 'play',
              header: '',
              render: () => (
                <button className="rounded-full bg-brand/10 p-1.5 text-brand hover:bg-brand/20">
                  <Play size={10} className="ml-px" />
                </button>
              ),
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
