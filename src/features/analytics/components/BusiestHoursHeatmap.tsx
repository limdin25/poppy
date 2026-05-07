import type { HeatmapCell } from '../types'

interface Props {
  data: HeatmapCell[]
  loading: boolean
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

export function BusiestHoursHeatmap({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
        <div className="h-5 w-36 skeleton mb-4" />
        <div className="h-[200px] skeleton" />
      </div>
    )
  }

  const maxCount = Math.max(...data.map(c => c.count), 1)
  const cellMap = new Map(data.map(c => [`${c.dayOfWeek}-${c.hour}`, c.count]))

  function intensity(count: number): string {
    if (count === 0) return 'bg-elevated'
    const pct = count / maxCount
    if (pct < 0.25) return 'bg-brand/15'
    if (pct < 0.5) return 'bg-brand/30'
    if (pct < 0.75) return 'bg-brand/50'
    return 'bg-brand/80'
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
      <p className="mb-3 text-[13px] font-semibold text-ink">Busiest Hours</p>
      {data.length === 0 ? (
        <div className="flex h-[180px] items-center justify-center">
          <p className="text-[12px] text-ink-muted">No activity data yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-[500px]">
            {/* Hour labels */}
            <div className="flex items-center gap-[2px] pl-10 mb-1">
              {HOURS.map(h => (
                <div key={h} className="flex-1 text-center text-[8px] text-ink-subtle">
                  {h % 3 === 0 ? `${h}:00` : ''}
                </div>
              ))}
            </div>
            {/* Grid rows */}
            {DAYS.map((day, di) => (
              <div key={day} className="flex items-center gap-[2px] mb-[2px]">
                <span className="w-8 shrink-0 text-right text-[10px] font-medium text-ink-muted pr-2">
                  {day}
                </span>
                {HOURS.map(h => {
                  const count = cellMap.get(`${di}-${h}`) || 0
                  return (
                    <div
                      key={h}
                      className={`flex-1 aspect-square rounded-[3px] ${intensity(count)} transition-colors`}
                      title={`${day} ${h}:00 - ${count} interactions`}
                    />
                  )
                })}
              </div>
            ))}
            {/* Legend */}
            <div className="flex items-center justify-end gap-1 mt-2 text-[9px] text-ink-subtle">
              <span>Less</span>
              <span className="h-3 w-3 rounded-sm bg-elevated" />
              <span className="h-3 w-3 rounded-sm bg-brand/15" />
              <span className="h-3 w-3 rounded-sm bg-brand/30" />
              <span className="h-3 w-3 rounded-sm bg-brand/50" />
              <span className="h-3 w-3 rounded-sm bg-brand/80" />
              <span>More</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
