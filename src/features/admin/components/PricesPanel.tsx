import { useState } from 'react'
import { ChevronDown, Save } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAdminApi, useAdminMutation } from '../hooks/useAdminApi'
import { AdminError } from './AdminError'

interface PriceRow {
  id: number
  provider: string
  model: string
  match: 'exact' | 'prefix'
  input_per_mtok: number | null
  output_per_mtok: number | null
  cached_input_per_mtok: number | null
  per_minute: number | null
  effective_from: string
  note: string | null
}

const PROVIDERS = ['openai', 'anthropic', 'google', 'openrouter', 'xai', 'typesafe', 'assemblyai']
const FIELDS = [
  { key: 'input_per_mtok', label: 'Input $/1M' },
  { key: 'output_per_mtok', label: 'Output $/1M' },
  { key: 'cached_input_per_mtok', label: 'Cached $/1M' },
  { key: 'per_minute', label: '$ per minute' },
] as const
type FieldKey = typeof FIELDS[number]['key']

const field = 'w-full rounded border border-border bg-surface px-1.5 py-1 text-[12px] tabular-nums text-ink'

/** The price list the database turns tokens into dollars with. Open it when a cost looks wrong. */
export function PricesPanel({ open, onToggle, onChanged, since }: { open: boolean; onToggle: () => void; onChanged: () => void; since: string }) {
  const { data, error, refetch } = useAdminApi<{ prices: PriceRow[]; usd_to_gbp: number }>('ai/prices', { prices: [], usd_to_gbp: 0 }, [])
  const save = useAdminMutation('ai/prices', 'PUT')
  const reprice = useAdminMutation('ai/prices', 'POST')
  const [drafts, setDrafts] = useState<Record<number, Partial<Record<FieldKey, string>>>>({})
  const [rate, setRate] = useState<string | null>(null)
  // Until it is edited, "price again from" follows the first day anything was recorded.
  const [editedFrom, setFrom] = useState<string | null>(null)
  const from = editedFrom ?? since
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState({ provider: 'openai', model: '', match: 'exact', effective_from: '2000-01-01', input_per_mtok: '', output_per_mtok: '', cached_input_per_mtok: '', per_minute: '' })

  const run = async (work: () => Promise<string>) => {
    setBusy(true); setMessage(''); setProblem('')
    try { setMessage(await work()); refetch(); onChanged() } catch (e) { setProblem(e instanceof Error ? e.message : 'That did not work') } finally { setBusy(false) }
  }
  const shown = (row: PriceRow, key: FieldKey) => drafts[row.id]?.[key] ?? (row[key] === null ? '' : String(row[key]))
  const edited = (row: PriceRow) => Object.keys(drafts[row.id] ?? {}).length > 0
  const saveRow = (row: PriceRow) => run(async () => {
    await save({ provider: row.provider, model: row.model, match: row.match, effective_from: row.effective_from, note: 'Edited in Admin',
      ...Object.fromEntries(FIELDS.map((f) => [f.key, shown(row, f.key)])) })
    setDrafts((d) => { const { [row.id]: _gone, ...rest } = d; return rest })
    return 'Saved. Press "Price past calls again" to apply it to calls already recorded.'
  })

  return (
    <section className="rounded-xl border border-border bg-surface shadow-soft">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-3 p-3.5 text-left">
        <span>
          <span className="block text-[13px] font-semibold text-ink">Prices</span>
          <span className="block text-[11px] text-ink-muted">What each model charges. A call with no price here shows as $0 and is flagged.</span>
        </span>
        <ChevronDown size={16} className={cn('shrink-0 text-ink-muted transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border p-3.5">
          {error && <AdminError error={error} />}
          {problem && <AdminError error={problem} />}
          {message && <p className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-[12px] text-success">{message}</p>}

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] text-ink-muted">Pounds per dollar
              <input inputMode="decimal" value={rate ?? (data.usd_to_gbp ? String(data.usd_to_gbp) : '')} onChange={(e) => setRate(e.target.value)} className={cn(field, 'mt-0.5 w-28')} />
            </label>
            <button type="button" disabled={busy || rate === null} onClick={() => run(async () => { await save({ usd_to_gbp: rate }); setRate(null); return 'Rate saved.' })}
              className="rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">Save rate</button>
            <label className="text-[11px] text-ink-muted">Price calls again from
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(field, 'mt-0.5 w-36')} />
            </label>
            <button type="button" disabled={busy} onClick={() => run(async () => { const r = await reprice({ action: 'reprice', from }) as { repriced?: number }; return `${(r.repriced ?? 0).toLocaleString('en-GB')} calls priced again.` })}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-elevated disabled:opacity-40">Price past calls again</button>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-border text-[11px] text-ink-muted">
                  <th className="py-1.5 pr-2 font-medium">Provider and model</th>
                  <th className="px-1 font-medium">From</th>
                  {FIELDS.map((f) => <th key={f.key} className="px-1 font-medium">{f.label}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.prices.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 align-middle">
                    <td className="py-1.5 pr-2">
                      <span className="block text-ink">{row.model}{row.match === 'prefix' && <span className="ml-1 text-[10px] text-ink-subtle">(any version)</span>}</span>
                      <span className="block text-[10px] text-ink-subtle">{row.provider}{row.note ? `, ${row.note}` : ''}</span>
                    </td>
                    <td className="px-1 tabular-nums text-ink-muted">{row.effective_from === '2000-01-01' ? 'always' : row.effective_from}</td>
                    {FIELDS.map((f) => (
                      <td key={f.key} className="px-1">
                        <input inputMode="decimal" aria-label={`${row.model} ${f.label}`} value={shown(row, f.key)} onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: { ...d[row.id], [f.key]: e.target.value } }))} className={cn(field, 'w-20')} />
                      </td>
                    ))}
                    <td className="pl-1">
                      <button type="button" disabled={busy || !edited(row)} onClick={() => saveRow(row)} aria-label={`Save ${row.model}`} className="flex items-center gap-1 rounded bg-brand px-2 py-1 text-[11px] font-medium text-white disabled:opacity-30"><Save size={11} />Save</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form className="rounded-lg border border-dashed border-border p-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { await save(fresh); setFresh({ ...fresh, model: '', input_per_mtok: '', output_per_mtok: '', cached_input_per_mtok: '', per_minute: '' }); return 'Price added.' }) }}>
            <p className="mb-2 text-[12px] font-medium text-ink">Add or replace a price</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-[11px] text-ink-muted">Provider
                <select value={fresh.provider} onChange={(e) => setFresh({ ...fresh, provider: e.target.value })} className={cn(field, 'mt-0.5')}>{PROVIDERS.map((p) => <option key={p}>{p}</option>)}</select>
              </label>
              <label className="col-span-1 text-[11px] text-ink-muted sm:col-span-2">Model name
                <input value={fresh.model} onChange={(e) => setFresh({ ...fresh, model: e.target.value })} required placeholder="gpt-5.4-mini" className={cn(field, 'mt-0.5')} />
              </label>
              <label className="text-[11px] text-ink-muted">Matches
                <select value={fresh.match} onChange={(e) => setFresh({ ...fresh, match: e.target.value })} className={cn(field, 'mt-0.5')}><option value="exact">this exact name</option><option value="prefix">any name starting so</option></select>
              </label>
              {FIELDS.map((f) => (
                <label key={f.key} className="text-[11px] text-ink-muted">{f.label}
                  <input inputMode="decimal" value={fresh[f.key]} onChange={(e) => setFresh({ ...fresh, [f.key]: e.target.value })} className={cn(field, 'mt-0.5')} />
                </label>
              ))}
              <label className="text-[11px] text-ink-muted">In force from
                <input type="date" value={fresh.effective_from} onChange={(e) => setFresh({ ...fresh, effective_from: e.target.value })} className={cn(field, 'mt-0.5')} />
              </label>
            </div>
            <button type="submit" disabled={busy || !fresh.model.trim()} className="mt-3 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40">Add price</button>
          </form>
        </div>
      )}
    </section>
  )
}
