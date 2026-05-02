import { useState } from 'react'
import { Globe, FileText, RefreshCw, CheckCircle2, Upload, Trash2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface Document {
  id: string
  name: string
  type: 'website' | 'document'
  status: 'synced' | 'processing'
  lastSync: string
}

const INITIAL_DOCS: Document[] = [
  { id: '1', name: 'smithplumbing.co.uk', type: 'website', status: 'synced', lastSync: '2 hours ago' },
  { id: '2', name: 'Google Business Profile', type: 'website', status: 'synced', lastSync: '2 hours ago' },
  { id: '3', name: 'Price List 2024.pdf', type: 'document', status: 'synced', lastSync: '3 days ago' },
]

export default function TrainingSection() {
  const [docs] = useState(INITIAL_DOCS)
  const [syncing, setSyncing] = useState(false)

  function rescan() {
    setSyncing(true)
    setTimeout(() => setSyncing(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Website sources */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Knowledge Sources</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Poppy learns from these sources to answer caller questions accurately.
            </p>
          </div>
          <button
            onClick={rescan}
            disabled={syncing}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-ink-muted transition hover:bg-elevated disabled:opacity-50"
          >
            <RefreshCw size={14} className={cn(syncing && 'animate-spin')} />
            {syncing ? 'Syncing...' : 'Rescan all'}
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated">
                {doc.type === 'website' ? (
                  <Globe size={16} className="text-brand" />
                ) : (
                  <FileText size={16} className="text-brand" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink">{doc.name}</p>
                <div className="flex items-center gap-2 text-[12px] text-ink-subtle">
                  <CheckCircle2 size={12} className="text-success" />
                  <span>Synced {doc.lastSync}</span>
                </div>
              </div>
              <button className="text-ink-subtle hover:text-danger">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Add website */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h3 className="text-[14px] font-medium text-ink">Add website</h3>
        <p className="mt-1 text-[13px] text-ink-muted">
          Add another website for Poppy to learn from.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="url"
            placeholder="https://example.com"
            className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
          />
          <button className="h-10 rounded-lg bg-brand px-4 text-[13px] font-medium text-white">
            Add
          </button>
        </div>
      </div>

      {/* Upload document */}
      <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center shadow-soft">
        <Upload size={24} className="mx-auto text-ink-subtle" />
        <p className="mt-3 text-[14px] font-medium text-ink">Upload documents</p>
        <p className="mt-1 text-[13px] text-ink-muted">
          PDF, Word, or text files. Poppy will learn from the content.
        </p>
        <button className="mt-4 h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-muted transition hover:bg-elevated">
          Choose files
        </button>
      </div>
    </div>
  )
}
