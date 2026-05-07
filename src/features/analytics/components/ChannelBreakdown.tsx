interface Props {
  data: Record<string, number>
  loading: boolean
}

const COLORS: Record<string, string> = {
  whatsapp: '#25D366',
  email: '#4f46e5',
  voice: '#16a34a',
  sms: '#f59e0b',
  unknown: '#9ca3af',
}

const LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  voice: 'Voice',
  sms: 'SMS',
}

export function ChannelBreakdown({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
        <div className="h-5 w-32 skeleton mb-4" />
        <div className="h-[200px] skeleton" />
      </div>
    )
  }

  const entries = Object.entries(data).filter(([, v]) => v > 0)
  const total = entries.reduce((s, [, v]) => s + v, 0)

  if (total === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
        <p className="text-[13px] font-semibold text-ink">Channel Breakdown</p>
        <div className="flex h-[200px] items-center justify-center">
          <p className="text-[12px] text-ink-muted">No data for this period</p>
        </div>
      </div>
    )
  }

  const r = 70
  const cx = 90
  const cy = 90
  const circumference = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
      <p className="mb-3 text-[13px] font-semibold text-ink">Channel Breakdown</p>
      <div className="flex items-center gap-6">
        <svg width={180} height={180} viewBox="0 0 180 180" className="shrink-0">
          {entries.map(([channel, count]) => {
            const pct = count / total
            const dash = pct * circumference
            const gap = circumference - dash
            const currentOffset = offset
            offset += dash

            return (
              <circle
                key={channel}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={COLORS[channel] || COLORS.unknown}
                strokeWidth={24}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-currentOffset}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            )
          })}
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize={22} fontWeight={700} fill="rgb(var(--ink))">
            {total}
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize={10} fill="rgb(var(--ink-muted))">
            total
          </text>
        </svg>

        <div className="space-y-2">
          {entries.map(([channel, count]) => (
            <div key={channel} className="flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: COLORS[channel] || COLORS.unknown }}
              />
              <span className="text-[12px] font-medium text-ink">
                {LABELS[channel] || channel}
              </span>
              <span className="text-[11px] text-ink-muted">
                {count} ({Math.round((count / total) * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
