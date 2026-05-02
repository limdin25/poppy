import { cn } from '@/core/lib/cn'

const STYLES = {
  active: 'bg-success/10 text-success',
  suspended: 'bg-danger/10 text-danger',
  trial: 'bg-brand/10 text-brand',
  churned: 'bg-elevated text-ink-muted',
} as const

interface StatusBadgeProps {
  status: keyof typeof STYLES
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium capitalize', STYLES[status])}>
      {status}
    </span>
  )
}
