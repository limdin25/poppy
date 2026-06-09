import type { ReactNode } from 'react'
import { cn } from '@/core/lib/cn'

export interface ChipOption {
  value: string
  label: string
  count?: number
  icon?: ReactNode
  /** Tooltip — useful when the chip is icon-only. */
  title?: string
}

interface FilterChipsProps {
  options: ChipOption[]
  value: string
  onChange: (value: string) => void
  className?: string
  /** 'sm' renders denser chips (tight padding, smaller text). */
  size?: 'md' | 'sm'
  /** Hide the count badge when it is 0 — keeps dense rows quiet. */
  hideZeroCounts?: boolean
}

/** Waslo-style segmented filter chips (e.g. All / WhatsApp). Active = black pill. */
export function FilterChips({ options, value, onChange, className, size = 'md', hideZeroCounts = false }: FilterChipsProps) {
  const dense = size === 'sm'
  return (
    <div className={cn('flex flex-wrap items-center', dense ? 'gap-1' : 'gap-1.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        const showCount = typeof o.count === 'number' && !(hideZeroCounts && o.count === 0)
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={o.title}
            aria-label={o.title || o.label || undefined}
            className={cn(
              'inline-flex items-center rounded-full font-medium transition',
              dense ? 'gap-1 px-2 py-1 text-[11.5px]' : 'gap-1.5 px-3 py-1.5 text-[12.5px]',
              active ? 'bg-accent text-white' : 'text-ink-muted hover:bg-elevated hover:text-ink',
            )}
          >
            {o.icon}
            {o.label}
            {showCount && (
              <span className={cn(dense ? 'text-[10.5px]' : 'text-[11px]', active ? 'text-white/70' : 'text-ink-subtle')}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
