import { useState } from 'react'
import { Hash, Phone, Pencil, Tag } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { MetricCard } from '../components/MetricCard'
import { AdminError } from '../components/AdminError'
import { useAdminApi, useAdminMutation } from '../hooks/useAdminApi'

interface NumberRow {
  phone: string
  country: string
  sources: string[]
  assigned: string | null
  status: string | null
  routes: string[]
  note: string
}

function NoteCell({ row, onSaved }: { row: NumberRow; onSaved: () => void }) {
  const saveNote = useAdminMutation('numbers')
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(row.note)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (value === row.note) { setEditing(false); return }
    setSaving(true)
    setError(null)
    try {
      await saveNote({ phone: row.phone, note: value })
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setValue(row.note); setEditing(false) }
          }}
          onBlur={save}
          disabled={saving}
          placeholder="e.g. Demo line — do not reassign"
          className="w-48 rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-brand"
        />
        {error && <span className="text-[11px] text-danger">{error}</span>}
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1.5 text-left"
      title="Click to edit note"
    >
      {row.note ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
          <Tag size={11} />
          {row.note}
        </span>
      ) : (
        <span className="text-[12px] text-ink-subtle">Add note</span>
      )}
      <Pencil size={11} className="text-ink-subtle opacity-0 transition group-hover:opacity-100" />
    </button>
  )
}

export default function NumberManagementPage() {
  const { data: numbers, loading, error, refetch } = useAdminApi<NumberRow[]>('numbers', [])

  const assignedCount = numbers.filter((n) => n.assigned).length

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Number Management</h1>
      {error && <AdminError error={error} />}
      <p className="mt-1 text-[13px] text-ink-muted">Every number across Twilio + Retell, where it points, and your notes</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Numbers" value={loading ? '...' : numbers.length} icon={<Hash size={16} />} />
        <MetricCard label="Assigned" value={loading ? '...' : assignedCount} change={`${numbers.length - assignedCount} unassigned`} trend="neutral" icon={<Phone size={16} />} />
        <MetricCard label="With Notes" value={loading ? '...' : numbers.filter((n) => n.note).length} icon={<Tag size={16} />} />
      </div>

      <div className="mt-6">
        <DataTable
          columns={[
            {
              key: 'phone',
              header: 'Number',
              render: (n) => (
                <div>
                  <span className="font-medium text-ink">{n.phone}</span>
                  <span className="ml-2 text-[11px] text-ink-subtle">{n.country}</span>
                </div>
              ),
            },
            {
              key: 'assigned',
              header: 'Assigned To',
              render: (n) => (
                <div>
                  <span className={n.assigned ? 'font-medium text-ink' : 'text-ink-subtle'}>
                    {n.assigned || 'Unassigned'}
                  </span>
                  {n.routes.length > 0 && (
                    <div className="mt-0.5 space-y-0.5">
                      {n.routes.map((r) => (
                        <p key={r} className="text-[11px] text-ink-subtle">{r}</p>
                      ))}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (n) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${n.status === 'connected' ? 'bg-success/10 text-success' : 'bg-elevated text-ink-muted'}`}>
                  {n.status || '—'}
                </span>
              ),
            },
            {
              key: 'sources',
              header: 'Provider',
              render: (n) => (
                <div className="flex gap-1">
                  {n.sources.map((s) => (
                    <span key={s} className="inline-flex rounded-md bg-elevated px-2 py-0.5 text-[11px] font-medium capitalize text-ink-muted">
                      {s}
                    </span>
                  ))}
                </div>
              ),
            },
            {
              key: 'note',
              header: 'Note',
              render: (n) => <NoteCell row={n} onSaved={refetch} />,
            },
          ]}
          data={numbers}
          keyExtractor={(n) => n.phone}
          emptyMessage={loading ? 'Loading numbers…' : 'No numbers found'}
        />
      </div>
    </div>
  )
}
