import type { ReactNode } from 'react'
import { cn } from '@/core/lib/cn'

interface SectionCardProps {
  title?: string
  eyebrow?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

/** Waslo-style card: small uppercase eyebrow/title + optional right action, then body. */
export function SectionCard({ title, eyebrow, action, children, className, bodyClassName }: SectionCardProps) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface shadow-soft', className)}>
      {(title || eyebrow || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{eyebrow}</p>}
            {title && <h3 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h3>}
          </div>
          {action && <div className="shrink-0 text-[12px] text-ink-muted">{action}</div>}
        </div>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </div>
  )
}
