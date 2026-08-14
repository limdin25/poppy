import { useState } from 'react'
import { HardHat, Plus, Pencil, Trash2, X } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { MetricCard } from '../components/MetricCard'
import { AdminError } from '../components/AdminError'
import { useAdminApi, useAdminMutation } from '../hooks/useAdminApi'

interface Builder {
  id: string
  name: string
  phone: string | null
  email: string | null
  coverage: string[]
  notes: string | null
  active: boolean
  created_at: string
}

const EMPTY_FORM = { name: '', phone: '', email: '', coverage: '', notes: '', active: true }

export default function BuildersPage() {
  const { data: builders, loading, error, refetch } = useAdminApi<Builder[]>('builders', [])
  const create = useAdminMutation('builders', 'POST')
  const update = useAdminMutation('builders', 'PUT')
  const remove = useAdminMutation('builders', 'DELETE')

  const [editing, setEditing] = useState<Builder | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const active = builders.filter((b) => b.active).length

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(b: Builder) {
    setEditing(b)
    setForm({
      name: b.name,
      phone: b.phone ?? '',
      email: b.email ?? '',
      coverage: b.coverage.join(', '),
      notes: b.notes ?? '',
      active: b.active,
    })
    setFormError(null)
    setShowForm(true)
  }

  async function save() {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setBusy(true)
    setFormError(null)
    const coverage = form.coverage.split(',').map((c) => c.trim()).filter(Boolean)
    try {
      if (editing) {
        await update({ id: editing.id, name: form.name, phone: form.phone, email: form.email, coverage, notes: form.notes, active: form.active })
      } else {
        await create({ name: form.name, phone: form.phone, email: form.email, coverage, notes: form.notes })
      }
      setShowForm(false)
      refetch()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(b: Builder) {
    await update({ id: b.id, active: !b.active })
    refetch()
  }

  async function del(b: Builder) {
    if (!window.confirm(`Remove ${b.name} from the roster? Any house currently assigned to them will just show unassigned.`)) return
    await remove({ id: b.id })
    refetch()
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Builders</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            The roster a VA picks from to book a viewing — matched to a house by postcode on the Properties page
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90"
        >
          <Plus size={14} /> Add builder
        </button>
      </div>

      {error && <AdminError error={error} />}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <MetricCard label="Builders on the roster" value={loading ? '...' : builders.length} icon={<HardHat size={16} />} />
        <MetricCard label="Active" value={loading ? '...' : active} icon={<HardHat size={16} />} />
      </div>

      <div className="mt-6">
        <DataTable
          columns={[
            {
              key: 'name',
              header: 'Builder',
              render: (b) => (
                <div>
                  <div className="font-medium text-ink">{b.name}</div>
                  <div className="text-[12px] text-ink-muted">
                    {b.phone || '—'}{b.email ? ` · ${b.email}` : ''}
                  </div>
                </div>
              ),
            },
            {
              key: 'coverage',
              header: 'Covers',
              render: (b) => (
                <div className="flex flex-wrap gap-1">
                  {b.coverage.length === 0 && <span className="text-[12px] text-ink-muted">No areas set</span>}
                  {b.coverage.map((c) => (
                    <span key={c} className="rounded bg-elevated px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">{c}</span>
                  ))}
                </div>
              ),
            },
            {
              key: 'notes',
              header: 'Notes',
              render: (b) => <span className="text-[12px] text-ink-muted">{b.notes || '—'}</span>,
            },
            {
              key: 'active',
              header: 'Active',
              render: (b) => (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleActive(b) }}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${b.active ? 'bg-success/10 text-success' : 'bg-elevated text-ink-muted'}`}
                >
                  {b.active ? 'Active' : 'Inactive'}
                </button>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (b) => (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => openEdit(b)} className="rounded-md border border-border p-1.5 text-ink-muted transition hover:bg-elevated">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => del(b)} className="rounded-md border border-border p-1.5 text-danger transition hover:bg-elevated">
                    <Trash2 size={13} />
                  </button>
                </div>
              ),
            },
          ]}
          data={builders}
          keyExtractor={(b) => b.id}
          emptyMessage="No builders yet — add one to start matching houses to viewings"
        />
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={() => setShowForm(false)}>
          <div
            className="w-full max-w-md rounded-t-2xl bg-surface p-5 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-ink">{editing ? 'Edit builder' : 'Add builder'}</h2>
              <button onClick={() => setShowForm(false)} className="text-ink-muted hover:text-ink"><X size={18} /></button>
            </div>

            {formError && <AdminError error={formError} />}

            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Name</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Phone</span>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Email</span>
                  <input
                    type="text"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Areas covered</span>
                <input
                  type="text"
                  value={form.coverage}
                  onChange={(e) => setForm({ ...form, coverage: e.target.value })}
                  placeholder="LE7, LE, NN1"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                />
                <span className="mt-1 block text-[11px] text-ink-subtle">
                  Comma-separated postcode outward codes (e.g. LE7) or a bare area to cover it all (e.g. LE for the whole Leicester area)
                </span>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Notes</span>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                />
              </label>
              {editing && (
                <label className="flex items-center gap-2 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  />
                  Active (unticking hides them from suggested builders without deleting them)
                </label>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={save}
                disabled={busy}
                className="rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-border px-3.5 py-1.5 text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
