import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { saveBusinessInfo, saveServices, saveFAQs, saveGreeting } from './hooks/useOnboardingSave'
import BusinessInfoStep, { type BusinessInfo } from './steps/BusinessInfoStep'
import ServicesStep from './steps/ServicesStep'
import FAQsStep from './steps/FAQsStep'
import GreetingStep from './steps/GreetingStep'
import ConnectWhatsAppStep from './steps/ConnectWhatsAppStep'

const STEPS = ['Business', 'Train your AI', 'Connect WhatsApp']

export default function OnboardingPage() {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const { businessId } = useAuth()

  const businessRef = useRef<BusinessInfo>({ name: '', industry: '', address: '', website: '' })
  const servicesRef = useRef<string[]>([])
  const faqsRef = useRef<{ question: string; answer: string }[]>([])
  const greetingRef = useRef('')

  const isLast = step === STEPS.length - 1

  async function next() {
    if (!businessId) {
      if (isLast) navigate('/')
      else setStep((s) => s + 1)
      return
    }

    setSaving(true)
    try {
      if (step === 0) {
        await saveBusinessInfo(businessId, businessRef.current)
      } else if (step === 1) {
        await saveServices(businessId, servicesRef.current)
        await saveFAQs(businessId, faqsRef.current)
        await saveGreeting(businessId, greetingRef.current)
      }
    } catch (err) {
      console.error('[onboarding] save error:', err)
    } finally {
      setSaving(false)
    }

    if (isLast) navigate('/')
    else setStep((s) => s + 1)
  }

  function back() {
    setStep((s) => Math.max(0, s - 1))
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-surface px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="text-[16px] font-semibold text-ink">Set up Elsie</span>
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
          {STEPS.map((label, i) => (
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
                {label}
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
          {step === 0 && <BusinessInfoStep onChange={(b) => { businessRef.current = b }} />}
          {step === 1 && (
            <div className="space-y-10">
              <ServicesStep onChange={(s) => { servicesRef.current = s }} />
              <FAQsStep onChange={(f) => { faqsRef.current = f }} />
              <GreetingStep onChange={(g) => { greetingRef.current = g }} />
            </div>
          )}
          {step === 2 && <ConnectWhatsAppStep />}
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
            disabled={saving}
            className="flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-[14px] font-semibold text-white transition hover:bg-brand-600 active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isLast ? 'Finish' : 'Next'}
            <ArrowRight size={16} />
          </button>
        </div>
      </footer>
    </div>
  )
}
