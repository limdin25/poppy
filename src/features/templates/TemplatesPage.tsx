import { useState, type ReactNode } from 'react'
import { Plus, Pencil, Trash2, Loader2, MessageSquareText } from 'lucide-react'
import { PageHeader } from '@/core/ui/PageHeader'
import { Input, Textarea, Label } from '@/core/ui/Input'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { Button } from '@/core/ui/Button'
import { useQuickReplies, type QuickReply } from '@/core/hooks/useQuickReplies'
import { FollowupTemplates } from './FollowupTemplates'
import { cn } from '@/core/lib/cn'

/**
 * Templates / Quick Replies. Persists to public.quick_replies (business-scoped
 * RLS) via the shared useQuickReplies hook — the same store the Inbox composer
 * picker reads/writes. Keep the {name} token + card-grid look.
 */

type Draft = { id: string | null; title: string; body: string }
const EMPTY: Draft = { id: null, title: '', body: '' }

export default function TemplatesPage() {
  const { data: templates, loading, create, update, remove } = useQuickReplies()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'replies' | 'followups'>('replies')

  function openNew() {
    setDraft({ ...EMPTY })
  }
  function openEdit(t: QuickReply) {
    setDraft({ id: t.id, title: t.title, body: t.body })
  }
  async function handleDelete(id: string) {
    if (!window.confirm('Delete this template? This cannot be undone.')) return
    await remove(id)
  }
  async function save() {
    if (!draft || saving) return
    const title = draft.title.trim()
    const body = draft.body.trim()
    if (!title || !body) return
    setSaving(true)
    if (draft.id) {
      await update(draft.id, title, body)
    } else {
      await create(title, body)
    }
    setSaving(false)
    setDraft(null)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI"
        title="Templates"
        description="Quick replies you drop into a chat, and the auto follow-up types Elsie can run."
        actions={
          tab === 'replies' ? (
            <button
              onClick={openNew}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
            >
              <Plus size={15} /> New template
            </button>
          ) : null
        }
      />

      <div className="flex w-fit rounded-lg border border-border bg-surface p-0.5">
        {([['replies', 'Quick replies'], ['followups', 'Follow-ups']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn('rounded-md px-3.5 py-1.5 text-[12.5px] font-medium transition', tab === k ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'followups' ? (
        <FollowupTemplates />
      ) : (
      <>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-ink-muted" />
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-ink-subtle">
            <MessageSquareText size={22} />
          </div>
          <h3 className="text-[14px] font-semibold text-ink">No templates yet</h3>
          <p className="mt-1 max-w-xs text-[12.5px] text-ink-muted">
            Save replies you and Elsie can drop into any chat in one tap.
          </p>
          <button
            onClick={openNew}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
          >
            <Plus size={15} /> New template
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="group relative flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-soft transition hover:shadow-card"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="text-[14px] font-semibold tracking-tight text-ink">{t.title}</h3>
                <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => openEdit(t)}
                    className="rounded-md p-1.5 text-ink-subtle transition hover:bg-elevated hover:text-ink"
                    title="Edit"
                    aria-label={`Edit ${t.title}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="rounded-md p-1.5 text-ink-subtle transition hover:bg-red-50 hover:text-red-600"
                    title="Delete"
                    aria-label={`Delete ${t.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">{highlightTokens(t.body)}</p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onClose={() => setDraft(null)} width="md">
        <DialogHeader>{draft?.id ? 'Edit template' : 'New template'}</DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <Label htmlFor="tpl-title">Title</Label>
            <Input
              id="tpl-title"
              value={draft?.title ?? ''}
              onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
              placeholder="e.g. Opening hours"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="tpl-body">Message</Label>
            <Textarea
              id="tpl-body"
              value={draft?.body ?? ''}
              onChange={(e) => setDraft((d) => (d ? { ...d, body: e.target.value } : d))}
              rows={5}
              placeholder="Type the reply. Use {name} to drop in the customer's name."
            />
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              Tip: type <span className="font-medium text-ink-muted">{'{name}'}</span> and Elsie
              fills in the customer's name automatically.
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !draft?.title.trim() || !draft?.body.trim()}
          >
            {saving && <Loader2 size={15} className="mr-1.5 animate-spin" />}
            {draft?.id ? 'Save changes' : 'Save template'}
          </Button>
        </DialogFooter>
      </Dialog>
      </>
      )}
    </div>
  )
}

/** Render a body string with {token} segments subtly highlighted. */
function highlightTokens(body: string): ReactNode {
  const parts = body.split(/(\{[a-zA-Z0-9_]+\})/g)
  return parts.map((part, i) =>
    /^\{[a-zA-Z0-9_]+\}$/.test(part) ? (
      <span
        key={i}
        className="rounded bg-elevated px-1 py-0.5 font-medium text-ink"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}
