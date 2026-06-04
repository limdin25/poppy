import { useState } from 'react'
import { Loader2, ChevronDown, ChevronUp, Check, Sparkles } from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { Textarea } from '@/core/ui/Input'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

/**
 * Editable view of the COMPLETE prompt sent to the voice engine. Loads the live
 * prompt (override if set, else the auto-assembled one) from sync-prompt preview.
 * Saving stores it as agents.full_prompt_override (used verbatim by Retell) and
 * pushes immediately. "Reset to auto-generated" clears the override so the
 * prompt rebuilds from greeting/services/FAQs again. Shared by AI Personality +
 * Call behaviour so the full prompt is editable from either place.
 */
export function FullPromptEditor({ agentId }: { agentId?: string }) {
  const { session, businessId } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [loaded, setLoaded] = useState('')
  const [isOverride, setIsOverride] = useState(false)
  const [tools, setTools] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!session) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/agent/sync-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ preview: true, agentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not load the prompt.'); return }
      setText(data.prompt || ''); setLoaded(data.prompt || '')
      setIsOverride(!!data.is_override); setTools(data.tools || []); setModel(data.model || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the prompt.')
    } finally { setLoading(false) }
  }

  function toggle() {
    const next = !open; setOpen(next)
    if (next && text === null) void load()
  }

  async function save() {
    if (!session || !businessId || !agentId || text === null) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const { error: dbErr } = await supabase
        .from('agents').update({ full_prompt_override: text }).eq('id', agentId).eq('business_id', businessId)
      if (dbErr) { setError('Could not save the prompt.'); return }
      const res = await fetch('/api/agent/sync-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ businessId, agentId }),
      })
      if (!res.ok) { setError('Saved, but could not sync to the call engine. It will sync shortly.'); return }
      setLoaded(text); setIsOverride(true); setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally { setSaving(false) }
  }

  async function resetToAuto() {
    if (!session || !businessId || !agentId) return
    setSaving(true); setError(null); setSaved(false)
    try {
      await supabase.from('agents').update({ full_prompt_override: null }).eq('id', agentId).eq('business_id', businessId)
      await fetch('/api/agent/sync-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ businessId, agentId }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset.')
    } finally { setSaving(false) }
  }

  const dirty = text !== null && text !== loaded

  return (
    <SectionCard eyebrow="Advanced" title="The full prompt (editable)">
      <p className="text-[13px] text-ink-muted">
        The complete prompt your platform sends to the voice engine. Edit it here and it pushes straight to Retell on save.
        While a custom prompt is saved it <strong>won't auto-update</strong> from your services/FAQs — use “Reset to auto-generated” to go back.
      </p>
      <button
        onClick={toggle}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {open ? 'Hide full prompt' : 'View / edit full prompt'}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', isOverride ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
              {isOverride ? 'Custom prompt' : 'Auto-generated'}
            </span>
            {model && <span className="rounded-full bg-elevated px-2 py-0.5 font-mono text-[11px] text-ink-muted">model: {model}</span>}
            {tools.map((t) => (
              <span key={t} className="rounded-full bg-elevated px-2 py-0.5 font-mono text-[11px] text-ink-muted">{t}</span>
            ))}
          </div>
          {text !== null && (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={18}
              className="font-mono text-[12px] leading-relaxed"
              spellCheck={false}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
              {saving ? 'Saving…' : saved ? 'Saved & synced' : 'Save prompt'}
            </button>
            {isOverride && (
              <button onClick={() => void resetToAuto()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-ink-muted transition hover:bg-elevated disabled:opacity-50">
                <Sparkles size={13} /> Reset to auto-generated
              </button>
            )}
            <button onClick={() => void load()} disabled={loading || saving} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-muted transition hover:text-ink">
              {loading ? <Loader2 size={12} className="animate-spin" /> : null} Reload
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
