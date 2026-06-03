import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { Textarea, Label } from '@/core/ui/Input'
import { Switch } from '@/core/ui/Switch'
import { cn } from '@/core/lib/cn'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useDefaultAgent } from '../hooks/useDefaultAgent'
import { NoAgentEmptyState } from './AiPersonalityPage'

/**
 * AI Lead Classification.
 *
 * The agents table has no dedicated classification columns, so per the working
 * agreement we do NOT invent columns. Instead the chosen preset + custom
 * criteria are persisted INTO ai_system_prompt inside a clearly delimited block
 * (CLASSIFICATION_START … CLASSIFICATION_END). Elsie genuinely reads this, so
 * classification guidance is real & persisted. The "Enable" toggle controls
 * whether the block is written at all (disabled = block stripped out).
 *
 * AiPersonalityPage strips this same delimited block from its "instructions"
 * editor (see CLASSIFICATION_START/END below) so the two pages never clobber
 * each other's slice of ai_system_prompt.
 */

export const CLASSIFICATION_START = '[[ELSIE:CLASSIFICATION]]'
export const CLASSIFICATION_END = '[[/ELSIE:CLASSIFICATION]]'

/** Remove the classification block from a system prompt, return the rest. */
export function stripClassificationBlock(prompt: string | null | undefined): string {
  if (!prompt) return ''
  const start = prompt.indexOf(CLASSIFICATION_START)
  const end = prompt.indexOf(CLASSIFICATION_END)
  if (start === -1 || end === -1 || end < start) return prompt
  const before = prompt.slice(0, start)
  const after = prompt.slice(end + CLASSIFICATION_END.length)
  return (before + after).replace(/\n{3,}/g, '\n\n').trim()
}

/** Parse the classification block back into { preset, criteria }. */
function parseClassificationBlock(prompt: string | null | undefined): { preset: string; criteria: string; present: boolean } {
  if (!prompt) return { preset: 'general', criteria: '', present: false }
  const start = prompt.indexOf(CLASSIFICATION_START)
  const end = prompt.indexOf(CLASSIFICATION_END)
  if (start === -1 || end === -1 || end < start) return { preset: 'general', criteria: '', present: false }
  const inner = prompt.slice(start + CLASSIFICATION_START.length, end)
  const presetMatch = inner.match(/Preset:\s*(\w+)/)
  const criteriaMatch = inner.match(/Criteria:\s*([\s\S]*)$/)
  return {
    preset: presetMatch?.[1] ?? 'general',
    criteria: (criteriaMatch?.[1] ?? '').trim(),
    present: true,
  }
}

interface Preset {
  id: string
  label: string
  description: string
}

const PRESETS: Preset[] = [
  { id: 'sales', label: 'Sales Pipeline', description: 'Classify by purchase intent and readiness' },
  { id: 'support', label: 'Support Priority', description: 'Prioritise by issue urgency and value' },
  { id: 'booking', label: 'Booking Intent', description: 'Classify by appointment readiness' },
  { id: 'general', label: 'General', description: 'Balanced classification for any business' },
]

const savedBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60'

export default function ClassificationPage() {
  const { agent, businessId, loading, reload } = useDefaultAgent()
  const agentId = agent?.id

  const [enabled, setEnabled] = useState(true)
  const [preset, setPreset] = useState('general')
  const [criteria, setCriteria] = useState('')

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!agent) return
    const parsed = parseClassificationBlock(agent.ai_system_prompt)
    setEnabled(parsed.present)
    setPreset(parsed.preset)
    setCriteria(parsed.criteria)
  }, [agent])

  async function handleSave() {
    if (!businessId || !agentId) return
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      const base = stripClassificationBlock(agent?.ai_system_prompt)
      let nextPrompt = base
      if (enabled) {
        const block = [
          CLASSIFICATION_START,
          'Classify each lead as Hot, Warm, or Cold based on their messages.',
          `Preset: ${preset}`,
          criteria.trim() ? `Criteria: ${criteria.trim()}` : 'Criteria:',
          CLASSIFICATION_END,
        ].join('\n')
        nextPrompt = base ? `${base}\n\n${block}` : block
      }

      const { error: err } = await supabase
        .from('agents')
        .update({ ai_system_prompt: nextPrompt || null })
        .eq('id', agentId)
        .eq('business_id', businessId)
      if (err) throw err

      reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError('Failed to save classification settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={22} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  if (!agent) return <NoAgentEmptyState />

  return (
    <div className="space-y-6">
      <SectionCard>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-tight text-ink">AI Lead Classification</h3>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Automatically classify leads as Hot / Warm / Cold from their messages.
            </p>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label="Enable classification" />
        </div>

        <div className={cn('mt-6 space-y-6', !enabled && 'pointer-events-none opacity-50')}>
          <div>
            <Label>Classification presets</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {PRESETS.map((p) => {
                const selected = preset === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p.id)}
                    className={cn(
                      'relative rounded-xl border bg-surface p-4 text-left transition',
                      selected ? 'border-accent ring-2 ring-accent' : 'border-border hover:border-ink-subtle/50',
                    )}
                  >
                    {selected && (
                      <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                        <Check size={12} />
                      </span>
                    )}
                    <p className="text-[13.5px] font-semibold text-ink">{p.label}</p>
                    <p className="mt-0.5 text-[12px] text-ink-muted">{p.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <Label htmlFor="criteria">Custom criteria (optional)</Label>
            <Textarea
              id="criteria"
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              rows={4}
              placeholder='Add specific rules for your business. E.g. "Treat anyone asking about end-of-tenancy this week as Hot."'
            />
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              Elsie reads intent, not just exact words — keep these as plain guidance.
            </p>
          </div>
        </div>
      </SectionCard>

      {saveError && <p className="text-[13px] text-danger">{saveError}</p>}

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success">
            <Check size={14} /> Saved
          </span>
        )}
        <button type="button" onClick={handleSave} disabled={saving} className={savedBtn}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
