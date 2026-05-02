import { cn } from '@/core/lib/cn'
import { Check } from 'lucide-react'

interface StepIndicatorProps {
  current: number
  labels: string[]
}

export default function StepIndicator({ current, labels }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-between">
      {labels.map((label, i) => {
        const step = i + 1
        const isComplete = step < current
        const isActive = step === current

        return (
          <div key={step} className="flex flex-1 items-center">
            {/* Dot */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium transition-colors',
                  isComplete && 'bg-brand text-white',
                  isActive && 'bg-brand text-white',
                  !isComplete && !isActive && 'bg-elevated text-ink-subtle'
                )}
              >
                {isComplete ? <Check size={16} /> : step}
              </div>
              <span
                className={cn(
                  'mt-1.5 hidden text-[11px] sm:block',
                  isActive ? 'font-medium text-ink' : 'text-ink-subtle'
                )}
              >
                {label}
              </span>
            </div>

            {/* Connector line */}
            {step < labels.length && (
              <div
                className={cn(
                  'mx-2 h-[2px] flex-1',
                  isComplete ? 'bg-brand' : 'bg-border'
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
