import { useCallback, useEffect, useState } from 'react'
import { Loader2, Save, RotateCcw, Trash2, Archive, Check } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { SectionCard } from '@/core/ui/SectionCard'
import { Input } from '@/core/ui/Input'

interface Snapshot { id: string; label: string; created_at: string }

/**
 * Configuration backups ("Top Pick"). Save the agent's full current setup
 * (voice, brain, greeting, prompt, behaviour) and restore it later in one tap —
 * so experimenting is safe: you can always jump back to a known-good config.
 */
export function ConfigBackups({ agentId, session }: { agentId?: string; session: Session | null }) {
  const [list, setList] = useState<Snapshot[]>([])
  const [label, setLabel] = useState('Top Pick')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const token = session?.access_token

  const call = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/agent/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Something went wrong')
    return data
  }, [token])

  const load = useCallback(async () => {
    if (!agentId || !token) return
    try {
      const d = await call({ action: 'list', agentId })
      setList(d.snapshots || [])
    } catch { /* ignore */ }
  }, [agentId, token, call])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!agentId) return
    setBusy('save'); setErr(null); setMsg(null)
    try {
      await call({ action: 'save', agentId, label: label.trim() || 'Backup' })
      setMsg('Saved'); await load()
      setTimeout(() => setMsg(null), 2500)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save') }
    finally { setBusy(null) }
  }

  async function restore(s: Snapshot) {
    if (!window.confirm(`Restore "${s.label}"? This replaces the agent's current voice, brain, greeting, prompt and behaviour with this saved setup.`)) return
    setBusy(s.id); setErr(null); setMsg(null)
    try {
      await call({ action: 'restore', snapshotId: s.id })
      setMsg(`Restored "${s.label}" — live now. Reloading…`)
      setTimeout(() => window.location.reload(), 900)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not restore'); setBusy(null) }
  }

  async function del(s: Snapshot) {
    if (!window.confirm(`Delete the "${s.label}" backup?`)) return
    setBusy(s.id); setErr(null); setMsg(null)
    try { await call({ action: 'delete', snapshotId: s.id }); await load() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not delete') }
    finally { setBusy(null) }
  }

  return (
    <SectionCard eyebrow="Backups" title="Configuration backups" action={<Archive size={16} className="text-ink-subtle" />}>
      <p className="mb-4 text-[12.5px] text-ink-muted">Save the whole current setup as a restore point. If a change makes things worse, jump back to a good one in one tap.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Backup name (e.g. Top Pick)"
          className="h-9 w-auto min-w-[180px] flex-1 text-[13px]"
          aria-label="Backup name"
        />
        <button
          onClick={() => void save()}
          disabled={busy === 'save' || !agentId}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save current setup
        </button>
        {msg && <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-emerald-600"><Check size={13} /> {msg}</span>}
        {err && <span className="text-[12.5px] text-red-600">{err}</span>}
      </div>

      <div className="mt-4 space-y-2">
        {list.length === 0 && (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-ink-subtle">
            No backups yet. Save your current setup above to create one.
          </p>
        )}
        {list.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink">{s.label}</p>
              <p className="text-[11.5px] text-ink-subtle">{new Date(s.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => void restore(s)}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink transition hover:bg-elevated disabled:opacity-50"
              >
                {busy === s.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Restore
              </button>
              <button
                onClick={() => void del(s)}
                disabled={!!busy}
                className="inline-flex items-center justify-center rounded-lg border border-border bg-surface p-1.5 text-ink-subtle transition hover:bg-elevated hover:text-red-600 disabled:opacity-50"
                aria-label={`Delete ${s.label}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
