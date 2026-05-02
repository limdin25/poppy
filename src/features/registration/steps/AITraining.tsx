import { useState, useEffect } from 'react'
import { Brain, CheckCircle2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import type { BusinessData } from '../RegistrationPage'

interface Props {
  business: BusinessData
  onNext: () => void
}

const STEPS = [
  'Scanning your business listing...',
  'Reading your website...',
  'Learning your services...',
  'Building your AI knowledge base...',
  'Almost done...',
]

export default function AITraining({ business, onNext }: Props) {
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 8 + 2
        if (next >= 100) {
          clearInterval(interval)
          setTimeout(onNext, 800)
          return 100
        }

        if (next > 20 && currentStep < 1) {
          setCompletedSteps((s) => [...s, 0])
          setCurrentStep(1)
        }
        if (next > 45 && currentStep < 2) {
          setCompletedSteps((s) => [...s, 1])
          setCurrentStep(2)
        }
        if (next > 65 && currentStep < 3) {
          setCompletedSteps((s) => [...s, 2])
          setCurrentStep(3)
        }
        if (next > 85 && currentStep < 4) {
          setCompletedSteps((s) => [...s, 3])
          setCurrentStep(4)
        }

        return next
      })
    }, 400)

    return () => clearInterval(interval)
  }, [currentStep, onNext])

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      {/* Animated brain */}
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-brand/20" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-brand-50">
          <Brain size={36} className="text-brand" />
        </div>
      </div>

      <h1 className="mt-8 text-2xl font-semibold text-ink">
        Training your AI receptionist
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        Poppy is learning the unique voice of{' '}
        <span className="font-medium text-ink">
          {business.name || 'your business'}
        </span>
      </p>

      {/* Progress bar */}
      <div className="mt-8 w-full max-w-xs">
        <div className="h-2 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500 ease-apple"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-[13px] text-ink-subtle">
          {Math.round(progress)}%
        </p>
      </div>

      {/* Status steps */}
      <div className="mt-8 w-full max-w-xs space-y-3 text-left">
        {STEPS.map((label, i) => {
          const isComplete = completedSteps.includes(i)
          const isActive = i === currentStep && !isComplete

          if (i > currentStep + 1) return null

          return (
            <div
              key={i}
              className={cn(
                'flex items-center gap-3 text-[14px] transition-opacity duration-300',
                isComplete
                  ? 'text-success'
                  : isActive
                    ? 'text-ink'
                    : 'text-ink-subtle opacity-50'
              )}
            >
              {isComplete ? (
                <CheckCircle2 size={18} />
              ) : (
                <div
                  className={cn(
                    'h-4.5 w-4.5 rounded-full border-2',
                    isActive
                      ? 'animate-pulse border-brand bg-brand/20'
                      : 'border-border'
                  )}
                  style={{ width: 18, height: 18 }}
                />
              )}
              {label}
            </div>
          )
        })}
      </div>
    </div>
  )
}
