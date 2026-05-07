import { useState } from 'react'
import { BarChart3, Building2 } from 'lucide-react'
import { useAdminApi } from '../hooks/useAdminApi'
import { AdminError } from '../components/AdminError'
import { cn } from '@/core/lib/cn'

interface AdminSummary {
  businesses: { total: number; list: Array<{ id: string; name: string }> }
  calls: { total: number; answered: number; missed: number; totalDuration: number }
  conversations: { total: number; byChannel: Record<string, number> }
  messages: { total: number; inbound: number; outbound: number; bySender: Record<string, number> }
  contacts: { newContacts: number }
}

interface ActivityRow {
  id: string
  date: string
  businessName: string
  contactName: string
  channel: string
  direction: string
  sender: string
  body: string | null
}

interface DateRange {
  from: string
  to: string
  preset: string
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function endOfToday(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

const presets = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
]

function fmt(n: number | null | undefined): string {
  if (n == null) return '-'
  return n.toLocaleString()
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

export default function AdminAnalyticsPage() {
  const [range, setRange] = useState<DateRange>({
    from: daysAgo(30),
    to: endOfToday(),
    preset: '30d',
  })
  const [selectedBiz, setSelectedBiz] = useState<string | null>(null)
  const [activityPage, setActivityPage] = useState(1)

  const summaryParams = new URLSearchParams({
    from: range.from,
    to: range.to,
    ...(selectedBiz ? { business_id: selectedBiz } : {}),
  })

  const activityParams = new URLSearchParams({
    from: range.from,
    to: range.to,
    page: String(activityPage),
    pageSize: '25',
    ...(selectedBiz ? { business_id: selectedBiz } : {}),
  })

  const { data: summary, loading: summaryLoading, error: summaryError } = useAdminApi<AdminSummary>(
    `analytics/summary?${summaryParams}`,
    null as unknown as AdminSummary,
    [summaryParams.toString()],
  )

  const { data: activity, loading: activityLoading } = useAdminApi<{
    rows: ActivityRow[]
    total: number
  }>(
    `analytics/activity?${activityParams}`,
    { rows: [], total: 0 },
    [activityParams.toString()],
  )

  const businesses = summary?.businesses?.list || []
  const totalPages = Math.max(1, Math.ceil((activity?.total || 0) / 25))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10">
          <BarChart3 size={18} className="text-brand" />
        </div>
        <div>
          <h1 className="text-[17px] font-bold text-ink">Platform Analytics</h1>
          {summaryError && <AdminError error={summaryError} />}
          <p className="text-[12px] text-ink-muted">Overview across all businesses</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          {presets.map(p => (
            <button
              key={p.key}
              onClick={() => {
                setRange({
                  from: p.key === 'today' ? new Date().toISOString().slice(0, 10) : daysAgo(p.days),
                  to: endOfToday(),
                  preset: p.key,
                })
                setActivityPage(1)
              }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[12px] font-medium transition',
                range.preset === p.key
                  ? 'bg-brand text-white'
                  : 'bg-elevated text-ink-muted hover:bg-brand/10'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Building2 size={14} className="text-ink-muted" />
          <select
            value={selectedBiz || ''}
            onChange={e => { setSelectedBiz(e.target.value || null); setActivityPage(1) }}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink"
          >
            <option value="">All Businesses</option>
            {businesses.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[80px] rounded-xl skeleton" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: 'Businesses', value: fmt(summary.businesses.total) },
            { label: 'Conversations', value: fmt(summary.conversations.total) },
            { label: 'Messages', value: fmt(summary.messages.total), sub: `${fmt(summary.messages.inbound)} in · ${fmt(summary.messages.outbound)} out` },
            { label: 'Calls', value: fmt(summary.calls.total), sub: `${fmt(summary.calls.answered)} answered · ${fmt(summary.calls.missed)} missed` },
            { label: 'New Contacts', value: fmt(summary.contacts.newContacts) },
            { label: 'Call Time', value: fmtDuration(summary.calls.totalDuration) },
            ...(summary.messages.bySender ? [
              { label: 'AI Replies', value: fmt(summary.messages.bySender.ai || 0) },
              { label: 'Human Replies', value: fmt(summary.messages.bySender.human || 0) },
            ] : []),
            ...Object.entries(summary.conversations.byChannel || {}).map(([ch, count]) => ({
              label: ch.charAt(0).toUpperCase() + ch.slice(1),
              value: fmt(count),
              sub: 'conversations',
            })),
          ].map((card, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-3.5 shadow-soft">
              <p className="text-[11px] font-medium text-ink-muted">{card.label}</p>
              <p className="text-[18px] font-bold text-ink">{card.value}</p>
              {'sub' in card && card.sub && <p className="text-[10px] text-ink-subtle">{card.sub}</p>}
            </div>
          ))}
        </div>
      ) : null}

      {/* Activity Table */}
      <div className="rounded-xl border border-border bg-surface shadow-soft overflow-hidden">
        <div className="border-b border-border p-3">
          <p className="text-[13px] font-semibold text-ink">Activity Log</p>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-border bg-elevated/50">
                {['Date', 'Business', 'Contact', 'Channel', 'Direction', 'Sender', 'Preview'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activityLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-3 py-2.5"><div className="h-3 w-16 skeleton" /></td>
                    ))}
                  </tr>
                ))
              ) : !activity?.rows?.length ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-[12px] text-ink-muted">No activity</td>
                </tr>
              ) : (
                activity.rows.map(row => (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-elevated/30 transition">
                    <td className="px-3 py-2 text-[11px] text-ink-muted whitespace-nowrap">
                      {new Date(row.date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 text-[12px] font-medium text-ink max-w-[120px] truncate">{row.businessName}</td>
                    <td className="px-3 py-2 text-[12px] text-ink max-w-[120px] truncate">{row.contactName}</td>
                    <td className="px-3 py-2">
                      <span className="inline-block rounded-md bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">{row.channel}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium',
                        row.direction === 'inbound' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                      )}>
                        {row.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-ink-muted capitalize">{row.sender}</td>
                    <td className="px-3 py-2 text-[11px] text-ink-muted max-w-[180px] truncate">{row.body || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <p className="text-[11px] text-ink-muted">{activity?.total || 0} total</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActivityPage(p => Math.max(1, p - 1))}
              disabled={activityPage <= 1}
              className="rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-elevated disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-[11px] text-ink-muted">{activityPage} / {totalPages}</span>
            <button
              onClick={() => setActivityPage(p => Math.min(totalPages, p + 1))}
              disabled={activityPage >= totalPages}
              className="rounded-md px-2 py-1 text-[11px] text-ink-muted hover:bg-elevated disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
