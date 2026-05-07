import type { VolumeDay } from '../types'

interface Props {
  data: VolumeDay[]
  loading: boolean
}

export function VolumeChart({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
        <div className="h-5 w-32 skeleton mb-4" />
        <div className="h-[200px] skeleton" />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
        <p className="text-[13px] font-semibold text-ink">Daily Volume</p>
        <div className="flex h-[200px] items-center justify-center">
          <p className="text-[12px] text-ink-muted">No data for this period</p>
        </div>
      </div>
    )
  }

  const maxVal = Math.max(...data.map(d => d.messagesIn + d.messagesOut + d.calls), 1)
  const chartH = 180
  const barW = Math.max(8, Math.min(40, (600 / data.length) - 4))

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
      <p className="mb-3 text-[13px] font-semibold text-ink">Daily Volume</p>
      <div className="overflow-x-auto scrollbar-thin">
        <svg
          width={Math.max(data.length * (barW + 4) + 40, 300)}
          height={chartH + 40}
          className="w-full"
          viewBox={`0 0 ${Math.max(data.length * (barW + 4) + 40, 300)} ${chartH + 40}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => (
            <g key={pct}>
              <line
                x1={30} y1={chartH - chartH * pct}
                x2={data.length * (barW + 4) + 30} y2={chartH - chartH * pct}
                stroke="rgb(var(--border))" strokeWidth={0.5}
              />
              <text x={0} y={chartH - chartH * pct + 4} fontSize={9} fill="rgb(var(--ink-subtle))">
                {Math.round(maxVal * pct)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const x = 35 + i * (barW + 4)
            const msgH = ((d.messagesIn + d.messagesOut) / maxVal) * chartH
            const callH = (d.calls / maxVal) * chartH

            return (
              <g key={d.date}>
                <title>{`${d.date}: ${d.messagesIn} in, ${d.messagesOut} out, ${d.calls} calls`}</title>
                {/* Messages bar */}
                <rect
                  x={x} y={chartH - msgH - callH}
                  width={barW} height={msgH}
                  rx={3}
                  fill="rgb(var(--brand))"
                  opacity={0.8}
                />
                {/* Calls bar (stacked on top) */}
                {d.calls > 0 && (
                  <rect
                    x={x} y={chartH - callH}
                    width={barW} height={callH}
                    rx={3}
                    fill="rgb(22 163 74)"
                    opacity={0.7}
                  />
                )}
                {/* Date label */}
                {(data.length <= 14 || i % Math.ceil(data.length / 14) === 0) && (
                  <text
                    x={x + barW / 2} y={chartH + 14}
                    fontSize={8} fill="rgb(var(--ink-subtle))"
                    textAnchor="middle"
                  >
                    {new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <div className="mt-2 flex items-center gap-4 text-[10px] text-ink-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand/80" /> Messages
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-success/70" /> Calls
        </span>
      </div>
    </div>
  )
}
