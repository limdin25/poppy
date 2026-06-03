import type { ReactNode } from 'react'
import { cn } from '@/core/lib/cn'

export type PillTone =
  | 'hot' | 'warm' | 'cold' | 'new'
  | 'active' | 'paused'
  | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const TONES: Record<PillTone, string> = {
  hot: 'bg-red-50 text-red-600',
  warm: 'bg-amber-50 text-amber-600',
  cold: 'bg-blue-50 text-blue-600',
  new: 'bg-violet-50 text-violet-600',
  active: 'bg-accent text-white',
  paused: 'bg-elevated text-ink-muted ring-1 ring-inset ring-border',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-red-50 text-red-600',
  info: 'bg-blue-50 text-blue-600',
  neutral: 'bg-elevated text-ink-muted ring-1 ring-inset ring-border',
}

interface StatusPillProps {
  tone: PillTone
  children: ReactNode
  icon?: ReactNode
  className?: string
  uppercase?: boolean
}

/** Waslo-style soft status pill (CONTACTED / COLD / Active …). */
export function StatusPill({ tone, children, icon, className, uppercase = true }: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        uppercase && 'uppercase tracking-wide',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
