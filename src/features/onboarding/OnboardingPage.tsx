import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ArrowRight, ArrowLeft } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import ServicesStep from './steps/ServicesStep'
import FAQsStep from './steps/FAQsStep'
import GreetingStep from './steps/GreetingStep'
import CallInfoStep from './steps/CallInfoStep'
import TestCallStep from './steps/TestCallStep'

const STEPS = [
  { label: 'Services', component: ServicesStep },
  { label: 'FAQs', component: FAQsStep },
  { label: 'Greeting', component: GreetingStep },
  { label: 'Call Info', component: CallInfoStep },
  { label: 'Test Call', component: TestCallStep },
]

export default function OnboardingPage() {
  const [step, setStep] = useState(0)
  const navigate = useNavigate()

  const StepComponent = STEPS[step].component
  const isLast = step === STEPS.length - 1

  function next() {
    if (isLast) {
      navigate('/')
    } else {
      setStep((s) => s + 1)
    }
  }

  function back() {
    setStep((s) => Math.max(0, s - 1))
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-surface px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="text-[16px] font-semibold text-ink">Set up Poppy</span>
          <button
            onClick={() => navigate('/')}
            className="text-[13px] text-ink-muted hover:text-ink"
          >
            Skip for now
          </button>
        </div>
      </header>

      {/* Progress */}
      <div className="border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={i} className="flex flex-1 items-center gap-2">
              <div className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition',
                i < step ? 'bg-success text-white' :
                i === step ? 'bg-brand text-white' :
                'bg-elevated text-ink-subtle'
              )}>
                {i < step ? <Check size={14} /> : i + 1}
              </div>
              <span className={cn(
                'hidden text-[13px] font-medium sm:block',
                i === step ? 'text-ink' : 'text-ink-subtle'
              )}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={cn(
                  'h-px flex-1',
                  i < step ? 'bg-success' : 'bg-border'
                )} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <div className="mx-auto w-full max-w-2xl flex-1">
          <StepComponent />
        </div>
      </main>

      {/* Footer nav */}
      <footer className="border-t border-border bg-surface px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <button
            onClick={back}
            disabled={step === 0}
            className="flex h-10 items-center gap-1.5 rounded-lg border border-border px-4 text-[14px] font-medium text-ink-muted transition hover:bg-elevated disabled:opacity-0"
          >
            <ArrowLeft size={16} />
            Back
          </button>
          <button
            onClick={next}
            className="flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-[14px] font-semibold text-white transition hover:bg-brand-600 active:scale-[0.98]"
          >
            {isLast ? 'Go to Dashboard' : 'Next'}
            <ArrowRight size={16} />
          </button>
        </div>
      </footer>
    </div>
  )
}
