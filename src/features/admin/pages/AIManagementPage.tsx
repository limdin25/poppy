import { useState } from 'react'
import { Bot, Volume2, Star, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface PromptEntry {
  id: string
  business: string
  greeting: string
  tone: string
  servicesCount: number
  faqsCount: number
  lastUpdated: string
}

const MOCK_PROMPTS: PromptEntry[] = [
  { id: '1', business: 'Smith & Sons Plumbing', greeting: "Good morning, Smith & Sons Plumbing, you're speaking with Poppy...", tone: 'friendly', servicesCount: 5, faqsCount: 8, lastUpdated: '2 days ago' },
  { id: '2', business: 'Brighton Heating Co', greeting: 'Hello, Brighton Heating, Poppy here. How can I help?', tone: 'professional', servicesCount: 4, faqsCount: 6, lastUpdated: '1 week ago' },
  { id: '3', business: "Sarah's Hair Salon", greeting: "Hi there! You've reached Sarah's Salon, Poppy speaking...", tone: 'warm', servicesCount: 8, faqsCount: 4, lastUpdated: '3 days ago' },
  { id: '4', business: 'D&M Electrical Services', greeting: 'Good day, D&M Electrical, Poppy answering. How may I assist?', tone: 'formal', servicesCount: 6, faqsCount: 10, lastUpdated: '5 days ago' },
]

const MOCK_VOICES = [
  { id: 'v1', name: 'Emily', accent: 'British', usage: 28, quality: 4.8 },
  { id: 'v2', name: 'James', accent: 'British', usage: 12, quality: 4.6 },
  { id: 'v3', name: 'Sophie', accent: 'British', usage: 7, quality: 4.9 },
]

export default function AIManagementPage() {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">AI Management</h1>
      <p className="mt-1 text-[13px] text-ink-muted">Review and manage system prompts, voices, and quality</p>

      {/* Voices */}
      <h2 className="mt-6 flex items-center gap-2 text-[14px] font-semibold text-ink">
        <Volume2 size={16} />
        Voices in Use
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {MOCK_VOICES.map((v) => (
          <div key={v.id} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink">{v.name}</p>
              <div className="flex items-center gap-1 text-[12px] text-warning">
                <Star size={12} fill="currentColor" />
                {v.quality}
              </div>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-muted">{v.accent}</p>
            <p className="mt-2 text-[12px] text-ink-subtle">{v.usage} businesses using</p>
          </div>
        ))}
      </div>

      {/* Prompts */}
      <h2 className="mt-8 flex items-center gap-2 text-[14px] font-semibold text-ink">
        <Bot size={16} />
        System Prompts by Business
      </h2>
      <div className="mt-3 space-y-2">
        {MOCK_PROMPTS.map((p) => (
          <div key={p.id} className="rounded-xl border border-border">
            <button
              onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{p.business}</p>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-ink-muted">
                  <span>Tone: {p.tone}</span>
                  <span>{p.servicesCount} services</span>
                  <span>{p.faqsCount} FAQs</span>
                  <span>Updated {p.lastUpdated}</span>
                </div>
              </div>
              {expanded === p.id ? (
                <ChevronUp size={14} className="text-ink-subtle" />
              ) : (
                <ChevronDown size={14} className="text-ink-subtle" />
              )}
            </button>
            {expanded === p.id && (
              <div className="border-t border-border px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Greeting</p>
                <p className="mt-1 rounded-lg bg-elevated p-3 text-[13px] leading-relaxed text-ink-muted">
                  {p.greeting}
                </p>
                <div className="mt-3 flex gap-2">
                  <button className="rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-600">
                    Edit Prompt
                  </button>
                  <button className="rounded-md border border-border px-3 py-1.5 text-[12px] text-ink-muted hover:bg-elevated">
                    View History
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
