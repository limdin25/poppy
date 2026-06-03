import { useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { usePipelineStages } from '@/core/hooks/usePipeline'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import type { Deal } from '@/core/types/database'

interface DealPrefill {
  contactId?: string | null
  conversationId?: string | null
  stageId?: string | null
  title?: string
}

interface DealModalProps {
  open: boolean
  onClose: () => void
  onSaved?: () => void
  /** Pass a deal to edit; omit to create. */
  deal?: Deal | null
  /** Defaults applied when creating (e.g. from a conversation). */
  prefill?: DealPrefill
}

const field =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20'

/** Create or edit a deal — title, description, value (deal size) and stage. */
export function DealModal({ open, onClose, onSaved, deal, prefill }: DealModalProps) {
  const { businessId } = useAuth()
  const { data: stages } = usePipelineStages()
  const editing = !!deal

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState('')
  const [stageId, setStageId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Initialise fields each time the modal opens (or the edited deal changes).
  useEffect(() => {
    if (!open) return
    setErr(null)
    setBusy(false)
    setTitle(deal?.title ?? prefill?.title ?? '')
    setDescription(deal?.description ?? '')
    setValue(deal && deal.value != null ? String(deal.value) : '')
    setStageId(deal?.stage_id ?? prefill?.stageId ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id])

  const effectiveStage = stageId || stages[0]?.id || ''

  async function save() {
    const t = title.trim()
    if (!t) { setErr('Give the deal a title.'); return }
    const cleaned = value.trim().replace(/[^0-9.]/g, '')
    const numValue = cleaned ? Number(cleaned) : 0
    if (cleaned && Number.isNaN(numValue)) { setErr('Value must be a number.'); return }
    setBusy(true)
    setErr(null)

    if (editing && deal) {
      const { error } = await supabase
        .from('deals')
        .update({
          title: t,
          description: description.trim() || null,
          value: numValue,
          stage_id: effectiveStage || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', deal.id)
      if (error) { setErr(error.message); setBusy(false); return }
    } else {
      if (!businessId) { setErr('No business found.'); setBusy(false); return }
      const { error } = await supabase.from('deals').insert({
        business_id: businessId,
        title: t,
        description: description.trim() || null,
        value: numValue,
        currency: 'GBP',
        stage_id: effectiveStage || null,
        contact_id: prefill?.contactId ?? null,
        conversation_id: prefill?.conversationId ?? null,
      } as never)
      if (error) { setErr(error.message); setBusy(false); return }
    }

    setBusy(false)
    onClose()
    onSaved?.()
  }

  async function remove() {
    if (!deal) return
    if (!window.confirm('Delete this deal? This cannot be undone.')) return
    setBusy(true)
    const { error } = await supabase.from('deals').delete().eq('id', deal.id)
    setBusy(false)
    if (error) { setErr(error.message); return }
    onClose()
    onSaved?.()
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} width="sm">
      <DialogHeader>{editing ? 'Edit deal' : 'New deal'}</DialogHeader>
      <DialogBody className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-ink-muted">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kitchen refit — Smith" className={field} autoFocus />
        </div>
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-ink-muted">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What's the job / notes…" className={field} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Value (deal size)</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-subtle">£</span>
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0" className={field + ' pl-6'} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Stage</label>
            <select value={effectiveStage} onChange={(e) => setStageId(e.target.value)} className={field}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        {err && <p className="text-[12.5px] text-red-600">{err}</p>}
      </DialogBody>
      <DialogFooter>
        {editing ? (
          <button onClick={() => void remove()} disabled={busy} className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">
            <Trash2 size={14} /> Delete
          </button>
        ) : null}
        <button onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-muted hover:bg-elevated disabled:opacity-40">Cancel</button>
        <button onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />}{busy ? 'Saving…' : editing ? 'Save deal' : 'Add deal'}
        </button>
      </DialogFooter>
    </Dialog>
  )
}
