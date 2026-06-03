import type { ReactNode } from 'react'
import { cn } from '@/core/lib/cn'

interface StatCardProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  className?: string
}

/** Waslo-style stat card: tiny uppercase label + icon, big number, sub-label. */
export function StatCard({ label, value, sub, icon, className }: StatCardProps) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface p-4 shadow-soft', className)}>
      <div className="flex items-center gap-1.5 text-ink-subtle">
        {icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-ink-subtle">{sub}</p>}
    </div>
  )
}
