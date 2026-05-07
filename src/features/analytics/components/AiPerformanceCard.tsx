import { Bot, PenLine, User } from 'lucide-react'
import type { AiPerformance } from '../types'

interface Props {
  data: AiPerformance | null
  loading: boolean
}

export function AiPerformanceCard({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
        <div className="h-5 w-40 skeleton mb-4" />
        <div className="h-[120px] skeleton" />
      </div>
    )
  }

  const total = data?.total || 0
  const items = [
    {
      label: 'AI Auto-sent',
      value: data?.autoSent || 0,
      pct: total > 0 ? Math.round(((data?.autoSent || 0) / total) * 100) : 0,
      icon: Bot,
      color: 'text-emerald-600 bg-emerald-50',
      barColor: 'bg-emerald-500',
    },
    {
      label: 'AI Drafted',
      value: data?.drafted || 0,
      pct: total > 0 ? Math.round(((data?.drafted || 0) / total) * 100) : 0,
      icon: PenLine,
      color: 'text-amber-600 bg-amber-50',
      barColor: 'bg-amber-500',
    },
    {
      label: 'Human Sent',
      value: data?.humanSent || 0,
      pct: total > 0 ? Math.round(((data?.humanSent || 0) / total) * 100) : 0,
      icon: User,
      color: 'text-blue-600 bg-blue-50',
      barColor: 'bg-blue-500',
    },
  ]

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
      <p className="mb-3 text-[13px] font-semibold text-ink">AI Performance</p>
      {total === 0 ? (
        <div className="flex h-[120px] items-center justify-center">
          <p className="text-[12px] text-ink-muted">No outbound messages yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.label}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-md ${item.color}`}>
                    <item.icon size={12} />
                  </div>
                  <span className="text-[12px] font-medium text-ink">{item.label}</span>
                </div>
                <span className="text-[12px] font-semibold text-ink">
                  {item.value} <span className="text-ink-muted font-normal">({item.pct}%)</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-elevated overflow-hidden">
                <div
                  className={`h-full rounded-full ${item.barColor} transition-all duration-500`}
                  style={{ width: `${item.pct}%` }}
                />
              </div>
            </div>
          ))}
          <p className="text-[10px] text-ink-subtle text-right">{total} total outbound</p>
        </div>
      )}
    </div>
  )
}
