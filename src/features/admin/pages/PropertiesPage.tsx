import { useState } from 'react'
import { Home, PhoneOutgoing, BadgeCheck, ExternalLink, X } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { MetricCard } from '../components/MetricCard'
import { AdminError } from '../components/AdminError'
import { useAdminApi, useAdminMutation } from '../hooks/useAdminApi'

interface PropertyCall {
  id: string
  status: string
  attempts: number
  summary: string | null
  qualification: Record<string, unknown> | null
  transcript: Array<{ speaker: string; text: string }> | null
  recording_url?: string | null
  created_at: string
}

interface PropertyRow {
  id: string
  source: string
  source_property_id: string
  listing_url: string | null
  address: string | null
  price_text: string | null
  asking_price: number | null
  bedrooms: number | null
  property_type: string | null
  days_on_market: string | null
  agent_name: string | null
  agent_phone: string | null
  floorplan_urls: string[]
  deal: Record<string, unknown>
  status: string
  qualification: Record<string, unknown>
  notes: string | null
  deal_id: string | null
  created_at: string
  calls: PropertyCall[]
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-elevated text-ink-muted',
  call_queued: 'bg-blue-500/10 text-blue-600',
  calling: 'bg-violet-500/10 text-violet-600',
  qualified: 'bg-success/10 text-success',
  not_qualified: 'bg-danger/10 text-danger',
  no_answer: 'bg-amber-500/10 text-amber-600',
  callback: 'bg-cyan-500/10 text-cyan-600',
}

function gbp(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  if (!isFinite(n) || n <= 0) return '—'
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

export default function PropertiesPage() {
  const { data: properties, loading, error, refetch } = useAdminApi<PropertyRow[]>('properties', [])
  const act = useAdminMutation('properties', 'POST')
  const [selected, setSelected] = useState<PropertyRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const qualified = properties.filter((p) => p.status === 'qualified').length
  const awaiting = properties.filter((p) => ['new', 'call_queued', 'calling'].includes(p.status)).length

  async function run(action: string, property: PropertyRow) {
    setBusy(`${action}:${property.id}`)
    setActionError(null)
    try {
      await act({ action, property_id: property.id })
      refetch()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const lastCall = (p: PropertyRow) => p.calls?.[0]

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Properties</h1>
      <p className="mt-1 text-[13px] text-ink-muted">
        BRRR candidates from the Rightmove scraper — Elsie calls the estate agent to qualify them
      </p>
      {error && <AdminError error={error} />}
      {actionError && <AdminError error={actionError} />}

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Properties" value={loading ? '...' : properties.length} icon={<Home size={16} />} />
        <MetricCard label="Awaiting / In call" value={loading ? '...' : awaiting} icon={<PhoneOutgoing size={16} />} />
        <MetricCard label="Qualified" value={loading ? '...' : qualified} icon={<BadgeCheck size={16} />} />
      </div>

      <div className="mt-6">
        <DataTable
          columns={[
            {
              key: 'property',
              header: 'Property',
              render: (p) => (
                <div>
                  <div className="font-medium text-ink">{p.address || `Rightmove ${p.source_property_id}`}</div>
                  <div className="text-[12px] text-ink-muted">
                    {p.bedrooms ?? '?'} bed · {p.property_type || 'Unknown'}
                    {p.days_on_market ? ` · ${p.days_on_market} days listed` : ''}
                    {p.listing_url && (
                      <a
                        href={p.listing_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-1.5 inline-flex items-center gap-0.5 text-brand hover:underline"
                      >
                        Rightmove <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
              ),
            },
            {
              key: 'numbers',
              header: 'Numbers',
              render: (p) => (
                <div className="text-[12px]">
                  <div className="font-medium text-ink">{p.price_text || gbp(p.asking_price)}</div>
                  <div className="text-ink-muted">
                    Offer {gbp(p.deal?.offer_price)} · GDV {gbp(p.deal?.gdv)}
                  </div>
                </div>
              ),
            },
            {
              key: 'agent',
              header: 'Agent',
              render: (p) => (
                <div className="text-[12px]">
                  <div className="text-ink">{p.agent_name || '—'}</div>
                  <div className="text-ink-muted">{p.agent_phone || 'no phone'}</div>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (p) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLES[p.status] || 'bg-elevated text-ink-muted'}`}>
                  {p.status.replace(/_/g, ' ')}
                </span>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (p) => (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => run('call', p)}
                    disabled={busy !== null || !p.agent_phone || ['call_queued', 'calling'].includes(p.status)}
                    className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    {busy === `call:${p.id}` ? 'Queuing…' : p.status === 'call_queued' ? 'Queued' : p.status === 'calling' ? 'Calling…' : 'Call agent'}
                  </button>
                  {!p.deal_id && (
                    <button
                      onClick={() => run('push_to_pipeline', p)}
                      disabled={busy !== null}
                      className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-ink-muted transition hover:bg-elevated disabled:opacity-40"
                    >
                      {busy === `push_to_pipeline:${p.id}` ? '…' : 'To pipeline'}
                    </button>
                  )}
                </div>
              ),
            },
          ]}
          data={properties}
          keyExtractor={(p) => p.id}
          onRowClick={(p) => setSelected(p)}
          emptyMessage="No properties yet — use the Send to Elsie button on the scraper's Comps tab"
        />
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onClick={() => setSelected(null)}>
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface p-5 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-ink">{selected.address || selected.source_property_id}</h2>
                <p className="text-[12px] text-ink-muted">
                  {selected.price_text} · {selected.bedrooms ?? '?'} bed {selected.property_type || ''}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-ink-muted hover:text-ink"><X size={18} /></button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Asking', selected.price_text || gbp(selected.asking_price)],
                ['Offer', gbp(selected.deal?.offer_price)],
                ['GDV', gbp(selected.deal?.gdv)],
                ['Rent /mo', gbp(selected.deal?.rent)],
                ['Refurb', gbp(selected.deal?.refurb)],
                ['Cash needed', gbp(selected.deal?.total_cash)],
                ['Comps', String((selected as PropertyRow & { comps?: unknown[] }).comps?.length ?? '—')],
                ['Floor plans', String(selected.floorplan_urls?.length || 0)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-ink">{value}</p>
                </div>
              ))}
            </div>

            {(selected.deal?.verdict as string) && (
              <p className="mt-3 rounded-lg bg-elevated p-3 text-[12px] text-ink">{String(selected.deal.verdict)}</p>
            )}

            {selected.floorplan_urls?.length > 0 && (
              <div className="mt-4 flex gap-2 overflow-x-auto">
                {selected.floorplan_urls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={url} alt="Floor plan" className="h-32 rounded-lg border border-border object-contain" />
                  </a>
                ))}
              </div>
            )}

            {Object.keys(selected.qualification || {}).length > 0 && (
              <div className="mt-4">
                <h3 className="text-[13px] font-semibold text-ink">Qualification</h3>
                <div className="mt-2 space-y-1.5 rounded-lg border border-border p-3 text-[12px]">
                  {Object.entries(selected.qualification)
                    .filter(([, v]) => v !== null && v !== '')
                    .map(([k, v]) => (
                      <p key={k}>
                        <span className="font-medium capitalize text-ink">{k.replace(/_/g, ' ')}:</span>{' '}
                        <span className="text-ink-muted">{String(v)}</span>
                      </p>
                    ))}
                </div>
              </div>
            )}

            {lastCall(selected) && (
              <div className="mt-4">
                <h3 className="text-[13px] font-semibold text-ink">
                  Last call · {lastCall(selected)!.status} · attempt {lastCall(selected)!.attempts}
                </h3>
                {lastCall(selected)!.recording_url && (
                  <audio controls src={lastCall(selected)!.recording_url!} className="mt-2 w-full" />
                )}
                {lastCall(selected)!.summary && (
                  <p className="mt-2 text-[12px] text-ink-muted">{lastCall(selected)!.summary}</p>
                )}
                {(lastCall(selected)!.transcript || []).length > 0 && (
                  <div className="mt-2 max-h-60 space-y-1.5 overflow-y-auto rounded-lg border border-border p-3">
                    {lastCall(selected)!.transcript!.map((t, i) => (
                      <p key={i} className="text-[12px]">
                        <span className={`font-semibold ${t.speaker === 'agent' ? 'text-brand' : 'text-ink'}`}>
                          {t.speaker === 'agent' ? 'Elsie' : 'Agent'}:
                        </span>{' '}
                        <span className="text-ink-muted">{t.text}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
