import { useState } from 'react'
import { Plus, Pencil, Trash2, Loader2, Repeat, Clock } from 'lucide-react'
import { Input, Label } from '@/core/ui/Input'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { Button } from '@/core/ui/Button'
import { useFollowupSequences, type FollowupStep, type FollowupSequence } from '@/core/hooks/useFollowupSequences'

/**
 * Follow-up templates — edit the named "types" of auto follow-up (e.g. Gentle
 * nudge / Value reminder / Last chance). Each is a sequence of timed messages.
 * The inbox lets you pick one per chat; the cron sends them.
 */

const HOUR_OPTS: { label: string; hours: number }[] = [
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '1 day', hours: 24 },
  { label: '2 days', hours: 48 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
  { label: '2 weeks', hours: 336 },
  { label: '1 month', hours: 720 },
]
function hoursLabel(h: number): string {
  return HOUR_OPTS.find((o) => o.hours === h)?.label ?? `${h}h`
}

type Draft = { id: string | null; name: string; steps: FollowupStep[] }

export function FollowupTemplates() {
  const { data: sequences, loading, create, update, remove } = useFollowupSequences()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  function openNew() {
    setDraft({ id: null, name: '', steps: [{ after_hours: 24, message: 'Hi {name}, just following up — still happy to help whenever you are.' }] })
  }
  function openEdit(s: FollowupSequence) {
    setDraft({ id: s.id, name: s.name, steps: s.steps.length ? s.steps : [{ after_hours: 24, message: '' }] })
  }
  async function handleDelete(id: string) {
    if (!window.confirm('Delete this follow-up type? This cannot be undone.')) return
    await remove(id)
  }
  async function save() {
    if (!draft || saving) return
    const name = draft.name.trim()
    const steps = draft.steps.map((s) => ({ after_hours: s.after_hours, message: s.message.trim() })).filter((s) => s.message)
    if (!name || !steps.length) return
    setSaving(true)
    if (draft.id) await update(draft.id, name, steps)
    else await create(name, steps)
    setSaving(false)
    setDraft(null)
  }

  function setStep(i: number, patch: Partial<FollowupStep>) {
    setDraft((d) => (d ? { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d))
  }
  function addStep() {
    setDraft((d) => (d ? { ...d, steps: [...d.steps, { after_hours: 72, message: '' }] } : d))
  }
  function removeStep(i: number) {
    setDraft((d) => (d ? { ...d, steps: d.steps.filter((_, j) => j !== i) } : d))
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[12.5px] text-ink-muted">Named follow-up types Elsie can run on a chat — each is a series of timed nudges.</p>
        <button onClick={openNew} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90">
          <Plus size={15} /> New follow-up
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-ink-muted" /></div>
      ) : sequences.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-ink-subtle"><Repeat size={22} /></div>
          <h3 className="text-[14px] font-semibold text-ink">No follow-up types yet</h3>
          <p className="mt-1 max-w-xs text-[12.5px] text-ink-muted">Create one, or let Elsie make 3 for you from your Knowledge Base.</p>
          <button onClick={openNew} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90">
            <Plus size={15} /> New follow-up
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sequences.map((s) => (
            <div key={s.id} className="group relative flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-soft transition hover:shadow-card">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-[14px] font-semibold tracking-tight text-ink"><Repeat size={14} className="text-accent" /> {s.name}</h3>
                <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => openEdit(s)} className="rounded-md p-1.5 text-ink-subtle transition hover:bg-elevated hover:text-ink" title="Edit"><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(s.id)} className="rounded-md p-1.5 text-ink-subtle transition hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
              <ul className="space-y-1.5">
                {s.steps.map((st, i) => (
                  <li key={i} className="rounded-lg bg-page px-2.5 py-1.5">
                    <p className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-subtle"><Clock size={11} /> after {hoursLabel(st.after_hours)}</p>
                    <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{st.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onClose={() => setDraft(null)} width="md">
        <DialogHeader>{draft?.id ? 'Edit follow-up type' : 'New follow-up type'}</DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <Label htmlFor="seq-name">Name</Label>
            <Input id="seq-name" value={draft?.name ?? ''} onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))} placeholder="e.g. Gentle nudge" autoFocus />
          </div>
          <div className="space-y-2.5">
            <Label>Messages</Label>
            {draft?.steps.map((st, i) => (
              <div key={i} className="rounded-xl border border-border bg-page/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                    <Clock size={12} /> Send after
                    <select
                      value={st.after_hours}
                      onChange={(e) => setStep(i, { after_hours: Number(e.target.value) })}
                      className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
                    >
                      {HOUR_OPTS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
                    </select>
                  </div>
                  {draft.steps.length > 1 && (
                    <button onClick={() => removeStep(i)} className="rounded-md p-1 text-ink-subtle hover:bg-red-50 hover:text-red-600" title="Remove message"><Trash2 size={13} /></button>
                  )}
                </div>
                <textarea
                  value={st.message}
                  onChange={(e) => setStep(i, { message: e.target.value })}
                  rows={2}
                  placeholder="Message — use {name} for the customer's name"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>
            ))}
            <button onClick={addStep} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px] font-medium text-ink-muted transition hover:border-ink-subtle hover:text-ink">
              <Plus size={14} /> Add another message
            </button>
            <p className="text-[11px] text-ink-subtle">Tip: type <span className="font-medium text-ink-muted">{'{name}'}</span> and Elsie fills in the customer's name.</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !draft?.name.trim() || !draft?.steps.some((s) => s.message.trim())}>
            {saving && <Loader2 size={15} className="mr-1.5 animate-spin" />}
            {draft?.id ? 'Save changes' : 'Save follow-up'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
