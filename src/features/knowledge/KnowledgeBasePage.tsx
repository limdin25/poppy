import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, Globe, FileText, Plus, Trash2, Loader2, X, Search, UploadCloud, MapPin } from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { StatusPill, type PillTone } from '@/core/ui/StatusPill'
import { useAuth } from '@/core/auth/AuthProvider'
import { cn } from '@/core/lib/cn'
import { extractTextFromFile } from '@/core/lib/extractText'

/**
 * Knowledge Base — wired to the real backend (waslo-faithful look).
 *   list   → GET  /api/training/sources
 *   add    → POST /api/training/scrape   ({ url } website | { text } notes)
 *   delete → DELETE /api/training/sources?id=
 * Test mode does a live keyword match over the business's real sources (there is
 * no server-side retrieval endpoint yet, so this previews which sources match).
 */

interface Source {
  id: string
  name: string
  type: 'website' | 'document'
  url: string | null
  status: 'processing' | 'synced' | 'failed'
  summary: string | null
  created_at: string
}

const STATUS_PILL: Record<Source['status'], { label: string; tone: PillTone }> = {
  synced: { label: 'Synced', tone: 'success' },
  processing: { label: 'Processing', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
}

function timeAgo(iso: string): string {
  const d = Date.parse(iso)
  if (Number.isNaN(d)) return ''
  const days = Math.floor((Date.now() - d) / 86_400_000)
  if (days <= 0) return 'Added today'
  if (days === 1) return 'Added yesterday'
  if (days < 7) return `Added ${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `Added ${weeks} week${weeks > 1 ? 's' : ''} ago`
  return `Added ${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''} ago`
}

const headerBtnOutline =
  'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2.5 text-[13px] font-medium text-ink transition hover:bg-elevated'
const headerBtnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90'

/** Dark rounded icon tile with a brand-green glyph (waslo card-header motif). */
function IconTile({ children, size = 'md' }: { children: ReactNode; size?: 'md' | 'lg' }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-2xl bg-accent text-whatsapp',
        size === 'lg' ? 'h-12 w-12' : 'h-11 w-11',
      )}
    >
      {children}
    </div>
  )
}

export default function KnowledgeBasePage() {
  const { session } = useAuth()
  const token = session?.access_token

  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [addMode, setAddMode] = useState<false | 'website' | 'text'>(false)

  // Test mode (client-side match over real sources)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Source[] | null>(null)

  // File upload
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/training/sources', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      setSources(Array.isArray(data.sources) ? data.sources : [])
    } catch {
      /* leave list as-is on error */
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  async function remove(id: string) {
    if (!token || !window.confirm('Remove this knowledge source? Elsie will stop answering from it.')) return
    setDeleting(id)
    try {
      await fetch(`/api/training/sources?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      await load()
    } finally {
      setDeleting(null)
    }
  }

  async function onUploadFile(input: HTMLInputElement) {
    const file = input.files?.[0]
    input.value = ''
    if (!file || !token) return
    setUploadErr(null)
    if (file.size > 10 * 1024 * 1024) { setUploadErr('That file is over 10 MB.'); return }
    setUploading(true)
    try {
      const text = await extractTextFromFile(file)
      if (!text.trim()) { setUploadErr('No readable text found in that file.'); return }
      const res = await fetch('/api/kb/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: file.name, text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setUploadErr(data.error || 'Upload failed.'); return }
      await load()
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setUploading(false)
    }
  }

  function runTest(e: React.FormEvent) {
    e.preventDefault()
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    if (!words.length) {
      setResults([])
      return
    }
    const matches = sources.filter((s) => {
      const hay = `${s.name} ${s.summary ?? ''} ${s.url ?? ''}`.toLowerCase()
      return words.some((w) => hay.includes(w))
    })
    setResults(matches)
  }

  return (
    <div className="space-y-6">
      {/* Header — compact icon + title + subtitle (waslo motif) */}
      <div className="flex items-start gap-4">
        <IconTile size="lg">
          <BookOpen size={22} />
        </IconTile>
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Knowledge Base</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-ink-muted">
            Upload your website or notes — Elsie answers from your actual content.
          </p>
        </div>
      </div>

      {/* Intro card — add a website or paste notes */}
      <SectionCard bodyClassName="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <IconTile>
              <BookOpen size={20} />
            </IconTile>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold tracking-tight text-ink">Knowledge base</h2>
              <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
                Add your website or paste in prices, policies and service notes. Elsie reads it,
                splits it into searchable chunks, and replies from your real content — never a
                generic template.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <button className={headerBtnPrimary} onClick={() => setAddMode('website')}>
              <Globe size={15} /> Add website
            </button>
            <button className={headerBtnOutline} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
              {uploading ? 'Reading…' : 'Upload file'}
            </button>
            <button className={headerBtnOutline} onClick={() => setAddMode('text')}>
              <Plus size={15} /> Paste notes
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.json,.log,text/*,application/pdf"
              className="hidden"
              onChange={(e) => void onUploadFile(e.currentTarget)}
            />
          </div>
        </div>
        {uploadErr && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{uploadErr}</p>
        )}
      </SectionCard>

      {/* Import from Google — business lookup via Places (one of our differentiators) */}
      <GoogleBusinessImport token={token} onImported={load} />

      {/* Documents card — real sources */}
      <SectionCard bodyClassName="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-ink-muted" />
          </div>
        ) : sources.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <FileText size={30} className="mx-auto text-ink-subtle" />
            <p className="mt-3 text-[14px] font-medium text-ink">No knowledge yet</p>
            <p className="mt-1 text-[13px] text-ink-muted">
              Add your website or paste some notes and Elsie will answer customer questions from it.
            </p>
            <button className={cn(headerBtnPrimary, 'mx-auto mt-5')} onClick={() => setAddMode('website')}>
              <Globe size={15} /> Add website
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {sources.map((s) => {
              const Icon = s.type === 'website' ? Globe : FileText
              const st = STATUS_PILL[s.status] ?? STATUS_PILL.processing
              return (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-elevated">
                    <Icon size={17} className="text-ink-muted" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{s.name}</p>
                    <p className="truncate text-[12.5px] text-ink-muted">
                      {s.url || s.summary || (s.type === 'document' ? 'Pasted notes' : '—')}
                      {s.created_at ? ` · ${timeAgo(s.created_at)}` : ''}
                    </p>
                  </div>
                  <StatusPill tone={st.tone} uppercase={false}>
                    {st.label}
                  </StatusPill>
                  <button
                    onClick={() => remove(s.id)}
                    disabled={deleting === s.id}
                    title="Remove"
                    className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-red-50 hover:text-red-600"
                  >
                    {deleting === s.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {/* Test mode — live keyword match over real sources */}
      <SectionCard bodyClassName="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <IconTile>
            <Search size={18} />
          </IconTile>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-tight text-ink">Test mode</h2>
            <p className="mt-1 text-[13.5px] text-ink-muted">
              Try a customer question — see which of your sources Elsie would answer from.
            </p>

            <form onSubmit={runTest} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder='e.g. "Do you cover Richmond?"'
                  className="h-11 w-full rounded-lg border border-border bg-page pl-9 pr-3 text-[13.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-ink-subtle/50"
                />
              </div>
              <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90">
                <Search size={15} /> Search
              </button>
            </form>

            {results !== null && (
              <div className="mt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  {results.length ? `${results.length} matching source${results.length > 1 ? 's' : ''}` : 'No matching sources'}
                </p>
                {results.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-ink-muted">
                    Nothing in your knowledge base matches that yet — add a source so Elsie can answer it.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {results.map((s) => (
                      <li key={s.id} className="rounded-xl border border-border bg-page/60 px-4 py-3">
                        <div className="flex items-center gap-2">
                          {s.type === 'website' ? (
                            <Globe size={13} className="text-ink-subtle" />
                          ) : (
                            <FileText size={13} className="text-ink-subtle" />
                          )}
                          <p className="text-[13px] font-medium text-ink">{s.name}</p>
                        </div>
                        {(s.summary || s.url) && (
                          <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-muted">{s.summary || s.url}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {addMode && (
        <AddSourceModal
          token={token}
          mode={addMode}
          onClose={() => setAddMode(false)}
          onAdded={() => {
            setAddMode(false)
            load()
          }}
        />
      )}
    </div>
  )
}

const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY || ''

interface PlaceHit {
  displayName?: { text: string }
  formattedAddress?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  regularOpeningHours?: { weekdayDescriptions?: string[] }
  rating?: number
}

/** Find your business on Google and import its public details as a knowledge source. */
function GoogleBusinessImport({ token, onImported }: { token?: string; onImported: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlaceHit[]>([])
  const [searching, setSearching] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim() || !GOOGLE_PLACES_KEY) { if (!GOOGLE_PLACES_KEY) setMsg('Google search is not configured.'); return }
    setSearching(true); setMsg(null); setResults([])
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.internationalPhoneNumber,places.websiteUri,places.regularOpeningHours,places.rating',
        },
        body: JSON.stringify({ textQuery: q, maxResultCount: 5 }),
      })
      const data = await res.json() as { places?: PlaceHit[] }
      setResults(data.places ?? [])
      if (!data.places?.length) setMsg('No matches — try your business name + town.')
    } catch {
      setMsg('Google search failed. Try again.')
    } finally {
      setSearching(false)
    }
  }

  async function importPlace(p: PlaceHit) {
    if (!token) return
    const name = p.displayName?.text || 'My business'
    const text = [
      `Business: ${name}`,
      p.formattedAddress ? `Address: ${p.formattedAddress}` : '',
      p.internationalPhoneNumber ? `Phone: ${p.internationalPhoneNumber}` : '',
      p.websiteUri ? `Website: ${p.websiteUri}` : '',
      typeof p.rating === 'number' ? `Google rating: ${p.rating}` : '',
      p.regularOpeningHours?.weekdayDescriptions?.length ? `Opening hours:\n${p.regularOpeningHours.weekdayDescriptions.join('\n')}` : '',
    ].filter(Boolean).join('\n')
    setImporting(name)
    setMsg(null)
    try {
      const res = await fetch('/api/kb/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: `Google: ${name}`, text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setMsg(data.error || 'Import failed.'); return }
      setMsg(`Imported “${name}” — Elsie can now answer from it.`)
      setResults([])
      setQ('')
      onImported()
    } catch {
      setMsg('Import failed.')
    } finally {
      setImporting(null)
    }
  }

  return (
    <SectionCard bodyClassName="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <IconTile><MapPin size={18} /></IconTile>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-tight text-ink">Find your business on Google</h2>
          <p className="mt-1 text-[13.5px] text-ink-muted">Search Google and import your address, phone, hours and website so Elsie answers from your real listing.</p>
          <form onSubmit={search} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Glow Beauty Salon, Manchester" className="h-11 w-full rounded-lg border border-border bg-page pl-9 pr-3 text-[13.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-ink-subtle/50" />
            </div>
            <button type="submit" disabled={searching} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
              {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
            </button>
          </form>
          {msg && <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-[12.5px] text-ink-muted">{msg}</p>}
          {results.length > 0 && (
            <ul className="mt-3 space-y-2">
              {results.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-page/60 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{p.displayName?.text || 'Business'}</p>
                    <p className="truncate text-[12px] text-ink-muted">{p.formattedAddress || ''}</p>
                  </div>
                  <button onClick={() => void importPlace(p)} disabled={!!importing} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink transition hover:bg-elevated disabled:opacity-50">
                    {importing === (p.displayName?.text || 'My business') ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Import
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

function AddSourceModal({
  token,
  mode,
  onClose,
  onAdded,
}: {
  token?: string
  mode: 'website' | 'text'
  onClose: () => void
  onAdded: () => void
}) {
  const [tab, setTab] = useState<'website' | 'text'>(mode)
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
      if (data.error) {
        setErr(data.error)
        return
      }
      onAdded()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed to add source')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Add to knowledge base</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 flex rounded-lg border border-border bg-elevated p-0.5">
          {(['website', 'text'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 rounded-md py-1.5 text-[12.5px] font-medium transition',
                tab === t ? 'bg-surface text-ink shadow-soft' : 'text-ink-muted hover:text-ink',
              )}
            >
              {t === 'website' ? 'Website' : 'Paste notes'}
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
                className="mt-1 h-10 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-ink outline-none focus:border-ink-subtle/50"
              />
              <p className="mt-1 text-[11px] text-ink-subtle">Elsie reads the page and learns from it.</p>
            </div>
          ) : (
            <div>
              <label className="block text-[12px] font-medium text-ink-muted">Notes</label>
              <textarea
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder="Opening hours, prices, policies — anything Elsie should know…"
                className="mt-1 w-full rounded-lg border border-border bg-page px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-subtle/50"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Adding…' : 'Add to knowledge base'}
          </button>
        </form>
      </div>
    </div>
  )
}
