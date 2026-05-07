import { Component, useState, useCallback, type ReactNode } from 'react'
import { BarChart3 } from 'lucide-react'
import { useAnalyticsApi } from './hooks/useAnalyticsApi'
import { DateRangePicker } from './components/DateRangePicker'
import { ChannelFilter } from './components/ChannelFilter'
import { MetricCards } from './components/MetricCards'
import { VolumeChart } from './components/VolumeChart'
import { ChannelBreakdown } from './components/ChannelBreakdown'
import { AiPerformanceCard } from './components/AiPerformanceCard'
import { BusiestHoursHeatmap } from './components/BusiestHoursHeatmap'
import { ContactGrowthChart } from './components/ContactGrowthChart'
import { ActivityTable } from './components/ActivityTable'
import { UnsubscribeTable } from './components/UnsubscribeTable'
import type { DateRange, SummaryData, AiPerformance, HeatmapCell, ContactGrowthDay, VolumeDay, ActivityRow, UnsubscribeRow } from './types'

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

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() {
    if (this.state.error) return <div className="p-6 text-red-600 text-[13px]">Error: {this.state.error}</div>
    return this.props.children
  }
}

function AnalyticsContent() {
  const [range, setRange] = useState<DateRange>({
    from: daysAgo(7),
    to: endOfToday(),
    preset: '7d',
  })
  const [channel, setChannel] = useState<string | null>(null)
  const [activityPage, setActivityPage] = useState(1)
  const [activitySort, setActivitySort] = useState('date')
  const [activityDir, setActivityDir] = useState<'asc' | 'desc'>('desc')
  const [activitySearch, setActivitySearch] = useState('')

  const baseParams = { from: range.from, to: range.to, channel }

  const summary = useAnalyticsApi<SummaryData | null>('summary', baseParams, null)
  const volume = useAnalyticsApi<{ days: VolumeDay[] }>('volume', baseParams, { days: [] })
  const aiPerf = useAnalyticsApi<AiPerformance | null>('ai-performance', { from: range.from, to: range.to }, null)
  const heatmap = useAnalyticsApi<{ grid: HeatmapCell[] }>('busiest-hours', { from: range.from, to: range.to }, { grid: [] })
  const contactGrowth = useAnalyticsApi<{ days: ContactGrowthDay[] }>('contact-growth', { from: range.from, to: range.to }, { days: [] })
  const activity = useAnalyticsApi<{ rows: ActivityRow[]; total: number; page: number; pageSize: number }>(
    'activity',
    { from: range.from, to: range.to, channel, page: String(activityPage), sort: activitySort, dir: activityDir, search: activitySearch },
    { rows: [], total: 0, page: 1, pageSize: 25 },
  )
  const unsubs = useAnalyticsApi<{ rows: UnsubscribeRow[]; total: number }>(
    'unsubscribes',
    { page: '1', pageSize: '25' },
    { rows: [], total: 0 },
  )

  const handleSort = useCallback((col: string, dir: 'asc' | 'desc') => {
    setActivitySort(col)
    setActivityDir(dir)
    setActivityPage(1)
  }, [])

  const handleSearch = useCallback((q: string) => {
    setActivitySearch(q)
    setActivityPage(1)
  }, [])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10">
            <BarChart3 size={18} className="text-brand" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-ink">Analytics</h1>
            <p className="text-[12px] text-ink-muted">Full overview of your business activity</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DateRangePicker value={range} onChange={r => { setRange(r); setActivityPage(1) }} />
        <ChannelFilter value={channel} onChange={c => { setChannel(c); setActivityPage(1) }} />
      </div>

      {/* Metric Cards */}
      <MetricCards data={summary.data} loading={summary.loading} />

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <VolumeChart data={volume.data.days} loading={volume.loading} />
        <ChannelBreakdown data={summary.data?.conversationsByChannel || {}} loading={summary.loading} />
      </div>

      {/* AI + Heatmap row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <AiPerformanceCard data={aiPerf.data} loading={aiPerf.loading} />
        <BusiestHoursHeatmap data={heatmap.data.grid} loading={heatmap.loading} />
      </div>

      {/* Contact Growth */}
      <ContactGrowthChart data={contactGrowth.data.days} loading={contactGrowth.loading} />

      {/* Activity Table */}
      <ActivityTable
        rows={activity.data.rows}
        total={activity.data.total}
        page={activityPage}
        pageSize={25}
        loading={activity.loading}
        onPageChange={setActivityPage}
        onSearch={handleSearch}
        onSort={handleSort}
        sortCol={activitySort}
        sortDir={activityDir}
      />

      {/* Unsubscribe History */}
      <UnsubscribeTable
        rows={unsubs.data.rows}
        total={unsubs.data.total}
        loading={unsubs.loading}
      />
    </div>
  )
}

export default function AnalyticsPage() {
  return (
    <ErrorBoundary>
      <AnalyticsContent />
    </ErrorBoundary>
  )
}
