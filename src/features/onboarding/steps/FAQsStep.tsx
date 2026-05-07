import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'

interface FAQ {
  id: string
  question: string
  answer: string
}

const AI_FAQS: FAQ[] = [
  { id: '1', question: 'What are your opening hours?', answer: 'We\'re available Monday to Friday 8am–6pm, and Saturday 9am–1pm. For emergencies, we offer a 24/7 callout service.' },
  { id: '2', question: 'Do you offer free quotes?', answer: 'Yes! We provide free, no-obligation quotes for all work.' },
  { id: '3', question: 'What areas do you cover?', answer: 'We cover Brighton, Hove, and surrounding areas within a 15-mile radius.' },
  { id: '4', question: 'Are you Gas Safe registered?', answer: 'Yes, we are fully Gas Safe registered. All our engineers hold valid Gas Safe ID cards.' },
]

interface Props {
  onChange: (faqs: { question: string; answer: string }[]) => void
}

export default function FAQsStep({ onChange }: Props) {
  const [faqs, setFaqs] = useState(AI_FAQS)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    onChange(faqs.map((f) => ({ question: f.question, answer: f.answer })))
  }, [faqs])

  function remove(id: string) {
    setFaqs(faqs.filter((f) => f.id !== id))
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Check your FAQs</h2>
      <p className="mt-2 text-[15px] text-ink-muted">
        Elsie uses these to answer common questions instantly on calls.
      </p>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-[13px] text-brand">
        <Sparkles size={14} />
        <span>AI-generated — edit any answers that aren't quite right</span>
      </div>

      <div className="mt-5 space-y-2">
        {faqs.map((faq) => (
          <div key={faq.id} className="rounded-xl border border-border bg-surface shadow-sm">
            <button
              onClick={() => setExpanded(expanded === faq.id ? null : faq.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-[14px] font-medium text-ink">{faq.question}</span>
              {expanded === faq.id ? <ChevronUp size={16} className="text-ink-subtle" /> : <ChevronDown size={16} className="text-ink-subtle" />}
            </button>
            {expanded === faq.id && (
              <div className="border-t border-border px-4 py-3">
                <p className="text-[14px] leading-relaxed text-ink-muted">{faq.answer}</p>
                <div className="mt-3 flex gap-3">
                  <button className="flex items-center gap-1.5 text-[12px] text-brand hover:underline">
                    <Pencil size={12} /> Edit answer
                  </button>
                  <button onClick={() => remove(faq.id)} className="flex items-center gap-1.5 text-[12px] text-danger hover:underline">
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button className="mt-4 flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
        <Plus size={14} />
        Add another FAQ
      </button>
    </div>
  )
}
