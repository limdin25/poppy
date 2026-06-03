import type { ReactNode } from 'react'
import { cn } from '@/core/lib/cn'

export interface ChipOption {
  value: string
  label: string
  count?: number
  icon?: ReactNode
}

interface FilterChipsProps {
  options: ChipOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

/** Waslo-style segmented filter chips (e.g. All / WhatsApp). Active = black pill. */
export function FilterChips({ options, value, onChange, className }: FilterChipsProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition',
              active ? 'bg-accent text-white' : 'text-ink-muted hover:bg-elevated hover:text-ink',
            )}
          >
            {o.icon}
            {o.label}
            {typeof o.count === 'number' && (
              <span className={cn('text-[11px]', active ? 'text-white/70' : 'text-ink-subtle')}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
