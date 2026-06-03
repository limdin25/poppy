import { useMemo, useState } from 'react'
import {
  UserPlus,
  MessagesSquare,
  Sparkles,
  Bot,
  CalendarCheck,
  Timer,
  Filter,
  Download,
  BarChart3,
} from 'lucide-react'
import { PageHeader } from '@/core/ui/PageHeader'
import { StatCard } from '@/core/ui/StatCard'
import { SectionCard } from '@/core/ui/SectionCard'
import { FilterChips } from '@/core/ui/FilterChips'
import { DataTable, type Column } from '@/core/ui/DataTable'
import { cn } from '@/core/lib/cn'
import { toCsv, downloadFile } from '@/core/lib/csv'
import { useAnalyticsApi } from '@/core/hooks/useAnalyticsApi'
import type { SummaryData, AiPerformance } from './types'

interface VolumeResp { days: { date: string; messagesIn: number; messagesOut: number; calls: number }[] }
interface HeatResp { grid: { dayOfWeek: number; hour: number; count: number }[] }
interface LatencyResp { count: number; p50: number | null; p95: number | null; p99: number | null; histogram: { label: string; count: number }[] }

/**
 * Analytics — waslo layout, wired to the real analytics API.
 *   stat cards + funnel + by-channel → /api/analytics/summary
 *   AI replies / AI-handled rate     → /api/analytics/ai-performance
 * The 7/30/90-day + All-time chips and channel filter become from/to/channel
 * query params, so changing them re-queries the backend.
 *
 * Cards/columns are only shown when the endpoints return a real field for them.
 * (No "qualified rate" or per-channel AI/booking splits exist in the API, so
 * those fabricated metrics were dropped/relabelled rather than faked.)
 */

type RangeKey = '7d' | '30d' | '90d' | 'all'
type ChannelKey = 'all' | 'whatsapp'

interface FunnelStage {
  label: string
  count: number
}

interface ChannelRow {
  channel: string
  conversations: number
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
}

const ALL_TIME_FROM = '2020-01-01T00:00:00.000Z'

/** Convert a range chip to an ISO from/to window. */
function rangeToWindow(range: RangeKey): { from: string; to: string } {
  const to = new Date().toISOString()
  if (range === 'all') return { from: ALL_TIME_FROM, to }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  return { from, to }
}

/** Pick a bar fill colour from the % of leads at this stage (waslo colour ramp). */
function barColor(pct: number, isFirst: boolean): string {
  if (isFirst) return 'bg-accent' // top of funnel = near-black
  if (pct >= 80) return 'bg-lime-400'
  if (pct >= 45) return 'bg-green-500'
  if (pct > 0) return 'bg-ink-subtle/60'
  return 'bg-transparent'
}

/** Median seconds → compact "1.8s" / "2m" label. */
function fmtSeconds(s: number | null | undefined): string {
  if (s == null) return '—'
  if (s < 60) return `${s % 1 === 0 ? s : s.toFixed(1)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${(s / 3600).toFixed(1)}h`
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>('30d')
  const [channel, setChannel] = useState<ChannelKey>('all')

  const { from, to } = useMemo(() => rangeToWindow(range), [range])
  const channelParam = channel === 'all' ? null : channel

  const summaryQ = useAnalyticsApi<SummaryData | null>(
    'summary',
    { from, to, channel: channelParam },
    null,
  )
  // ai-performance has no channel param — it's business-wide for the window.
  const aiQ = useAnalyticsApi<AiPerformance | null>(
    'ai-performance',
    { from, to },
    null,
  )
  const volumeQ = useAnalyticsApi<VolumeResp>('volume', { from, to, channel: channelParam }, { days: [] })
  const heatQ = useAnalyticsApi<HeatResp>('busiest-hours', { from, to }, { grid: [] })
  const latencyQ = useAnalyticsApi<LatencyResp>('latency', { from, to }, { count: 0, p50: null, p95: null, p99: null, histogram: [] })

  const summary = summaryQ.data
  const ai = aiQ.data
  const loading = summaryQ.loading || aiQ.loading

  // Real metric values from the API.
  const newLeads = summary?.newContacts ?? 0
  const messages = (summary?.messagesSent ?? 0) + (summary?.messagesReceived ?? 0)
  const aiReplies = ai?.autoSent ?? 0
  const aiHandledRate =
    ai && ai.total > 0 ? Math.round((ai.autoSent / ai.total) * 100) : null
  const medianReply = summary?.medianResponseSeconds ?? null
  const bookings = summary?.appointments?.total ?? 0

  const hasAnyData =
    !!summary &&
    (summary.totalConversations > 0 ||
      messages > 0 ||
      newLeads > 0 ||
      bookings > 0)

  // Funnel from real fields only. Stages without a backing field are omitted.
  const funnel = useMemo<FunnelStage[]>(() => {
    if (!summary) return []
    return [
      { label: 'New leads', count: summary.newContacts },
      { label: 'Inbound messages', count: summary.messagesReceived },
      { label: 'AI replies sent', count: ai?.autoSent ?? 0 },
      { label: 'Booked appointment', count: summary.appointments?.total ?? 0 },
      { label: 'Completed', count: summary.appointments?.completed ?? 0 },
    ]
  }, [summary, ai])

  const channelRows = useMemo<ChannelRow[]>(() => {
    if (!summary) return []
    const byChannel = summary.conversationsByChannel || {}
    const rows = Object.entries(byChannel).map(([key, count]) => ({
      channel: CHANNEL_LABEL[key] || key,
      conversations: count,
    }))
    if (channel === 'all') return rows
    const label = CHANNEL_LABEL[channel]
    return rows.filter((r) => r.channel === label)
  }, [summary, channel])

  const topCount = funnel[0]?.count || 1
  const lastCount = funnel[funnel.length - 1]?.count ?? 0
  const endToEndDropoff = topCount ? Math.round(((topCount - lastCount) / topCount) * 100) : 0

  const volumeChart = useMemo(() => {
    return (volumeQ.data.days || []).map((d) => ({
      label: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: range === '7d' ? undefined : 'short' }),
      value: (d.messagesIn || 0) + (d.messagesOut || 0),
    }))
  }, [volumeQ.data, range])
  const volumeMax = Math.max(1, ...volumeChart.map((d) => d.value))

  // Heatmap grid: 7 rows (Sun..Sat) × 24 cols. busiest-hours uses Postgres DOW (0=Sun).
  const heatMap = useMemo(() => {
    const m = new Map<string, number>()
    let max = 0
    for (const c of heatQ.data.grid || []) {
      m.set(`${c.dayOfWeek}-${c.hour}`, c.count)
      if (c.count > max) max = c.count
    }
    return { get: (d: number, h: number) => m.get(`${d}-${h}`) || 0, max: Math.max(1, max) }
  }, [heatQ.data])
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const latency = latencyQ.data

  function exportCsv() {
    const rows: (string | number)[][] = [
      ['Metric', 'Value'],
      ['New leads', newLeads],
      ['Messages', messages],
      ['Messages in', summary?.messagesReceived ?? 0],
      ['Messages out', summary?.messagesSent ?? 0],
      ['AI replies', aiReplies],
      ['AI handled %', aiHandledRate ?? ''],
      ['Median reply (s)', medianReply ?? ''],
      ['P50 latency (s)', latency.p50 ?? ''],
      ['P95 latency (s)', latency.p95 ?? ''],
      ['P99 latency (s)', latency.p99 ?? ''],
      ['Bookings', bookings],
      [],
      ['Funnel stage', 'Count'],
      ...funnel.map((f) => [f.label, f.count] as (string | number)[]),
    ]
    downloadFile(`analytics-${range}.csv`, toCsv(['Metric', 'Value'], rows.slice(1)))
  }

  const columns: Column<ChannelRow>[] = [
    {
      key: 'channel',
      header: 'Channel',
      render: (r) => (
        <span className="inline-flex items-center gap-2 font-medium text-ink">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              r.channel === 'WhatsApp' ? 'bg-whatsapp' : 'bg-indigo-400',
            )}
          />
          {r.channel}
        </span>
      ),
    },
    {
      key: 'conversations',
      header: 'Conversations',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums text-ink">{r.conversations.toLocaleString()}</span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Performance & insights"
        description="How Elsie is performing — channels, funnel, latency, AI handling."
        actions={
          <>
            <FilterChips
              options={[
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
                { value: '90d', label: '90 days' },
                { value: 'all', label: 'All time' },
              ]}
              value={range}
              onChange={(v) => setRange(v as RangeKey)}
            />
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as ChannelKey)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated focus:border-ink-subtle focus:outline-none"
            >
              <option value="all">All channels</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated"
            >
              <Download size={15} /> Download CSV
            </button>
          </>
        }
      />

      {summaryQ.error && (
        <SectionCard>
          <p className="text-[13px] text-red-500">
            Couldn’t load analytics ({summaryQ.error}).
          </p>
        </SectionCard>
      )}

      {/* Stat cards — every value below maps to a real API field. */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[104px] rounded-2xl border border-border bg-surface skeleton" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            icon={<UserPlus />}
            label="New leads"
            value={newLeads.toLocaleString()}
            sub="New contacts"
          />
          <StatCard
            icon={<MessagesSquare />}
            label="Messages"
            value={messages.toLocaleString()}
            sub={`${(summary?.messagesReceived ?? 0).toLocaleString()} in · ${(summary?.messagesSent ?? 0).toLocaleString()} out`}
          />
          <StatCard
            icon={<Sparkles />}
            label="AI replies"
            value={aiReplies.toLocaleString()}
            sub="Auto-sent by Elsie"
          />
          <StatCard
            icon={<Bot />}
            label="AI handled"
            value={aiHandledRate == null ? '—' : `${aiHandledRate}%`}
            sub="Of replies, no human"
          />
          <StatCard
            icon={<Timer />}
            label="Median reply"
            value={fmtSeconds(medianReply)}
            sub="Median first response"
          />
          <StatCard
            icon={<CalendarCheck />}
            label="Bookings"
            value={bookings.toLocaleString()}
            sub="Appointments booked"
          />
        </div>
      )}

      {/* Conversion funnel — real stage counts, colour-coded bars */}
      <SectionCard
        title="Conversion funnel"
        action={
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              End-to-end dropoff
            </p>
            <p className="text-[22px] font-semibold leading-none tracking-tight text-ink">
              {loading ? '—' : `${endToEndDropoff}%`}
            </p>
          </div>
        }
      >
        <div className="-mt-2 mb-4 flex items-center gap-2 text-ink-subtle">
          <Filter className="h-3.5 w-3.5" />
          <p className="text-[13px] text-ink-muted">Where leads drop off between stages.</p>
        </div>

        {loading ? (
          <div className="space-y-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-3 w-full rounded-full skeleton" />
            ))}
          </div>
        ) : !hasAnyData ? (
          <p className="py-6 text-center text-[13px] text-ink-subtle">
            No activity in this range yet.
          </p>
        ) : (
          <div className="space-y-5">
            {funnel.map((stage, i) => {
              const sharePct = topCount ? Math.round((stage.count / topCount) * 100) : 0
              const widthPct = Math.max(stage.count > 0 ? 4 : 0, sharePct)
              const next = funnel[i + 1]
              const convertPct =
                stage.count > 0 && next ? Math.round((next.count / stage.count) * 100) : null
              const dropPct = convertPct === null ? null : 100 - convertPct
              return (
                <div key={stage.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium text-ink">
                      <span className="mr-1.5 text-ink-subtle tabular-nums">{i + 1}.</span>
                      {stage.label}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3 text-right">
                      <span className="text-[12px] tabular-nums text-ink-subtle">
                        {sharePct}% of leads
                      </span>
                      <span className="w-10 text-[14px] font-semibold tabular-nums text-ink">
                        {stage.count.toLocaleString()}
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-elevated/70">
                    <div
                      className={cn('h-full rounded-full transition-all', barColor(sharePct, i === 0))}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11.5px] tabular-nums text-ink-subtle">
                    {convertPct === null ? (
                      <span className="text-ink-subtle/80">&gt; final stage</span>
                    ) : (
                      <>
                        <span className="text-ink-subtle/80">&gt;</span> {convertPct}% convert ·{' '}
                        {dropPct}% drop
                      </>
                    )}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Volume chart — real per-day message volume */}
      <SectionCard title="Message volume" eyebrow="Per day" action={<BarChart3 size={16} className="text-ink-subtle" />}>
        {volumeChart.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-subtle">No messages in this range yet.</p>
        ) : (
          <div className="flex h-44 items-stretch gap-1">
            {volumeChart.map((d, i) => (
              <div key={`${d.label}-${i}`} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div
                  className="w-full rounded-t-md bg-accent/85 transition-all"
                  style={{ height: `${Math.max(3, (d.value / volumeMax) * 100)}%` }}
                  title={`${d.label}: ${d.value}`}
                />
                {(volumeChart.length <= 14 || i % 5 === 0) && (
                  <span className="truncate text-[10px] text-ink-subtle">{d.label}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* AI response latency — real percentiles + histogram */}
      <SectionCard title="AI response latency" eyebrow="Speed">
        <div className="mb-4 grid grid-cols-3 gap-3">
          {([['P50', latency.p50], ['P95', latency.p95], ['P99', latency.p99]] as const).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-page/60 px-4 py-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{k}</p>
              <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-ink">{fmtSeconds(v)}</p>
            </div>
          ))}
        </div>
        {latency.count === 0 ? (
          <p className="py-4 text-center text-[13px] text-ink-subtle">No measured responses in this range yet.</p>
        ) : (
          <div className="space-y-1.5">
            {latency.histogram.map((b) => {
              const max = Math.max(1, ...latency.histogram.map((x) => x.count))
              return (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-[11.5px] text-ink-subtle">{b.label}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-elevated/70">
                    <div className="h-full rounded-full bg-accent/80" style={{ width: `${(b.count / max) * 100}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[11.5px] tabular-nums text-ink-muted">{b.count}</span>
                </div>
              )
            })}
            <p className="pt-1 text-[11px] text-ink-subtle">{latency.count} responses measured.</p>
          </div>
        )}
      </SectionCard>

      {/* Activity heatmap — day × hour */}
      <SectionCard title="Activity heatmap" eyebrow="When customers reach out">
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="mb-1 flex gap-1 pl-9">
              {Array.from({ length: 24 }).map((_, h) => (
                <span key={h} className="w-[3.4%] flex-1 text-center text-[9px] text-ink-subtle">{h % 6 === 0 ? h : ''}</span>
              ))}
            </div>
            {DOW.map((day, d) => (
              <div key={day} className="mb-1 flex items-center gap-1">
                <span className="w-8 shrink-0 text-[10.5px] text-ink-subtle">{day}</span>
                <div className="flex flex-1 gap-1">
                  {Array.from({ length: 24 }).map((_, h) => {
                    const c = heatMap.get(d, h)
                    const intensity = c === 0 ? 0 : 0.18 + 0.82 * (c / heatMap.max)
                    return (
                      <div
                        key={h}
                        className={cn('h-4 flex-1 rounded-[3px]', c === 0 && 'bg-elevated/60')}
                        style={c === 0 ? undefined : { backgroundColor: `rgba(10,10,10,${intensity})` }}
                        title={`${day} ${h}:00 · ${c} message${c === 1 ? '' : 's'}`}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Lead sources + by-channel breakdown */}
      <SectionCard eyebrow="Breakdown" title="Lead sources" bodyClassName="p-0">
        <DataTable
          columns={columns}
          data={channelRows}
          keyExtractor={(r) => r.channel}
          emptyMessage={loading ? 'Loading…' : 'No conversations in this range'}
          className="rounded-none border-0 shadow-none"
        />
      </SectionCard>
    </div>
  )
}
