import { useState } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface FAQ {
  id: string
  question: string
  answer: string
}

const INITIAL_FAQS: FAQ[] = [
  { id: '1', question: 'What are your opening hours?', answer: "We're available Monday to Friday 8am–6pm, and Saturday 9am–1pm. For emergencies, we offer a 24/7 callout service." },
  { id: '2', question: 'Do you offer free quotes?', answer: "Yes! We provide free, no-obligation quotes for all work. For larger jobs like bathroom refits, we'll arrange a site visit first." },
  { id: '3', question: 'What areas do you cover?', answer: "We cover Brighton, Hove, and surrounding areas within a 15-mile radius including Worthing, Lewes, and Shoreham." },
  { id: '4', question: 'Are you Gas Safe registered?', answer: 'Yes, we are fully Gas Safe registered (reg. 543210). All our engineers hold valid Gas Safe ID cards.' },
  { id: '5', question: 'How quickly can you come for an emergency?', answer: 'For emergencies, we aim to be with you within 1–2 hours during working hours, or within 4 hours for out-of-hours callouts.' },
]

export default function FAQsSection() {
  const [faqs, setFaqs] = useState(INITIAL_FAQS)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editQ, setEditQ] = useState('')
  const [editA, setEditA] = useState('')

  function startEdit(faq: FAQ) {
    setEditing(faq.id)
    setEditQ(faq.question)
    setEditA(faq.answer)
  }

  function saveEdit() {
    setFaqs(faqs.map((f) => f.id === editing ? { ...f, question: editQ, answer: editA } : f))
    setEditing(null)
  }

  function deleteFaq(id: string) {
    setFaqs(faqs.filter((f) => f.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Frequently Asked Questions</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Poppy uses these to answer common questions instantly.
            </p>
          </div>
          <button className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600">
            <Plus size={14} />
            Add
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {faqs.map((faq) => (
            <div key={faq.id} className="rounded-xl border border-border transition hover:border-brand/20">
              {editing === faq.id ? (
                <div className="p-4 space-y-3">
                  <input
                    type="text"
                    value={editQ}
                    onChange={(e) => setEditQ(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-elevated px-3 text-[14px] text-ink outline-none focus:border-brand"
                  />
                  <textarea
                    value={editA}
                    onChange={(e) => setEditA(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-[14px] text-ink outline-none resize-none focus:border-brand"
                  />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="h-9 rounded-lg bg-brand px-4 text-[13px] font-medium text-white">Save</button>
                    <button onClick={() => setEditing(null)} className="h-9 rounded-lg border border-border px-4 text-[13px] text-ink-muted">Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
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
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => startEdit(faq)} className="flex items-center gap-1.5 text-[12px] text-brand hover:underline">
                          <Pencil size={12} /> Edit
                        </button>
                        <button onClick={() => deleteFaq(faq.id)} className="flex items-center gap-1.5 text-[12px] text-danger hover:underline">
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
