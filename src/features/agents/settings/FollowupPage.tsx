import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, Check } from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { Input, Textarea, Label } from '@/core/ui/Input'
import { Switch } from '@/core/ui/Switch'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useDefaultAgent } from '../hooks/useDefaultAgent'
import { NoAgentEmptyState } from './AiPersonalityPage'

/**
 * Automatic Follow-up — a real multi-step sequence editor. Each step has its own
 * message template and a "send after N days" delay ("if no response, follow up
 * after X days, then…"). Saved to the business's `followup_sequences.steps`
 * (the same sequence the Inbox follow-ups panel + /api/cron/followups use), and
 * mirrored to the agent's follow_up_* columns for the auto-enqueue cron.
 */

interface Step {
  id: string
  day: number
  message: string
}

const savedBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60'
const DAY_SECONDS = 86400

const DEFAULT_STEPS: Step[] = [
  { id: 's-0', day: 1, message: "Hi {name}, just following up on our chat — anything I can help with, or would you like to book a time?" },
  { id: 's-1', day: 3, message: "Hi {name}, checking back in. Happy to answer any questions or get you booked in whenever you're ready." },
]

export default function FollowupPage() {
  const { agent, businessId, loading, reload } = useDefaultAgent()
  const agentId = agent?.id

  const [enabled, setEnabled] = useState(false)
  const [steps, setSteps] = useState<Step[]>(DEFAULT_STEPS)
  const [maxAttempts, setMaxAttempts] = useState(2)
  const [seqId, setSeqId] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!agent) return
    setEnabled(agent.follow_up_enabled ?? false)
    setMaxAttempts(agent.follow_up_max_attempts ?? 2)
  }, [agent])

  // Load the business's follow-up sequence (source of truth for steps + messages).
  useEffect(() => {
    if (!businessId) return
    supabase
      .from('followup_sequences')
      .select('id, steps')
      .eq('business_id', businessId)
      .order('created_at')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setSeqId(data.id)
        const raw = (data.steps as Array<{ after_hours?: number; message?: string }>) || []
        if (raw.length) {
          setSteps(raw.map((s, i) => ({
            id: `s-${i}`,
            day: Math.max(1, Math.round((s.after_hours ?? 24) / 24)),
            message: s.message || '',
          })))
        }
      })
  }, [businessId])

  function updateStep(id: string, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }
  function removeStep(id: string) {
    setSteps((prev) => prev.filter((s) => s.id !== id))
  }
  function addStep() {
    const lastDay = steps.length ? Math.max(...steps.map((s) => s.day)) : 0
    setSteps((prev) => [...prev, { id: crypto.randomUUID(), day: lastDay + 3, message: '' }])
  }

  async function handleSave() {
    if (!businessId || !agentId) return
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      const sorted = [...steps].sort((a, b) => a.day - b.day).filter((s) => s.message.trim())
      const seqSteps = sorted.map((s) => ({ after_hours: s.day * 24, message: s.message.trim() }))

      // Save the sequence (create if missing)
      if (seqId) {
        await supabase.from('followup_sequences').update({ steps: seqSteps }).eq('id', seqId)
      } else {
        const { data } = await supabase
          .from('followup_sequences')
          .insert({ business_id: businessId, name: 'Default re-engagement', steps: seqSteps })
          .select('id')
          .single()
        if (data) setSeqId(data.id)
      }

      // Mirror to the agent for the auto-enqueue cron
      await supabase
        .from('agents')
        .update({
          follow_up_enabled: enabled,
          follow_up_delay_hours: sorted.map((s) => s.day * DAY_SECONDS),
          follow_up_prompt: sorted[0]?.message || null,
          follow_up_max_attempts: Math.max(1, maxAttempts),
        })
        .eq('id', agentId)
        .eq('business_id', businessId)

      await supabase
        .from('follow_up_settings')
        .upsert({ business_id: businessId, enabled, max_attempts: Math.max(1, maxAttempts), delay_hours: sorted.map((s) => s.day * DAY_SECONDS) }, { onConflict: 'business_id' })

      reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError('Failed to save follow-up sequence. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={22} className="animate-spin text-ink-muted" /></div>
  }
  if (!agent) return <NoAgentEmptyState />

  return (
    <div className="space-y-6">
      <SectionCard>
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">Automatic follow-up</h3>
          <p className="mt-0.5 text-[13px] text-ink-muted">Re-engage leads who go quiet — write each message and how long to wait if they don't reply.</p>
        </div>
        <div className="mt-5 flex items-start justify-between gap-4 border-t border-border pt-5">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-ink">Enable auto follow-up</p>
            <p className="text-[12.5px] text-ink-muted">Elsie sends the sequence below to leads who haven't replied.</p>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label="Enable auto follow-up" />
        </div>
      </SectionCard>

      <div className={enabled ? 'space-y-5' : 'space-y-5 pointer-events-none opacity-50'}>
        <SectionCard eyebrow="Sequence" title="Follow-up messages">
          <div className="space-y-4">
            {[...steps].sort((a, b) => a.day - b.day).map((step, i) => (
              <div key={step.id} className="rounded-xl border border-border bg-elevated/30 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                    Step {i + 1}
                  </span>
                  {steps.length > 1 && (
                    <button type="button" onClick={() => removeStep(step.id)} className="rounded-md p-1 text-ink-subtle transition hover:bg-red-50 hover:text-red-600" aria-label="Remove step">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <Textarea
                  value={step.message}
                  onChange={(e) => updateStep(step.id, { message: e.target.value })}
                  rows={2}
                  placeholder="Message Elsie sends at this step. Use {name} for the customer's name."
                />
                <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-muted">
                  <span>If no reply, send</span>
                  <Input
                    type="number"
                    min={1}
                    value={step.day}
                    onChange={(e) => updateStep(step.id, { day: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="h-9 w-20 text-center text-[13px]"
                  />
                  <span>day(s){i === 0 ? ' after the conversation goes quiet' : ' after the previous step'}.</span>
                </div>
              </div>
            ))}
            <button type="button" onClick={addStep} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[13px] font-medium text-ink-muted transition hover:border-ink-subtle/50 hover:text-ink">
              <Plus size={15} /> Add another follow-up
            </button>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Rules" title="Guardrails">
          <div className="sm:max-w-xs">
            <Label htmlFor="fu-max">Max follow-ups per lead</Label>
            <Input id="fu-max" type="number" min={1} value={maxAttempts} onChange={(e) => setMaxAttempts(Math.max(1, parseInt(e.target.value) || 1))} />
            <p className="mt-1.5 text-[11px] text-ink-subtle">Elsie stops nudging a lead after this many attempts.</p>
          </div>
        </SectionCard>
      </div>

      {saveError && <p className="text-[13px] text-danger">{saveError}</p>}

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success"><Check size={14} /> Saved</span>}
        <button type="button" onClick={handleSave} disabled={saving} className={savedBtn}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save follow-up sequence'}
        </button>
      </div>
    </div>
  )
}
