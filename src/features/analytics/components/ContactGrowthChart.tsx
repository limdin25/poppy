import type { ContactGrowthDay } from '../types'

interface Props {
  data: ContactGrowthDay[]
  loading: boolean
}

export function ContactGrowthChart({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
        <div className="h-5 w-36 skeleton mb-4" />
        <div className="h-[160px] skeleton" />
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
        <p className="text-[13px] font-semibold text-ink">Contact Growth</p>
        <div className="flex h-[160px] items-center justify-center">
          <p className="text-[12px] text-ink-muted">No new contacts in this period</p>
        </div>
      </div>
    )
  }

  const chartW = 500
  const chartH = 140
  const pad = { top: 10, right: 10, bottom: 24, left: 40 }
  const w = chartW - pad.left - pad.right
  const h = chartH - pad.top - pad.bottom

  const maxCum = Math.max(...data.map(d => d.cumulative), 1)
  const minCum = Math.min(...data.map(d => d.cumulative))

  const points = data.map((d, i) => ({
    x: pad.left + (i / Math.max(data.length - 1, 1)) * w,
    y: pad.top + h - ((d.cumulative - minCum) / Math.max(maxCum - minCum, 1)) * h,
    ...d,
  }))

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ')
  const areaPath = `M${points[0].x},${pad.top + h} ${points.map(p => `L${p.x},${p.y}`).join(' ')} L${points[points.length - 1].x},${pad.top + h} Z`

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[13px] font-semibold text-ink">Contact Growth</p>
        <p className="text-[11px] text-ink-muted">
          +{data.reduce((s, d) => s + d.newContacts, 0)} new · {data[data.length - 1]?.cumulative || 0} total
        </p>
      </div>
      <svg width="100%" viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {[0, 0.5, 1].map(pct => {
          const y = pad.top + h - h * pct
          const val = Math.round(minCum + (maxCum - minCum) * pct)
          return (
            <g key={pct}>
              <line x1={pad.left} y1={y} x2={pad.left + w} y2={y} stroke="rgb(var(--border))" strokeWidth={0.5} />
              <text x={pad.left - 4} y={y + 3} fontSize={8} fill="rgb(var(--ink-subtle))" textAnchor="end">
                {val}
              </text>
            </g>
          )
        })}

        {/* Area fill */}
        <path d={areaPath} fill="rgb(var(--brand))" opacity={0.08} />

        {/* Line */}
        <polyline points={polyline} fill="none" stroke="rgb(var(--brand))" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill="rgb(var(--brand))" />
            {p.newContacts > 0 && (
              <text x={p.x} y={p.y - 8} fontSize={8} fill="rgb(var(--brand))" textAnchor="middle" fontWeight={600}>
                +{p.newContacts}
              </text>
            )}
          </g>
        ))}

        {/* Date labels */}
        {points.map((p, i) => (
          (data.length <= 14 || i % Math.ceil(data.length / 10) === 0) ? (
            <text key={i} x={p.x} y={chartH - 4} fontSize={8} fill="rgb(var(--ink-subtle))" textAnchor="middle">
              {new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </text>
          ) : null
        ))}
      </svg>
    </div>
  )
}
