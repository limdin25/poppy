import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/hooks/useBusiness'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useSyncPrompt } from '../useSyncPrompt'

const PLACEHOLDER = `Always be polite and professional. If you don't know the answer to something, say "Let me take your details and have someone call you back" rather than guessing.

Never quote exact prices unless they're listed in the FAQ. Instead, offer to arrange a free quote.

If a caller sounds distressed (e.g. flooding, gas leak), prioritise getting their address and reassure them we'll send someone as soon as possible.`

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
]

export default function BehaviourSection() {
  const { businessId } = useAuth()
  const { data: business, refetch } = useBusiness()
  const { syncPrompt, syncing } = useSyncPrompt()
  const [instructions, setInstructions] = useState('')
  const [tone, setTone] = useState('professional')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (business) {
      setInstructions(business.ai_system_prompt || '')
      setTone(business.tone || 'professional')
    }
  }, [business])

  async function handleSave() {
    if (!businessId) return
    setSaving(true)
    const { error } = await supabase
      .from('businesses')
      .update({ ai_system_prompt: instructions, tone })
      .eq('id', businessId)
    if (!error) {
      await syncPrompt()
      refetch()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Tone</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Set the overall tone for how Elsie communicates with your customers.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTone(opt.value)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
                tone === opt.value
                  ? 'bg-brand text-white'
                  : 'bg-elevated text-ink-muted hover:bg-brand/10 hover:text-brand'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Custom Instructions</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Give Elsie specific instructions about how to handle calls and messages.
          Write these as if you're briefing a new receptionist on their first day.
        </p>

        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={10}
          className="mt-4 w-full rounded-xl border border-border bg-surface p-4 text-[14px] leading-relaxed text-ink outline-none resize-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[12px] text-ink-subtle">
            {instructions.length} / 2000 characters
          </span>
          <button
            onClick={handleSave}
            disabled={saving || syncing}
            className="flex h-10 items-center gap-2 rounded-lg bg-brand px-6 text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            {(saving || syncing) && <Loader2 size={16} className="animate-spin" />}
            {saved ? 'Saved!' : (saving || syncing) ? 'Saving & syncing...' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h3 className="text-[14px] font-medium text-ink">Examples of good instructions</h3>
        <div className="mt-3 space-y-3">
          {[
            'If someone asks for a discount, say we occasionally have seasonal offers and take their details.',
            'For commercial/business enquiries over 5 properties, transfer to the owner directly.',
            'Always confirm the caller\'s postcode is in our service area before booking.',
          ].map((example, i) => (
            <div key={i} className="rounded-lg bg-elevated px-4 py-3 text-[13px] text-ink-muted">
              "{example}"
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
