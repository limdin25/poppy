import { useState, useEffect } from 'react'
import { RotateCcw, Phone, Loader2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/hooks/useBusiness'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useSyncPrompt } from '../useSyncPrompt'

export default function GreetingSection() {
  const { businessId } = useAuth()
  const { data: business, loading: bizLoading } = useBusiness()
  const { syncPrompt, syncing } = useSyncPrompt()
  const [greeting, setGreeting] = useState('')
  const [defaultGreeting, setDefaultGreeting] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (business) {
      const def = `Hello, ${business.name}, you're speaking with Elsie. How can I help you today?`
      setDefaultGreeting(def)
      setGreeting(business.greeting || def)
    }
  }, [business])

  async function handleSave() {
    if (!businessId) return
    setSaving(true)
    await supabase.from('businesses').update({ greeting }).eq('id', businessId)
    await syncPrompt()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (bizLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Opening Greeting</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          This is what callers hear first when Elsie picks up.
        </p>

        <textarea
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          rows={4}
          className="mt-4 w-full rounded-xl border border-border bg-surface p-4 text-[15px] leading-relaxed text-ink outline-none resize-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />

        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={() => setGreeting(defaultGreeting)}
            className="flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
          >
            <RotateCcw size={14} />
            Reset to default
          </button>
          <span className="text-[12px] text-ink-subtle">
            {greeting.length} characters
          </span>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || syncing}
          className="mt-4 flex h-10 items-center gap-2 rounded-lg bg-brand px-6 text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60 sm:w-auto"
        >
          {(saving || syncing) && <Loader2 size={16} className="animate-spin" />}
          {saved ? 'Saved!' : (saving || syncing) ? 'Saving & syncing...' : 'Save changes'}
        </button>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center gap-2">
          <Phone size={16} className="text-ink-muted" />
          <h3 className="text-[14px] font-medium text-ink">Preview</h3>
        </div>
        <div className="mt-4 rounded-xl bg-elevated p-4">
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[12px] font-bold text-brand">
              E
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
              <p className="text-[14px] leading-relaxed text-ink">{greeting}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h3 className="text-[14px] font-medium text-ink">Tips for a great greeting</h3>
        <ul className="mt-3 space-y-2 text-[13px] text-ink-muted">
          <li>• Keep it under 20 seconds when spoken aloud</li>
          <li>• Include your business name so callers know they've reached the right place</li>
          <li>• End with an open question to prompt the caller to speak</li>
          <li>• Avoid jargon — keep it friendly and professional</li>
        </ul>
      </div>
    </div>
  )
}
