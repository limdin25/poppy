import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, Download, Plus, Table2, Columns3, MessageCircle, Trash2, ChevronDown, Loader2, UploadCloud } from 'lucide-react'
import { PageHeader } from '@/core/ui/PageHeader'
import { DataTable, type Column } from '@/core/ui/DataTable'
import { KanbanBoard, type KanbanColumn } from '@/core/ui/KanbanBoard'
import { StatusPill, type PillTone } from '@/core/ui/StatusPill'
import { FilterChips } from '@/core/ui/FilterChips'
import { Switch } from '@/core/ui/Switch'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { cn } from '@/core/lib/cn'
import { parseCsvText, mapCsvRows, toCsv, downloadFile, type ParsedRow } from '@/core/lib/csv'
import { useLeads } from '@/core/hooks/useLeads'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import type { Contact } from '@/core/types/database'

/**
 * Leads — waslo-style table/kanban, fully wired.
 * Shows every contact with lifecycle Status + AI Classification, a per-lead
 * Pause-AI toggle, View Chat, delete, plus Import CSV / Export / Add Lead.
 */

type Classification = 'hot' | 'warm' | 'cold'

const CLASS_LABEL: Record<Classification, { label: string; tone: PillTone; dot: string }> = {
  hot: { label: 'Hot', tone: 'hot', dot: 'bg-red-500' },
  warm: { label: 'Warm', tone: 'warm', dot: 'bg-amber-500' },
  cold: { label: 'Cold', tone: 'cold', dot: 'bg-blue-500' },
}
const CLASS_ORDER: Classification[] = ['hot', 'warm', 'cold']

type Lifecycle = 'new' | 'contacted' | 'qualified' | 'won' | 'lost'
const STATUS_META: Record<Lifecycle, { label: string; tone: PillTone }> = {
  new: { label: 'New', tone: 'neutral' },
  contacted: { label: 'Contacted', tone: 'info' },
  qualified: { label: 'Qualified', tone: 'warning' },
  won: { label: 'Won', tone: 'success' },
  lost: { label: 'Lost', tone: 'danger' },
}
const STATUS_ORDER: Lifecycle[] = ['new', 'contacted', 'qualified', 'won', 'lost']

function phoneOf(c: Contact): string { return c.phone || c.whatsapp || '—' }
function whatsappOf(c: Contact): string { return c.whatsapp || c.phone || '—' }
function classOf(c: Contact): Classification {
  return c.lead_status === 'hot' || c.lead_status === 'warm' || c.lead_status === 'cold' ? c.lead_status : 'cold'
}
function statusOf(c: Contact): Lifecycle {
  return STATUS_ORDER.includes(c.status as Lifecycle) ? (c.status as Lifecycle) : 'new'
}
function lastActiveOf(c: Contact): string {
  const iso = c.lead_updated_at || c.updated_at
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Generic inline pill + chevron dropdown used for both Classification and Status. */
function PillDropdown<T extends string>({
  value, options, render, onChange,
}: {
  value: T
  options: T[]
  render: (v: T) => React.ReactNode
  onChange: (v: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function toggle() {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen((o) => !o)
  }

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', () => setOpen(false), true)
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('scroll', () => setOpen(false), true) }
  }, [open])

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={toggle} className="inline-flex items-center gap-1 rounded-full transition hover:opacity-80">
        {render(value)}
        <ChevronDown size={13} className="text-ink-subtle" />
      </button>
      {open && pos && (
        <div ref={menuRef} style={{ position: 'fixed', top: pos.top, left: pos.left }} className="z-50 w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-pop">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => { onChange(o); setOpen(false) }}
              className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-elevated', o === value ? 'font-semibold text-ink' : 'text-ink-muted')}
            >
              {render(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated'

export default function LeadsPage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { data: allLeads, loading, refetch } = useLeads()
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Add Lead modal
  const [addOpen, setAddOpen] = useState(false)
  const [aName, setAName] = useState('')
  const [aPhone, setAPhone] = useState('')
  const [aEmail, setAEmail] = useState('')
  const [aStatus, setAStatus] = useState<Lifecycle>('new')
  const [addBusy, setAddBusy] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)

  // Import modal
  const [importOpen, setImportOpen] = useState(false)
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [importErr, setImportErr] = useState<string | null>(null)

  const leads = useMemo(
    () => allLeads.filter((l) => filter === 'all' || classOf(l) === filter),
    [filter, allLeads]
  )

  async function setClassification(id: string, c: Classification) {
    const { error } = await supabase.from('contacts').update({ lead_status: c, lead_updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { console.error('classify failed:', error.message); return }
    refetch()
  }
  async function setStatus(id: string, s: Lifecycle) {
    const { error } = await supabase.from('contacts').update({ status: s }).eq('id', id)
    if (error) { console.error('status failed:', error.message); return }
    refetch()
  }
  async function togglePause(id: string, next: boolean) {
    const { error } = await supabase.from('contacts').update({ ai_paused: next }).eq('id', id)
    if (error) { console.error('pause failed:', error.message); return }
    refetch()
  }
  async function deleteLead(id: string) {
    if (!window.confirm('Delete this lead? This cannot be undone.')) return
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) { console.error('delete failed:', error.message); return }
    refetch()
  }
  function moveLead(id: string, toColumn: string) { void setStatus(id, toColumn as Lifecycle) }

  async function addLead() {
    if (!aName.trim() && !aPhone.trim()) { setAddErr('Add a name or phone number.'); return }
    setAddBusy(true); setAddErr(null)
    const { error } = await supabase.from('contacts').insert({
      business_id: (allLeads[0]?.business_id) ?? undefined,
      name: aName.trim() || null,
      phone: aPhone.trim() || null,
      whatsapp: aPhone.trim() || null,
      email: aEmail.trim() || null,
      status: aStatus,
    } as never)
    setAddBusy(false)
    if (error) { setAddErr(error.message); return }
    setAddOpen(false); setAName(''); setAPhone(''); setAEmail(''); setAStatus('new')
    refetch()
  }

  function onImportFile(input: HTMLInputElement) {
    const file = input.files?.[0]; input.value = ''
    if (!file) return
    setImportErr(null); setImportMsg(null)
    if (file.size > 5 * 1024 * 1024) { setImportErr('That file is over 5 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = mapCsvRows(parseCsvText(String(reader.result || '')))
      if (!parsed.length) { setImportErr('No rows with a phone or email were found.'); return }
      setRows(parsed)
    }
    reader.readAsText(file)
  }
  async function doImport() {
    if (!rows || !session) return
    setImportBusy(true); setImportErr(null)
    try {
      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setImportErr(data.error || 'Import failed.'); return }
      setImportMsg(`Imported ${data.imported ?? 0}${data.skipped ? ` · ${data.skipped} skipped` : ''}.`)
      setRows(null)
      refetch()
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setImportBusy(false)
    }
  }

  function exportCsv() {
    const data = allLeads.map((l) => [
      l.name ?? '', phoneOf(l), l.email ?? '', STATUS_META[statusOf(l)].label, CLASS_LABEL[classOf(l)].label, lastActiveOf(l),
    ])
    downloadFile('leads.csv', toCsv(['Name', 'Phone', 'Email', 'Status', 'Classification', 'Last Active'], data))
  }

  function toggle(id: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.id))))
  }

  const classPill = (c: Classification) => (
    <StatusPill tone={CLASS_LABEL[c].tone}><span className={cn('h-1.5 w-1.5 rounded-full', CLASS_LABEL[c].dot)} />{CLASS_LABEL[c].label}</StatusPill>
  )
  const statusPill = (s: Lifecycle) => <StatusPill tone={STATUS_META[s].tone} uppercase={false}>{STATUS_META[s].label}</StatusPill>

  const columns: Column<Contact>[] = [
    {
      key: 'phone', header: 'Phone Number',
      render: (l) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{phoneOf(l)}</p>
          <p className="truncate text-[12px] text-ink-subtle">{l.name || '—'}</p>
        </div>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (l) => <PillDropdown value={statusOf(l)} options={STATUS_ORDER} render={statusPill} onChange={(s) => void setStatus(l.id, s)} />,
    },
    {
      key: 'classification', header: 'AI Classification',
      render: (l) => <PillDropdown value={classOf(l)} options={CLASS_ORDER} render={classPill} onChange={(c) => void setClassification(l.id, c)} />,
    },
    {
      key: 'ai', header: 'AI',
      render: (l) => (
        <div className="flex items-center gap-2" title={l.ai_paused ? 'AI paused — Elsie will not auto-reply' : 'AI active'}>
          <Switch checked={!l.ai_paused} onChange={(next) => void togglePause(l.id, !next)} />
          <span className="text-[11.5px] text-ink-subtle">{l.ai_paused ? 'Paused' : 'On'}</span>
        </div>
      ),
    },
    {
      key: 'lastActive', header: 'Last Active',
      render: (l) => <span className="whitespace-nowrap text-ink-muted">{lastActiveOf(l)}</span>,
    },
    {
      key: 'whatsapp', header: 'WhatsApp #',
      render: (l) => <p className="truncate text-[13px] text-ink">{whatsappOf(l)}</p>,
    },
    {
      key: 'actions', header: 'Actions', align: 'right',
      render: (l) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => navigate(`/inbox?contact=${l.id}`)} title="View chat" className="rounded-md p-1.5 text-ink-subtle transition hover:bg-elevated hover:text-ink">
            <MessageCircle size={15} />
          </button>
          <button onClick={() => void deleteLead(l.id)} title="Delete lead" className="rounded-md p-1.5 text-ink-subtle transition hover:bg-red-50 hover:text-red-600">
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ]

  const STATUS_DOT: Record<Lifecycle, string> = {
    new: 'bg-slate-400', contacted: 'bg-blue-500', qualified: 'bg-amber-500', won: 'bg-emerald-500', lost: 'bg-red-500',
  }
  const kanbanColumns: KanbanColumn<Contact>[] = STATUS_ORDER.map((s) => ({
    id: s, title: STATUS_META[s].label, accent: STATUS_DOT[s], items: leads.filter((l) => statusOf(l) === s),
  }))

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Leads"
        title="Leads"
        description="Manage and track your leads"
        actions={
          <>
            <button className={btn} onClick={() => { setImportOpen(true); setRows(null); setImportErr(null); setImportMsg(null) }}>
              <Upload size={15} /> Import CSV
            </button>
            <button className={btn} onClick={exportCsv} disabled={allLeads.length === 0}>
              <Download size={15} /> Export
            </button>
            <button onClick={() => { setAddOpen(true); setAddErr(null) }} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:opacity-90">
              <Plus size={15} /> Add Lead
            </button>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-whatsapp" />
              {allLeads.length} leads
            </span>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          options={[
            { value: 'all', label: 'All', count: allLeads.length },
            { value: 'hot', label: 'Hot' },
            { value: 'warm', label: 'Warm' },
            { value: 'cold', label: 'Cold' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
          <button onClick={() => setView('table')} className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium', view === 'table' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink')}>
            <Table2 size={14} /> Table
          </button>
          <button onClick={() => setView('kanban')} className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium', view === 'kanban' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink')}>
            <Columns3 size={14} /> Kanban
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-border bg-surface py-20 shadow-soft">
          <Loader2 size={22} className="animate-spin text-ink-muted" />
        </div>
      ) : allLeads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center shadow-soft">
          <MessageCircle size={28} className="mx-auto text-ink-subtle" />
          <p className="mt-3 text-[14px] font-medium text-ink">No leads yet</p>
          <p className="mt-1 text-[13px] text-ink-muted">As customers message your WhatsApp, Elsie classifies them here — or add one yourself.</p>
        </div>
      ) : view === 'table' ? (
        <DataTable columns={columns} data={leads} keyExtractor={(l) => l.id} selectable selected={selected} onToggle={toggle} onToggleAll={toggleAll} emptyMessage="No leads match this filter" />
      ) : (
        <KanbanBoard
          columns={kanbanColumns}
          keyExtractor={(l) => l.id}
          onMove={moveLead}
          renderCard={(l) => (
            <div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-ink">{phoneOf(l)}</p>
                <p className="truncate text-[11.5px] text-ink-subtle">{l.name || '—'}</p>
              </div>
              <p className="mt-2 text-[11px] text-ink-subtle">{lastActiveOf(l)}</p>
            </div>
          )}
        />
      )}

      {/* Add Lead modal */}
      <Dialog open={addOpen} onClose={() => !addBusy && setAddOpen(false)} width="sm">
        <DialogHeader>Add lead</DialogHeader>
        <DialogBody className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Name</label>
            <input value={aName} onChange={(e) => setAName(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Phone (WhatsApp)</label>
            <input value={aPhone} onChange={(e) => setAPhone(e.target.value)} placeholder="+44…" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Email (optional)</label>
            <input value={aEmail} onChange={(e) => setAEmail(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-ink-muted">Status</label>
            <select value={aStatus} onChange={(e) => setAStatus(e.target.value as Lifecycle)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20">
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
          {addErr && <p className="text-[12.5px] text-red-600">{addErr}</p>}
        </DialogBody>
        <DialogFooter>
          <button onClick={() => setAddOpen(false)} disabled={addBusy} className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-muted hover:bg-elevated disabled:opacity-40">Cancel</button>
          <button onClick={() => void addLead()} disabled={addBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {addBusy && <Loader2 size={14} className="animate-spin" />}{addBusy ? 'Adding…' : 'Add lead'}
          </button>
        </DialogFooter>
      </Dialog>

      {/* Import CSV modal */}
      <Dialog open={importOpen} onClose={() => !importBusy && setImportOpen(false)} width="md">
        <DialogHeader>Import leads from CSV</DialogHeader>
        <DialogBody className="space-y-3">
          {importMsg && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-700">{importMsg}</div>}
          {importErr && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{importErr}</div>}
          {!rows ? (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-page/60 px-6 py-10 text-center hover:border-ink-subtle hover:bg-elevated/50">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-elevated text-ink-muted"><UploadCloud size={20} /></span>
              <span className="text-[13.5px] font-medium text-ink">Drop a CSV or browse</span>
              <span className="text-[12px] text-ink-subtle">.csv up to 5 MB · name, phone, email columns</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onImportFile(e.currentTarget)} />
            </label>
          ) : (
            <div className="rounded-xl border border-border bg-page/60 p-4">
              <p className="text-[13px] font-medium text-ink">{rows.length} row{rows.length === 1 ? '' : 's'} ready</p>
              <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-border">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-elevated text-ink-subtle"><tr><th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Phone</th><th className="px-3 py-1.5">Email</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 6).map((r, i) => (
                      <tr key={i} className="border-t border-border text-ink"><td className="px-3 py-1.5">{r.name || '—'}</td><td className="px-3 py-1.5">{r.phone || '—'}</td><td className="truncate px-3 py-1.5">{r.email || '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 6 && <p className="mt-1.5 text-[11px] text-ink-subtle">+ {rows.length - 6} more…</p>}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <button onClick={() => setImportOpen(false)} disabled={importBusy} className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink-muted hover:bg-elevated disabled:opacity-40">Close</button>
          {rows && (
            <button onClick={() => void doImport()} disabled={importBusy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {importBusy && <Loader2 size={14} className="animate-spin" />}{importBusy ? 'Importing…' : `Import ${rows.length}`}
            </button>
          )}
        </DialogFooter>
      </Dialog>
    </div>
  )
}
