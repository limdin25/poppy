import { useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { Input, Textarea, Label } from '@/core/ui/Input'
import { Switch } from '@/core/ui/Switch'
import { cn } from '@/core/lib/cn'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useDefaultAgent } from '../hooks/useDefaultAgent'
import { NoAgentEmptyState } from './AiPersonalityPage'

/**
 * Human Handoff — fully wired to the default agent's real columns:
 *   - draft_mode, takeover_delay_seconds (timing)
 *   - handoff_enabled, handoff_keywords (text[]), handoff_message
 * When enabled, an inbound message matching a keyword flags the conversation as
 * needs_handoff, pauses the AI, and notifies the owner (see queue-takeover).
 * Owner-alert channels are configured in Settings → Notifications.
 */

const savedBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60'

const DELAY_OPTIONS = [
  { value: 0, label: 'Immediately' },
  { value: 300, label: 'After 5 minutes' },
  { value: 900, label: 'After 15 minutes' },
  { value: 1800, label: 'After 30 minutes' },
  { value: 3600, label: 'After 1 hour' },
]

export default function HandoffPage() {
  const { agent, businessId, loading, reload } = useDefaultAgent()
  const agentId = agent?.id

  // Real, persisted
  const [draftMode, setDraftMode] = useState(false)
  const [takeoverDelay, setTakeoverDelay] = useState(1200)

  // Handoff detection — persisted to agents.handoff_*
  const [enabled, setEnabled] = useState(false)
  const [keywords, setKeywords] = useState('complaint, refund, speak to a human, manager')
  const [message, setMessage] = useState("I'll connect you with a team member shortly — thanks for your patience.")

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!agent) return
    setDraftMode(agent.draft_mode ?? false)
    setTakeoverDelay(agent.takeover_delay_seconds ?? 1200)
    setEnabled(agent.handoff_enabled ?? false)
    if (Array.isArray(agent.handoff_keywords) && agent.handoff_keywords.length) {
      setKeywords(agent.handoff_keywords.join(', '))
    }
    if (agent.handoff_message) setMessage(agent.handoff_message)
  }, [agent])

  async function handleSave() {
    if (!businessId || !agentId) return
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      const keywordArr = keywords.split(',').map((k) => k.trim()).filter(Boolean)
      const { error: err } = await supabase
        .from('agents')
        .update({
          draft_mode: draftMode,
          takeover_delay_seconds: takeoverDelay,
          handoff_enabled: enabled,
          handoff_keywords: keywordArr,
          handoff_message: message.trim() || null,
        })
        .eq('id', agentId)
        .eq('business_id', businessId)
      if (err) throw err

      // Keep this agent's channels in sync with draft mode
      await supabase
        .from('channels')
        .update({ draft_mode: draftMode })
        .eq('agent_id', agentId)
        .eq('business_id', businessId)

      reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError('Failed to save handoff settings. Please try again.')
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
      {/* Real: timing + draft mode */}
      <SectionCard eyebrow="When Elsie steps back" title="Hand control to you">
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-ink">Wait for you before Elsie replies</p>
              <p className="text-[12.5px] text-ink-muted">
                If you jump into a chat, Elsie holds off so you can take over.
              </p>
            </div>
            <Switch checked={draftMode} onChange={setDraftMode} label="Approve before sending" />
          </div>

          <div className="border-t border-border pt-5">
            <Label htmlFor="takeover">Hand off to me after</Label>
            <select
              id="takeover"
              value={takeoverDelay}
              onChange={(e) => setTakeoverDelay(Number(e.target.value))}
              className="h-10 w-full rounded-[12px] border border-border bg-surface px-3 text-sm text-ink sm:w-72"
            >
              {DELAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {!DELAY_OPTIONS.some((o) => o.value === takeoverDelay) && (
                <option value={takeoverDelay}>{`After ${Math.round(takeoverDelay / 60)} minutes`}</option>
              )}
            </select>
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              How long Elsie waits for you to reply before she steps in (or steps back).
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Local-only: keyword + notify rules */}
      <SectionCard>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-tight text-ink">Escalation triggers</h3>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Hand a conversation to you when certain words come up.
            </p>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label="Enable handoff detection" />
        </div>

        <div className={cn('mt-6 space-y-5', !enabled && 'pointer-events-none opacity-50')}>
          <div>
            <Label htmlFor="keywords">Handoff keywords</Label>
            <Input
              id="keywords"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="complaint, refund, speak to a human, manager"
            />
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              Comma-separated — if a customer says any of these, Elsie hands off.
            </p>
          </div>

          <div>
            <Label htmlFor="handoff-message">Handoff message to customer</Label>
            <Textarea
              id="handoff-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="I'll connect you with a team member shortly…"
            />
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              Sent automatically the moment a conversation is handed over.
            </p>
          </div>

          <p className="text-[11px] text-ink-subtle">
            Where you receive handoff alerts (email / WhatsApp) is set in
            {' '}<a href="/account/notifications" className="font-medium text-brand hover:underline">Settings → Notifications</a>.
          </p>
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
          {saving ? 'Saving…' : 'Save handoff settings'}
        </button>
      </div>
    </div>
  )
}
