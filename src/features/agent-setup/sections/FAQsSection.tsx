import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useSyncPrompt } from '../useSyncPrompt'

interface FAQ {
  id: string
  question: string
  answer: string
}

export default function FAQsSection() {
  const { businessId } = useAuth()
  const { syncPrompt, syncing } = useSyncPrompt()
  const [faqs, setFaqs] = useState<FAQ[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editQ, setEditQ] = useState('')
  const [editA, setEditA] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [newQ, setNewQ] = useState('')
  const [newA, setNewA] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!businessId) return
    supabase
      .from('faqs')
      .select('id, question, answer')
      .eq('business_id', businessId)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setFaqs(data as FAQ[])
        setLoading(false)
      })
  }, [businessId])

  function startEdit(faq: FAQ) {
    setEditing(faq.id)
    setEditQ(faq.question)
    setEditA(faq.answer)
  }

  function saveEdit() {
    setFaqs(faqs.map((f) => f.id === editing ? { ...f, question: editQ, answer: editA } : f))
    setEditing(null)
    setDirty(true)
  }

  function deleteFaq(id: string) {
    setFaqs(faqs.filter((f) => f.id !== id))
    setDirty(true)
  }

  function addFaq() {
    if (newQ.trim() && newA.trim()) {
      setFaqs([...faqs, { id: Date.now().toString(), question: newQ.trim(), answer: newA.trim() }])
      setNewQ('')
      setNewA('')
      setAddingNew(false)
      setDirty(true)
    }
  }

  async function handleSave() {
    if (!businessId) return
    setSaving(true)
    const { error: delErr } = await supabase.from('faqs').delete().eq('business_id', businessId)
    if (!delErr && faqs.length > 0) {
      await supabase.from('faqs').insert(
        faqs.map((f, i) => ({ business_id: businessId, question: f.question, answer: f.answer, sort_order: i }))
      )
    }
    await syncPrompt()
    setSaving(false)
    setSaved(true)
    setDirty(false)
    setTimeout(() => setSaved(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-ink-muted" />
      </div>
    )
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
          <button
            onClick={() => setAddingNew(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
          >
            <Plus size={14} />
            Add
          </button>
        </div>

        {addingNew && (
          <div className="mt-4 space-y-3 rounded-xl border border-brand/20 bg-brand-50 p-4">
            <input
              type="text"
              value={newQ}
              onChange={(e) => setNewQ(e.target.value)}
              placeholder="Question (e.g. Do you offer free quotes?)"
              autoFocus
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-[14px] text-ink outline-none focus:border-brand"
            />
            <textarea
              value={newA}
              onChange={(e) => setNewA(e.target.value)}
              placeholder="Answer"
              rows={3}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[14px] text-ink outline-none resize-none focus:border-brand"
            />
            <div className="flex gap-2">
              <button onClick={addFaq} className="h-9 rounded-lg bg-brand px-4 text-[13px] font-medium text-white">Add</button>
              <button onClick={() => setAddingNew(false)} className="h-9 rounded-lg border border-border px-4 text-[13px] text-ink-muted">Cancel</button>
            </div>
          </div>
        )}

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
          {faqs.length === 0 && (
            <p className="py-4 text-center text-[13px] text-ink-muted">No FAQs added yet. Click "Add" to get started.</p>
          )}
        </div>
      </div>

      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving || syncing}
          className="flex h-10 items-center gap-2 rounded-lg bg-brand px-6 text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {(saving || syncing) && <Loader2 size={16} className="animate-spin" />}
          {saved ? 'Saved!' : (saving || syncing) ? 'Saving & syncing...' : 'Save changes'}
        </button>
      )}
    </div>
  )
}
