import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Globe, FileText, Trash2, Loader2, X, Search, UploadCloud, MapPin, Sparkles, Send, PenLine, ArrowRight } from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { StatusPill, type PillTone } from '@/core/ui/StatusPill'
import { useAuth } from '@/core/auth/AuthProvider'
import { cn } from '@/core/lib/cn'
import { extractTextFromFile } from '@/core/lib/extractText'

/**
 * Knowledge Base — add what Elsie should know (website / file / notes / Google),
 * then "Set up Elsie" writes her whole configuration (greeting, personality,
 * services, FAQs, lead rules, 3 follow-up sequences) from it. Test box asks
 * Elsie a real question and shows her answer.
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

type AddMode = false | 'website' | 'text' | 'google'

/** One of the four "how to add knowledge" option tiles. */
function OptionTile({
  icon, tint, title, desc, onClick, busy,
}: { icon: ReactNode; tint: string; title: string; desc: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="group flex flex-1 flex-col items-start gap-2.5 rounded-xl border border-border bg-surface p-4 text-left transition hover:border-ink-subtle/40 hover:bg-elevated/40 disabled:opacity-60"
    >
      <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', tint)}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : icon}
      </span>
      <span className="text-[13.5px] font-semibold text-ink">{title}</span>
      <span className="text-[12px] leading-snug text-ink-muted">{desc}</span>
    </button>
  )
}

export default function KnowledgeBasePage() {
  const { session } = useAuth()
  const token = session?.access_token

  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [addMode, setAddMode] = useState<AddMode>(false)

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

  useEffect(() => { load() }, [load])

  async function remove(id: string) {
    if (!token || !window.confirm('Remove this knowledge source? Elsie will stop answering from it.')) return
    setDeleting(id)
    try {
      await fetch(`/api/training/sources?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
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

  const syncedCount = sources.filter((s) => s.status === 'synced').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Sparkles size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Knowledge Base</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-ink-muted">
            Tell Elsie about your business, then let her set herself up — greeting, services, FAQs and follow-ups.
          </p>
        </div>
      </div>

      {/* Step 1 — add knowledge (four clear options) */}
      <SectionCard bodyClassName="p-5 sm:p-6">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">1 · How do you want to add your knowledge?</h2>
          <span className="text-[12px] text-ink-subtle">Add as many as you like</span>
        </div>
        <p className="mb-4 text-[13px] text-ink-muted">Pick any (or all) of these — the more Elsie knows, the better she answers.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OptionTile icon={<Globe size={18} />} tint="bg-blue-50 text-blue-600" title="Add a website" desc="Elsie reads your site and learns from it." onClick={() => setAddMode('website')} />
          <OptionTile icon={<UploadCloud size={18} />} tint="bg-violet-50 text-violet-600" title="Upload a file" desc="PDF, Word, text — prices, policies, menus." onClick={() => fileRef.current?.click()} busy={uploading} />
          <OptionTile icon={<PenLine size={18} />} tint="bg-amber-50 text-amber-600" title="Paste notes" desc="Type or paste anything Elsie should know." onClick={() => setAddMode('text')} />
          <OptionTile icon={<MapPin size={18} />} tint="bg-emerald-50 text-emerald-600" title="Find on Google" desc="Import your address, hours and phone." onClick={() => setAddMode('google')} />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv,.json,.log,text/*,application/pdf"
          className="hidden"
          onChange={(e) => void onUploadFile(e.currentTarget)}
        />
        {uploadErr && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{uploadErr}</p>}
      </SectionCard>

      {/* Sources list */}
      <SectionCard bodyClassName="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-ink-muted" />
          </div>
        ) : sources.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <FileText size={28} className="mx-auto text-ink-subtle" />
            <p className="mt-3 text-[14px] font-medium text-ink">No knowledge yet</p>
            <p className="mt-1 text-[13px] text-ink-muted">Use one of the options above to give Elsie something to learn from.</p>
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
                  <StatusPill tone={st.tone} uppercase={false}>{st.label}</StatusPill>
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

      {/* Step 2 — let Elsie set herself up */}
      <SetupCard token={token} canRun={syncedCount > 0} />

      {/* Step 3 — test Elsie */}
      <TestBox token={token} canRun={syncedCount > 0} />

      {addMode === 'website' || addMode === 'text' ? (
        <AddSourceModal token={token} mode={addMode} onClose={() => setAddMode(false)} onAdded={() => { setAddMode(false); load() }} />
      ) : null}
      {addMode === 'google' ? (
        <GoogleImportModal token={token} onClose={() => setAddMode(false)} onImported={() => { load() }} />
      ) : null}
    </div>
  )
}

/* ─────────────────────────── Set up Elsie ─────────────────────────── */

interface ApplyResult { greeting: string; tone: string; services: number; faqs: number; sequences: number }

function SetupCard({ token, canRun }: { token?: string; canRun: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<ApplyResult | null>(null)

  async function run() {
    if (!token) return
    setBusy(true); setErr(null); setDone(null)
    try {
      const res = await fetch('/api/training/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setErr(data.error || 'Setup failed — try again.'); return }
      setDone(data.summary as ApplyResult)
    } catch {
      setErr('Setup failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard bodyClassName="p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Sparkles size={20} /></span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">2 · Let Elsie set herself up</h2>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-muted">
              From everything you've added, Elsie writes her greeting, personality, services, FAQs, lead rules
              and 3 follow-up sequences. She'll draft replies for you to approve. Everything stays editable in{' '}
              <Link to="/agents" className="font-medium text-accent hover:underline">AI Agent</Link>.
            </p>
          </div>
        </div>
        <button
          onClick={() => void run()}
          disabled={busy || !canRun}
          title={canRun ? 'Set up Elsie from your knowledge' : 'Add some knowledge first'}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {busy ? 'Setting up…' : 'Set up Elsie'}
        </button>
      </div>
      {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{err}</p>}
      {done && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[13px] font-semibold text-emerald-800">Elsie is ready to go 🎉</p>
          <p className="mt-1 text-[12.5px] text-emerald-700">
            Wrote her greeting &amp; personality{done.services ? `, ${done.services} services` : ''}{done.faqs ? `, ${done.faqs} FAQs` : ''} and {done.sequences} follow-up sequences.
            {(!done.services && !done.faqs) ? ' (You already had services & FAQs, so those were left as they are.)' : ''} She'll draft replies for you to approve.
          </p>
          <Link to="/agents" className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-800 hover:underline">
            Review &amp; edit in AI Agent <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </SectionCard>
  )
}

/* ─────────────────────────── Test Elsie ─────────────────────────── */

function TestBox({ token, canRun }: { token?: string; canRun: boolean }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !q.trim()) return
    setBusy(true); setErr(null); setAnswer(null)
    try {
      const res = await fetch('/api/training/test', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: q }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setErr(data.error || 'Test failed.'); return }
      setAnswer(data.answer)
    } catch {
      setErr('Test failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard bodyClassName="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Send size={18} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">3 · Test Elsie</h2>
          <p className="mt-1 text-[13px] text-ink-muted">Ask a real customer question — see exactly how Elsie would reply.</p>
          <form onSubmit={send} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder='e.g. "Do you cover Richmond, and how much?"'
                className="h-11 w-full rounded-lg border border-border bg-page pl-9 pr-3 text-[13.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-ink-subtle/50"
              />
            </div>
            <button type="submit" disabled={busy || !canRun || !q.trim()} title={canRun ? 'Send' : 'Add knowledge first'} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send
            </button>
          </form>
          {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{err}</p>}
          {answer && (
            <div className="mt-4 rounded-xl rounded-tl-sm border border-border bg-page/70 px-4 py-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Elsie would reply</p>
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{answer}</p>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

/* ─────────────────────────── Google import modal ─────────────────────────── */

const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY || ''

interface PlaceHit {
  displayName?: { text: string }
  formattedAddress?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  regularOpeningHours?: { weekdayDescriptions?: string[] }
  rating?: number
}

function GoogleImportModal({ token, onClose, onImported }: { token?: string; onClose: () => void; onImported: () => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlaceHit[]>([])
  const [searching, setSearching] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    if (!GOOGLE_PLACES_KEY) { setMsg('Google search is not configured.'); return }
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
    setImporting(name); setMsg(null)
    try {
      const res = await fetch('/api/kb/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: `Google: ${name}`, text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setMsg(data.error || 'Import failed.'); return }
      onImported()
      onClose()
    } catch {
      setMsg('Import failed.')
    } finally {
      setImporting(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink"><MapPin size={16} className="text-emerald-600" /> Find your business on Google</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink"><X size={16} /></button>
        </div>
        <p className="mt-1.5 text-[13px] text-ink-muted">Search and import your address, phone, hours and website.</p>
        <form onSubmit={search} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Glow Beauty Salon, Manchester" className="h-11 w-full rounded-lg border border-border bg-page pl-9 pr-3 text-[13.5px] text-ink outline-none placeholder:text-ink-subtle focus:border-ink-subtle/50" />
          </div>
          <button type="submit" disabled={searching} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-5 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
            {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
          </button>
        </form>
        {msg && <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-[12.5px] text-ink-muted">{msg}</p>}
        {results.length > 0 && (
          <ul className="mt-3 max-h-72 space-y-2 overflow-auto">
            {results.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-page/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">{p.displayName?.text || 'Business'}</p>
                  <p className="truncate text-[12px] text-ink-muted">{p.formattedAddress || ''}</p>
                </div>
                <button onClick={() => void importPlace(p)} disabled={!!importing} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                  {importing === (p.displayName?.text || 'My business') ? <Loader2 size={13} className="animate-spin" /> : null} Import
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────── Website / notes modal ─────────────────────────── */

function AddSourceModal({ token, mode, onClose, onAdded }: { token?: string; mode: 'website' | 'text'; onClose: () => void; onAdded: () => void }) {
  const [tab, setTab] = useState<'website' | 'text'>(mode)
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setErr(''); setSubmitting(true)
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
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed to add source')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Add to knowledge base</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink"><X size={16} /></button>
        </div>

        <div className="mt-4 flex rounded-lg border border-border bg-elevated p-0.5">
          {(['website', 'text'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn('flex-1 rounded-md py-1.5 text-[12.5px] font-medium transition', tab === t ? 'bg-surface text-ink shadow-soft' : 'text-ink-muted hover:text-ink')}>
              {t === 'website' ? 'Website' : 'Paste notes'}
            </button>
          ))}
        </div>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>}

        <form onSubmit={submit} className="mt-4 space-y-3">
          {tab === 'website' ? (
            <div>
              <label className="block text-[12px] font-medium text-ink-muted">Website URL</label>
              <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourbusiness.co.uk" className="mt-1 h-10 w-full rounded-lg border border-border bg-page px-3 text-[13px] text-ink outline-none focus:border-ink-subtle/50" />
              <p className="mt-1 text-[11px] text-ink-subtle">Elsie reads the page and learns from it.</p>
            </div>
          ) : (
            <div>
              <label className="block text-[12px] font-medium text-ink-muted">Notes</label>
              <textarea required value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Opening hours, prices, policies — anything Elsie should know…" className="mt-1 w-full rounded-lg border border-border bg-page px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-subtle/50" />
            </div>
          )}
          <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Adding…' : 'Add to knowledge base'}
          </button>
        </form>
      </div>
    </div>
  )
}
