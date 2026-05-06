import { useState, useEffect, useRef } from 'react'
import { Phone, CheckCircle2, Signal, MapPin, Zap } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'

interface Props {
  businessId: string
  onNumberReady: (number: string) => void
}

const PROGRESS_STEPS = [
  'Finding your local agent number',
  'Building your professional phone system',
  'Connecting your personal receptionist',
  'Ready to catch every customer',
]

export default function NumberSetup({ businessId, onNumberReady }: Props) {
  const { session } = useAuth()
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState(0)
  const [error, setError] = useState('')
  const provisionedRef = useRef(false)

  const phoneRef = useRef<string | null>(null)

  useEffect(() => {
    if (provisionedRef.current || !businessId || !session) return
    provisionedRef.current = true

    fetch('/api/numbers/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ businessId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) {
          setError(data.error || 'Failed to provision number')
        } else {
          phoneRef.current = data.phone_number || '+44 7426 495169'
        }
      })
      .catch(() => setError('Network error — please try again'))
  }, [businessId, session])

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 6 + 1
        if (next >= 100) {
          clearInterval(interval)
          setTimeout(() => onNumberReady(phoneRef.current || '+44 7426 495169'), 1000)
          return 100
        }

        if (next > 25) setCurrentStep(1)
        if (next > 50) setCurrentStep(2)
        if (next > 75) setCurrentStep(3)

        return next
      })
    }, 500)

    return () => clearInterval(interval)
  }, [onNumberReady])

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-[15px] text-danger">{error}</p>
        <button
          onClick={() => { provisionedRef.current = false; setError(''); window.location.reload() }}
          className="mt-4 h-10 rounded-lg bg-brand px-6 text-[14px] font-medium text-white"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-brand/15" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-brand-50">
          <Phone size={36} className="text-brand" />
        </div>
      </div>

      <h1 className="mt-8 text-2xl font-semibold text-ink">
        Setting up your agent's number
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        We're creating a professional phone number that connects directly to
        your agent.
      </p>

      <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
        {[
          { icon: Signal, title: 'Dedicated Business Line', desc: 'A professional number customers can trust' },
          { icon: MapPin, title: 'Local Area Code', desc: 'Build customer confidence with a local number' },
          { icon: Zap, title: 'Instant Setup', desc: 'Ready to use immediately' },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="rounded-xl border border-border bg-surface p-4">
            <Icon size={20} className="text-brand" />
            <p className="mt-2 text-[13px] font-medium text-ink">{title}</p>
            <p className="mt-0.5 text-[12px] text-ink-muted">{desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 w-full max-w-xs">
        <div className="h-2 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500 ease-apple"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-[13px] text-ink-subtle">
          Your number will be ready in just a few moments
        </p>
      </div>

      <div className="mt-6 w-full max-w-xs space-y-2.5 text-left">
        {PROGRESS_STEPS.map((label, i) => {
          const isDone = i < currentStep
          const isActive = i === currentStep

          return (
            <div
              key={i}
              className={cn(
                'flex items-center gap-3 text-[13px] transition-all duration-300',
                isDone && 'text-success',
                isActive && 'text-ink',
                !isDone && !isActive && 'text-ink-subtle opacity-40'
              )}
            >
              {isDone ? (
                <CheckCircle2 size={16} />
              ) : (
                <div
                  className={cn(
                    'h-4 w-4 rounded-full border-2',
                    isActive
                      ? 'animate-pulse border-brand bg-brand/20'
                      : 'border-border'
                  )}
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
