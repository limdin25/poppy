import { cn } from '@/core/lib/cn'
import type { DateRange } from '../types'

interface Props {
  value: DateRange
  onChange: (range: DateRange) => void
}

const presets: Array<{ key: DateRange['preset']; label: string; days: number }> = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
]

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

export function DateRangePicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map(p => (
        <button
          key={p.key}
          onClick={() => onChange({
            from: p.key === 'today' ? new Date().toISOString().slice(0, 10) : daysAgo(p.days),
            to: endOfToday(),
            preset: p.key,
          })}
          className={cn(
            'rounded-lg px-3 py-1.5 text-[12px] font-medium transition',
            value.preset === p.key
              ? 'bg-brand text-white'
              : 'bg-elevated text-ink-muted hover:bg-brand/10 hover:text-ink'
          )}
        >
          {p.label}
        </button>
      ))}
      <button
        onClick={() => onChange({ ...value, preset: 'custom' })}
        className={cn(
          'rounded-lg px-3 py-1.5 text-[12px] font-medium transition',
          value.preset === 'custom'
            ? 'bg-brand text-white'
            : 'bg-elevated text-ink-muted hover:bg-brand/10 hover:text-ink'
        )}
      >
        Custom
      </button>
      {value.preset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={value.from.slice(0, 10)}
            onChange={e => onChange({ ...value, from: e.target.value })}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-ink"
          />
          <span className="text-[11px] text-ink-muted">to</span>
          <input
            type="date"
            value={value.to.slice(0, 10)}
            onChange={e => onChange({ ...value, to: e.target.value + 'T23:59:59.999Z' })}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-ink"
          />
        </div>
      )}
    </div>
  )
}
