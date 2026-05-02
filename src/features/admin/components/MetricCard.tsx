import { cn } from '@/core/lib/cn'
import type { ReactNode } from 'react'

interface MetricCardProps {
  label: string
  value: string | number
  change?: string
  trend?: 'up' | 'down' | 'neutral'
  icon?: ReactNode
}

export function MetricCard({ label, value, change, trend, icon }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
        {icon && <div className="text-ink-subtle">{icon}</div>}
      </div>
      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
      {change && (
        <p
          className={cn(
            'mt-1 text-[12px] font-medium',
            trend === 'up' && 'text-success',
            trend === 'down' && 'text-danger',
            trend === 'neutral' && 'text-ink-muted'
          )}
        >
          {change}
        </p>
      )}
    </div>
  )
}
