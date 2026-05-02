import { Phone, MessageSquare, CheckCircle2 } from 'lucide-react'

const SUGGESTIONS = [
  'What services do you offer?',
  'Can I book an appointment?',
  'What are your opening hours?',
  'Do you cover my area?',
]

export default function TestCallStep() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 size={28} className="text-success" />
      </div>

      <h2 className="mt-6 text-xl font-semibold text-ink">
        Poppy is ready!
      </h2>
      <p className="mt-2 text-[15px] text-ink-muted">
        Give her a test call and hear how she handles your customers.
      </p>

      {/* Phone number */}
      <a
        href="tel:07445732254"
        className="mt-8 flex w-full max-w-sm items-center justify-center gap-3 rounded-2xl border-2 border-brand bg-brand-50 p-6 transition hover:bg-brand-100 active:scale-[0.98]"
      >
        <Phone size={22} className="text-brand" />
        <span className="text-[22px] font-bold tracking-wide text-brand">
          07445 732254
        </span>
      </a>
      <p className="mt-2 text-[13px] text-ink-subtle">Tap to call</p>

      {/* Suggestions */}
      <div className="mt-8 w-full max-w-sm text-left">
        <p className="text-[13px] font-medium text-ink-muted">Try asking:</p>
        <div className="mt-3 space-y-2">
          {SUGGESTIONS.map((q) => (
            <div
              key={q}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <MessageSquare size={14} className="shrink-0 text-brand" />
              <span className="text-[14px] text-ink">{q}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
