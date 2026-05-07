import { useState, useEffect } from 'react'
import { Globe, FileText, RefreshCw, CheckCircle2, Trash2, Loader2, AlertCircle } from 'lucide-react'
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
  updated_at: string
}

export default function TrainingSection() {
  const { session } = useAuth()
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  }

  async function fetchSources() {
    setFetchError(null)
    try {
      const res = await fetch('/api/training/sources', { headers })
      const data = await res.json()
      setSources(data.sources ?? [])
    } catch {
      setFetchError('Failed to load knowledge sources')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) fetchSources()
  }, [session])

  useEffect(() => {
    const hasProcessing = sources.some(s => s.status === 'processing')
    if (!hasProcessing) return
    const interval = setInterval(fetchSources, 5000)
    return () => clearInterval(interval)
  }, [sources])

  async function addWebsite() {
    if (!url.trim() || adding) return
    let normalized = url.trim()
    if (!normalized.startsWith('http')) normalized = 'https://' + normalized
    setAdding(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/training/scrape', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: normalized }),
      })
      if (res.ok) {
        setUrl('')
        await fetchSources()
      } else {
        setFetchError('Failed to add website')
      }
    } catch {
      setFetchError('Failed to add website')
    } finally {
      setAdding(false)
    }
  }

  async function deleteSource(id: string) {
    setDeleting(id)
    setFetchError(null)
    try {
      await fetch(`/api/training/sources?id=${id}`, { method: 'DELETE', headers })
      setSources(prev => prev.filter(s => s.id !== id))
    } catch {
      setFetchError('Failed to delete source')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Knowledge Sources</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Elsie learns from these sources to answer caller questions accurately.
            </p>
          </div>
          <button
            onClick={fetchSources}
            disabled={loading}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-ink-muted transition hover:bg-elevated disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {fetchError && (
          <p className="mt-3 text-[13px] text-danger">{fetchError}</p>
        )}

        <div className="mt-4 space-y-2">
          {loading ? (
            <div className="flex justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            </div>
          ) : sources.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">
              No knowledge sources yet. Add a website below.
            </p>
          ) : (
            sources.map((src) => (
              <div key={src.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated">
                  {src.type === 'website' ? (
                    <Globe size={16} className="text-brand" />
                  ) : (
                    <FileText size={16} className="text-brand" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">{src.name}</p>
                  <div className="flex items-center gap-2 text-[12px] text-ink-subtle">
                    {src.status === 'synced' && (
                      <>
                        <CheckCircle2 size={12} className="text-success" />
                        <span>Synced</span>
                      </>
                    )}
                    {src.status === 'processing' && (
                      <>
                        <Loader2 size={12} className="animate-spin text-brand" />
                        <span>Scraping & summarising...</span>
                      </>
                    )}
                    {src.status === 'failed' && (
                      <>
                        <AlertCircle size={12} className="text-danger" />
                        <span>Failed</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteSource(src.id)}
                  disabled={deleting === src.id}
                  className="text-ink-subtle hover:text-danger disabled:opacity-50"
                >
                  {deleting === src.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h3 className="text-[14px] font-medium text-ink">Add website</h3>
        <p className="mt-1 text-[13px] text-ink-muted">
          Elsie will scrape and learn from your website content.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addWebsite()}
            placeholder="https://yourbusiness.co.uk"
            className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
          />
          <button
            onClick={addWebsite}
            disabled={adding || !url.trim()}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white disabled:opacity-60"
          >
            {adding && <Loader2 size={14} className="animate-spin" />}
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
