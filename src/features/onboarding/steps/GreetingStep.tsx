import { useState, useEffect } from 'react'
import { RotateCcw, Sparkles } from 'lucide-react'

const DEFAULT_GREETING = "Good morning, Smith & Sons Plumbing, you're speaking with Poppy. How can I help you today?"

interface Props {
  onChange: (greeting: string) => void
}

export default function GreetingStep({ onChange }: Props) {
  const [greeting, setGreeting] = useState(DEFAULT_GREETING)

  useEffect(() => { onChange(greeting) }, [greeting])

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Set your greeting</h2>
      <p className="mt-2 text-[15px] text-ink-muted">
        This is the first thing callers hear. Make it friendly and professional.
      </p>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-[13px] text-brand">
        <Sparkles size={14} />
        <span>AI-generated greeting — edit to match your style</span>
      </div>

      <textarea
        value={greeting}
        onChange={(e) => setGreeting(e.target.value)}
        rows={4}
        className="mt-5 w-full rounded-xl border border-border bg-surface p-4 text-[15px] leading-relaxed text-ink outline-none resize-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={() => setGreeting(DEFAULT_GREETING)}
          className="flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
        >
          <RotateCcw size={14} />
          Reset
        </button>
        <span className="text-[12px] text-ink-subtle">{greeting.length} chars</span>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-elevated p-4">
        <p className="text-[12px] font-medium text-ink-muted">How it sounds:</p>
        <div className="mt-3 flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[12px] font-bold text-brand">
            P
          </div>
          <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
            <p className="text-[14px] leading-relaxed text-ink">{greeting}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
