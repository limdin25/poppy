import type { ReactNode } from 'react'
import { cn } from '@/core/lib/cn'

export interface IconTabOption {
  value: string
  icon: ReactNode
  /** Full name — shown as tooltip and announced to screen readers. */
  title: string
  count?: number
}

interface IconTabsProps {
  options: IconTabOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

/**
 * Icon-only segmented control. One slim line that never wraps — the selected
 * tab's full name is expected to be displayed elsewhere (e.g. the list title).
 */
export function IconTabs({ options, value, onChange, className }: IconTabsProps) {
  return (
    <div className={cn('flex w-full items-center gap-0.5 rounded-xl bg-elevated p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        const count = o.count ?? 0
        const showCount = count > 0
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            title={`${o.title}${showCount ? ` (${count})` : ''}`}
            aria-label={o.title}
            aria-pressed={active}
            className={cn(
              'flex h-7 flex-1 items-center justify-center gap-1 rounded-[10px] transition',
              active ? 'bg-surface text-ink shadow-soft' : 'text-ink-subtle hover:text-ink',
            )}
          >
            {o.icon}
            {showCount && (
              <span className={cn('text-[10px] font-semibold leading-none', active ? 'text-ink' : 'text-ink-subtle')}>
                {count > 999 ? '1k+' : count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
