import { useState } from 'react'
import { cn } from '@/core/lib/cn'

const DEFAULT_INSTRUCTIONS = `Always be polite and professional. If you don't know the answer to something, say "Let me take your details and have someone call you back" rather than guessing.

Never quote exact prices unless they're listed in the FAQ. Instead, offer to arrange a free quote.

If a caller sounds distressed (e.g. flooding, gas leak), prioritise getting their address and reassure them we'll send someone as soon as possible.`

export default function BehaviourSection() {
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS)
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Custom Instructions</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Give Poppy specific instructions about how to handle calls. Write these as if
          you're briefing a new receptionist on their first day.
        </p>

        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={10}
          className="mt-4 w-full rounded-xl border border-border bg-surface p-4 text-[14px] leading-relaxed text-ink outline-none resize-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[12px] text-ink-subtle">
            {instructions.length} / 2000 characters
          </span>
          <button
            onClick={handleSave}
            className="h-10 rounded-lg bg-brand px-6 text-[14px] font-semibold text-white transition hover:bg-brand-600"
          >
            {saved ? '✓ Saved' : 'Save changes'}
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
