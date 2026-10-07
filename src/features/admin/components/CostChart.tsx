import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/core/lib/cn'
import {
  bucketLabel, gbp, niceMax, usd,
  type Bucket, type StackModel, type StackRow,
} from '../lib/aiCosts'

interface Props {
  rows: StackRow[]
  models: StackModel[]
  max: number
  bucket: Bucket
  rate: number | null
}

const CHART_HEIGHT = 220

/** Spend per hour or per day, each bar split by model. Plain CSS, so it fits any screen. */
export function CostChart({ rows, models, max, bucket, rate }: Props) {
  const top = niceMax(max)
  const pitch = bucket === 'hour' ? 20 : 38
  const [picked, setPicked] = useState<number | null>(null)
  // New data means new bars, so the old pick points at the wrong one.
  useEffect(() => setPicked(null), [rows])

  // Nothing picked yet: show the most expensive bar, so the panel is never empty.
  const busiest = useMemo(() => rows.reduce((best, r, i) => (r.total > (rows[best]?.total ?? -1) ? i : best), 0), [rows])
  // On a phone the bars run off to the side. Start with the busiest one in view.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = Math.max(0, busiest * pitch - el.clientWidth / 2)
  }, [busiest, pitch, rows])
  const shown = rows[picked ?? busiest]
  const labelEvery = bucket === 'hour' ? 3 : Math.max(1, Math.ceil(rows.length / 10))
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  const axisLabel = (row: StackRow, i: number) => {
    if (i % labelEvery !== 0) return ''
    const [date, time] = row.bucket.split('T')
    if (bucket === 'day') return bucketLabel(row.bucket, 'day')
    return time === '00:00' ? bucketLabel(date, 'day') : `${time.slice(0, 2)}h`
  }

  return (
    <div>
      <div className="flex pt-3">
        <div className="relative w-12 shrink-0" style={{ height: CHART_HEIGHT }} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-ink-subtle" style={{ bottom: `${t * 100}%` }}>
              {t === 0 ? '0' : usd(top * t)}
            </span>
          ))}
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto scrollbar-thin">
          <div className="relative" style={{ height: CHART_HEIGHT, minWidth: rows.length * pitch }}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-border/70" style={{ bottom: `${t * 100}%` }} aria-hidden="true" />
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px]" role="list" aria-label="Spend over time">
              {rows.map((row, i) => (
                <button
                  key={row.bucket}
                  type="button"
                  role="listitem"
                  aria-label={`${bucketLabel(row.bucket, bucket)}, ${usd(row.total)}, ${row.calls} calls`}
                  onMouseEnter={() => setPicked(i)}
                  onFocus={() => setPicked(i)}
                  onClick={() => setPicked(i)}
                  className={cn('flex h-full flex-1 flex-col-reverse rounded-sm outline-none transition', (picked ?? busiest) === i ? 'bg-brand/10' : 'hover:bg-elevated')}
                  style={{ minWidth: pitch - 2 }}
                >
                  {models.map((m) => {
                    const part = row.parts[m.key]
                    if (!part) return null
                    return <span key={m.key} className="block w-full" style={{ height: `${(part / top) * 100}%`, minHeight: 1, background: m.colour }} />
                  })}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-[2px] pt-1" aria-hidden="true" style={{ minWidth: rows.length * pitch }}>
            {rows.map((row, i) => (
              <span key={row.bucket} className="flex-1 overflow-visible whitespace-nowrap text-[10px] text-ink-subtle" style={{ minWidth: pitch - 2 }}>
                {axisLabel(row, i)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {shown && (
        <div className="mt-3 rounded-lg border border-border bg-elevated p-3" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[13px] font-semibold text-ink">{bucketLabel(shown.bucket, bucket)}</p>
            <p className="text-[13px] text-ink">
              <span className="font-bold tabular-nums">{usd(shown.total)}</span>
              {gbp(shown.total, rate) && <span className="ml-1.5 text-[11px] text-ink-muted">{gbp(shown.total, rate)}</span>}
              <span className="ml-2 text-[11px] text-ink-muted">{shown.calls.toLocaleString('en-GB')} calls</span>
            </p>
          </div>
          {shown.total > 0 ? (
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {models.filter((m) => shown.parts[m.key]).sort((a, b) => shown.parts[b.key] - shown.parts[a.key]).map((m) => (
                <li key={m.key} className="flex items-center gap-2 text-[12px]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: m.colour }} />
                  <span className="min-w-0 flex-1 truncate text-ink-muted">{m.model}</span>
                  <span className="tabular-nums text-ink">{usd(shown.parts[m.key])}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[12px] text-ink-muted">Nothing was spent in this {bucket}.</p>
          )}
        </div>
      )}

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {models.map((m) => (
          <li key={m.key} className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: m.colour }} />
            <span>{m.model}</span>
            <span className="text-ink-subtle tabular-nums">{usd(m.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
