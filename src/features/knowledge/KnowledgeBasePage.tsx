import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Globe, FileText, Plus, Trash2, Loader2, X, CheckCircle2, AlertTriangle, Clock } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'

interface Source {
  id: string
  name: string
  type: 'website' | 'document'
  url: string | null
  status: 'processing' | 'synced' | 'failed'
  summary: string | null
  created_at: string
}

const STATUS: Record<string, { label: string; chip: string; icon: typeof Clock }> = {
  processing: { label: 'Processing', chip: 'bg-amber-50 text-amber-600', icon: Clock },
  synced: { label: 'Synced', chip: 'bg-emerald-50 text-emerald-600', icon: CheckCircle2 },
  failed: { label: 'Failed', chip: 'bg-red-50 text-red-600', icon: AlertTriangle },
}

export default function KnowledgeBasePage() {
  const { session } = useAuth()
  const token = session?.access_token
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/training/sources', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setSources(data.sources || [])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  async function remove(id: string) {
    if (!token || !window.confirm('Remove this knowledge source?')) return
    setDeleting(id)
    try {
      await fetch(`/api/training/sources?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      await load()
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Knowledge Base</h1>
          <p className="mt-1 text-[13px] text-ink-muted">Everything Elsie knows about your business — websites and notes she answers from.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white transition hover:bg-brand-600"
        >
          <Plus size={14} />
          Add source
        </button>
      </div>

      <div className="mt-5 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-ink-muted" /></div>
        ) : sources.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <BookOpen size={28} className="mx-auto text-ink-subtle" />
            <p className="mt-3 text-[14px] font-medium text-ink">Nothing here yet</p>
            <p className="mt-1 text-[13px] text-ink-muted">Add your website or paste some notes so Elsie can answer accurately.</p>
          </div>
        ) : (
          sources.map((s) => {
            const st = STATUS[s.status] || STATUS.processing
            const Icon = st.icon
            const TypeIcon = s.type === 'website' ? Globe : FileText
            return (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-soft">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-elevated">
                  <TypeIcon size={18} className="text-ink-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-medium text-ink">{s.name}</p>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', st.chip)}>
                      <Icon size={11} />{st.label}
                    </span>
                  </div>
                  <p className="truncate text-[12px] text-ink-muted">{s.url || s.summary || (s.type === 'document' ? 'Pasted notes' : '—')}</p>
                </div>
                <button
                  onClick={() => remove(s.id)}
                  disabled={deleting === s.id}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-red-50 hover:text-red-600"
                  title="Remove"
                >
                  {deleting === s.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            )
          })
        )}
      </div>

      {showAdd && <AddSourceModal token={token} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load() }} />}
    </div>
  )
}

function AddSourceModal({ token, onClose, onAdded }: { token?: string; onClose: () => void; onAdded: () => void }) {
  const [tab, setTab] = useState<'website' | 'text'>('website')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setErr('')
    setSubmitting(true)
    try {
      const body = tab === 'website' ? { url } : { text }
      const res = await fetch('/api/training/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) { setErr(data.error); return }
      onAdded()
    } catch (ex: any) {
      setErr(ex.message || 'Failed to add source')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Add knowledge source</h2>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink"><X size={16} /></button>
        </div>

        <div className="mt-4 flex rounded-lg border border-border bg-elevated p-0.5">
          {(['website', 'text'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn('flex-1 rounded-md py-1.5 text-[12px] font-medium capitalize transition', tab === t ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}
            >
              {t === 'website' ? 'Website' : 'Paste text'}
            </button>
          ))}
        </div>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>}

        <form onSubmit={submit} className="mt-4 space-y-3">
          {tab === 'website' ? (
            <div>
              <label className="block text-[12px] font-medium text-ink-muted">Website URL</label>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourbusiness.co.uk"
                className="mt-1 h-9 w-full rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <p className="mt-1 text-[11px] text-ink-subtle">Elsie will read the page and learn from it.</p>
            </div>
          ) : (
            <div>
              <label className="block text-[12px] font-medium text-ink-muted">Notes</label>
              <textarea
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder="Opening hours, prices, policies, anything Elsie should know…"
                className="mt-1 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand py-2 text-[13px] font-medium text-white hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Adding…' : 'Add source'}
          </button>
        </form>
      </div>
    </div>
  )
}
