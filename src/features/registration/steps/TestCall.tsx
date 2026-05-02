import { Phone, MessageSquare, HelpCircle, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface Props {
  agentNumber: string
}

const SUGGESTED_QUESTIONS = [
  'Do you have any specialist services?',
  'Tell me something about your business?',
  'What services do you offer?',
  'Can I book an appointment?',
]

export default function TestCall({ agentNumber }: Props) {
  const navigate = useNavigate()

  const formattedNumber = agentNumber || '07445 732254'

  return (
    <div className="flex flex-1 flex-col items-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
        <Phone size={28} className="text-success" />
      </div>

      <h1 className="mt-6 text-2xl font-semibold text-ink">
        Try a test call
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        Hear how professional your AI receptionist sounds.
      </p>

      {/* Number display */}
      <a
        href={`tel:${formattedNumber.replace(/\s/g, '')}`}
        className="mt-8 flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-brand bg-brand-50 p-6 transition-colors hover:bg-brand-100 active:scale-[0.98]"
      >
        <Phone size={24} className="text-brand" />
        <span className="text-2xl font-bold tracking-wide text-brand">
          {formattedNumber}
        </span>
      </a>
      <p className="mt-2 text-[13px] text-ink-muted">
        Tap to call this number
      </p>

      {/* Suggested questions */}
      <div className="mt-8 w-full text-left">
        <div className="flex items-center gap-2">
          <HelpCircle size={16} className="text-ink-muted" />
          <p className="text-[13px] font-medium text-ink-muted">
            Try asking these questions
          </p>
        </div>
        <div className="mt-3 space-y-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <div
              key={q}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <MessageSquare size={16} className="shrink-0 text-brand" />
              <span className="text-[14px] text-ink">{q}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-6 text-[13px] text-ink-subtle">
        You can test your agent anytime from your dashboard.
      </p>

      {/* Go to dashboard */}
      <div className="mt-auto w-full pt-6">
        <button
          onClick={() => navigate('/')}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[15px] font-semibold text-white shadow-soft transition-all hover:bg-brand-600 active:scale-[0.98]"
        >
          Go to Dashboard
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  )
}
