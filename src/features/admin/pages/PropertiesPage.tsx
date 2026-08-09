import { useEffect, useState } from 'react'
import { Home, PhoneOutgoing, BadgeCheck, ExternalLink, X, Settings2, Phone } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { MetricCard } from '../components/MetricCard'
import { AdminError } from '../components/AdminError'
import { useAdminApi, useAdminMutation } from '../hooks/useAdminApi'
// The SAME offer maths the dial cron and Pedro's dialer use. Pure module, safe
// to import into the browser (api/lib/brrr.ts itself is not — it builds a
// Supabase client at import time).
import { offerRange } from '../../../../api/lib/brrr-offer'
import DealCalculator from '../components/DealCalculator'

interface PropertyCall {
  id: string
  status: string
  attempts: number
  next_attempt_at: string | null
  summary: string | null
  qualification: Record<string, unknown> | null
  transcript: Array<{ speaker: string; text: string }> | null
  recording_url?: string | null
  cost_usd?: number | null
  created_at: string
  updated_at: string
}

interface CompRow {
  comp_type: string
  address: string
  price: string
  bedrooms: string
  date_info: string
  distance_label: string
  url?: string
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
  comps: CompRow[]
  deal: Record<string, unknown>
  status: string
  qualification: Record<string, unknown>
  notes: string | null
  deal_id: string | null
  created_at: string
  calls: PropertyCall[]
}

interface BrrrSettings {
  auto_queue_on_ingest: boolean
  max_attempts: number
  retry_hours: number
  max_dials_per_run: number
  call_days: string[]
  call_start: string
  call_end: string
  offer_low_pct: number
  offer_high_pct: number
}

interface PropertiesResponse {
  properties: PropertyRow[]
  settings: BrrrSettings | null
}

// Mirrors QUALIFICATION_QUESTIONS in api/lib/brrr.ts — what Elsie asks on the call.
const QUESTIONS: Array<{ key: string; label: string }> = [
  { key: 'still_available', label: 'Is the property still available?' },
  { key: 'occupancy', label: 'Vacant or tenanted?' },
  { key: 'condition_notes', label: 'Condition / works needed?' },
  { key: 'interest_level', label: 'Viewings / offers so far?' },
  { key: 'fallen_through', label: 'Has a sale fallen through before?' },
  { key: 'why_selling', label: 'Why is the vendor selling?' },
  { key: 'motivation', label: 'How motivated is the vendor?' },
  { key: 'chain', label: 'Onward chain?' },
  { key: 'tenure', label: 'Freehold or leasehold?' },
  { key: 'lease_years', label: 'Years left on the lease? (flats)' },
  { key: 'service_charge', label: 'Service charge? (flats)' },
  { key: 'ground_rent', label: 'Ground rent? (flats)' },
  { key: 'major_works', label: 'Major works / cladding issues? (flats)' },
  { key: 'offer_reaction', label: 'How did the offer feeler land?' },
  { key: 'best_price_indicated', label: 'Figure the agent hinted would work?' },
  { key: 'viewing_availability', label: 'When can viewings happen?' },
]

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-elevated text-ink-muted',
  call_queued: 'bg-blue-500/10 text-blue-600',
  calling: 'bg-violet-500/10 text-violet-600',
  qualified: 'bg-success/10 text-success',
  not_qualified: 'bg-danger/10 text-danger',
  no_answer: 'bg-amber-500/10 text-amber-600',
  callback: 'bg-cyan-500/10 text-cyan-600',
}

// Qualified first (Hugo's action), live calls next, dead ends at the bottom.
const STATUS_ORDER: Record<string, number> = {
  qualified: 0, calling: 1, call_queued: 2, callback: 3, new: 4, no_answer: 5, not_qualified: 6,
}

function gbp(v: unknown): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  if (!isFinite(n) || n <= 0) return '—'
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// The offer band used to be re-implemented here, a hand-copy of offerRange in
// api/lib/brrr.ts that had to be kept in step by hand. It is now the same
// function, imported above — see api/lib/brrr-offer.ts for why the offer is a
// percentage of what the property is worth today and never of GDV.

export default function PropertiesPage() {
  const { data, loading, error, refetch } = useAdminApi<PropertiesResponse | PropertyRow[]>('properties', { properties: [], settings: null })
  const act = useAdminMutation('properties', 'POST')
  const [selected, setSelected] = useState<PropertyRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [draft, setDraft] = useState<BrrrSettings | null>(null)

  // Tolerate both response shapes so a stale cached bundle never blanks the page.
  const resp: PropertiesResponse = Array.isArray(data)
    ? { properties: data, settings: null }
    : (data || { properties: [], settings: null })

  const properties = [...(resp.properties || [])].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
      || (b.created_at || '').localeCompare(a.created_at || ''),
  )
  const settings = resp.settings

  useEffect(() => {
    if (settings && !draft) setDraft(settings)
  }, [settings, draft])

  const qualified = properties.filter((p) => p.status === 'qualified').length
  const awaiting = properties.filter((p) => ['new', 'call_queued', 'calling'].includes(p.status)).length
  const totalCostUsd = properties.flatMap((p) => p.calls || []).reduce((sum, c) => sum + (Number(c.cost_usd) || 0), 0)

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

  async function saveSettings() {
    if (!draft) return
    setBusy('settings')
    setActionError(null)
    try {
      await act({ action: 'save_settings', settings: draft })
      setShowSettings(false)
      refetch()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  const lastCall = (p: PropertyRow) => p.calls?.[0]

  function numField(label: string, key: keyof BrrrSettings, suffix?: string) {
    if (!draft) return null
    return (
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</span>
        <div className="mt-1 flex items-center gap-1.5">
          <input
            type="number"
            value={Number(draft[key])}
            onChange={(e) => setDraft({ ...draft, [key]: parseFloat(e.target.value) || 0 })}
            className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-ink"
          />
          {suffix && <span className="text-[12px] text-ink-muted">{suffix}</span>}
        </div>
      </label>
    )
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Properties</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            BRRR candidates from the scraper — a human agent rings the branch from the CRM dialer
          </p>
        </div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
        >
          <Settings2 size={14} /> Offer rules
        </button>
      </div>
      {error && <AdminError error={error} />}
      {actionError && <AdminError error={actionError} />}

      {showSettings && draft && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          {/* Attempts, retry gap, dials per run, auto-call on send, calling
              hours and calling days used to live here. Every one of them was
              read only by the AI qualifier's dial cron, deleted 2026-08-09, so
              they were controls that changed nothing. The two offer
              percentages below are the only settings still wired to anything:
              the dialer's offer strip reads them through
              wk_property_agent_listings. */}
          <h2 className="text-[13px] font-semibold text-ink">Offer rules — the fallback band when a property has no valuation</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {numField('Offer from', 'offer_low_pct', '% of asking')}
            {numField('Offer up to', 'offer_high_pct', '% of asking')}
          </div>
          <p className="mt-2 text-[11px] text-ink-subtle">
            Offer figures normally come from the scraper's valuation engine (a % of the property's worth-now value from sold comps).
            The two percentages here are only the fallback when a property arrives without a valuation.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={saveSettings}
              disabled={busy === 'settings'}
              className="rounded-md bg-brand px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {busy === 'settings' ? 'Saving…' : 'Save rules'}
            </button>
            <button
              onClick={() => { setDraft(settings); setShowSettings(false) }}
              className="rounded-md border border-border px-3.5 py-1.5 text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <MetricCard label="Properties" value={loading ? '...' : properties.length} icon={<Home size={16} />} />
        <MetricCard label="Awaiting / In call" value={loading ? '...' : awaiting} icon={<PhoneOutgoing size={16} />} />
        <MetricCard label="Qualified" value={loading ? '...' : qualified} icon={<BadgeCheck size={16} />} />
        <MetricCard label="AI call spend" value={loading ? '...' : `$${totalCostUsd.toFixed(2)}`} change="+ phone charges" trend="neutral" />
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
              render: (p) => {
                const band = offerRange(p, settings)
                return (
                  <div className="text-[12px]">
                    <div className="font-medium text-ink">{p.price_text || gbp(p.asking_price)}</div>
                    <div className="text-ink-muted">
                      Offer {gbp(band.min)}–{gbp(band.max)} · GDV {gbp(p.deal?.gdv)}
                    </div>
                  </div>
                )
              },
            },
            {
              key: 'agent',
              header: 'Agent',
              render: (p) => (
                <div className="text-[12px]">
                  <div className="text-ink">{p.agent_name || '—'}</div>
                  {p.agent_phone ? (
                    <a
                      href={`tel:${p.agent_phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-brand hover:underline"
                    >
                      <Phone size={11} /> {p.agent_phone}
                    </a>
                  ) : (
                    <span className="text-ink-muted">no phone</span>
                  )}
                </div>
              ),
            },
            {
              key: 'callstats',
              header: 'Call stats',
              render: (p) => {
                const call = lastCall(p)
                if (!call) return <span className="text-[12px] text-ink-muted">Not called yet</span>
                const next = call.status === 'pending' ? fmtWhen(call.next_attempt_at) : null
                return (
                  <div className="text-[12px]">
                    <div className="text-ink">Tried {call.attempts || 0}× · last {fmtWhen(call.updated_at)}</div>
                    <div className="text-ink-muted">{next ? `Next call ${next}` : (call.summary ? call.summary.slice(0, 48) : '—')}</div>
                  </div>
                )
              },
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
                  {/* The dial button is gone. It queued an AI qualifier call,
                      retired 2026-08-09. Estate agents are rung by a human in
                      the CRM dialer instead. */}
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
                  {selected.agent_phone && (
                    <a href={`tel:${selected.agent_phone}`} className="ml-2 inline-flex items-center gap-1 text-brand hover:underline">
                      <Phone size={11} /> {selected.agent_name || selected.agent_phone}
                    </a>
                  )}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-ink-muted hover:text-ink"><X size={18} /></button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(() => {
                const band = offerRange(selected, settings)
                return [
                  ['Asking', selected.price_text || gbp(selected.asking_price)],
                  ['AI offer range', `${gbp(band.min)}–${gbp(band.max)}`],
                  ['GDV', gbp(selected.deal?.gdv)],
                  ['Rent /mo', gbp(selected.deal?.rent)],
                  ['Refurb', gbp(selected.deal?.refurb)],
                  ['Cash needed', gbp(selected.deal?.total_cash)],
                  ['Comps', String(selected.comps?.length ?? 0)],
                  ['Floor plans', String(selected.floorplan_urls?.length || 0)],
                ] as Array<[string, string]>
              })().map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-ink">{value}</p>
                </div>
              ))}
            </div>

            {(selected.deal?.verdict as string) && (
              <p className="mt-3 rounded-lg bg-elevated p-3 text-[12px] text-ink">{String(selected.deal.verdict)}</p>
            )}

            {/* Does it stack, and how much cash. Starts from this property's
                real figures: what we would offer, what the comps say it is
                worth, and the local rent. Hugo's tool, not the agent's. */}
            <div className="mt-4">
              {(() => {
                const band = offerRange(selected, settings)
                const num = (v: unknown) => parseFloat(String(v ?? '')) || 0
                return (
                  <DealCalculator
                    defaultPurchase={band.max}
                    defaultMarketValue={num(selected.deal?.cmv) || num(selected.asking_price)}
                    defaultRent={num(selected.deal?.rent)}
                    engineTotalCash={num(selected.deal?.total_cash) || null}
                    engineVerdict={(selected.deal?.stack_verdict as string) ?? null}
                  />
                )
              })()}
            </div>

            {selected.floorplan_urls?.length > 0 && (
              <div className="mt-4 flex gap-2 overflow-x-auto">
                {selected.floorplan_urls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={url} alt="Floor plan" className="h-32 rounded-lg border border-border object-contain" />
                  </a>
                ))}
              </div>
            )}

            <div className="mt-4">
              <h3 className="text-[13px] font-semibold text-ink">Qualification — questions &amp; answers</h3>
              <div className="mt-2 space-y-1.5 rounded-lg border border-border p-3">
                {QUESTIONS.map(({ key, label }) => {
                  const raw = (selected.qualification || {})[key]
                  const answered = raw !== null && raw !== undefined && raw !== ''
                  const value = typeof raw === 'boolean' ? (raw ? 'Yes' : 'No') : String(raw ?? '')
                  return (
                    <div key={key} className="flex items-start justify-between gap-3 text-[12px]">
                      <span className="text-ink">{label}</span>
                      {answered ? (
                        <span className="max-w-[55%] text-right text-ink-muted">{value}</span>
                      ) : (
                        <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-600">Not answered</span>
                      )}
                    </div>
                  )
                })}
                {(selected.qualification?.summary as string) && (
                  <p className="mt-2 border-t border-border pt-2 text-[12px] text-ink-muted">{String(selected.qualification.summary)}</p>
                )}
              </div>
            </div>

            {(selected.comps || []).length > 0 && (
              <div className="mt-4">
                <h3 className="text-[13px] font-semibold text-ink">Comparables</h3>
                <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border p-3">
                  {(['sale_same', 'sale_target', 'sale', 'rent'] as const).flatMap((type) =>
                    (selected.comps || []).filter((c) => c.comp_type === type).map((c, i) => (
                      <div key={`${type}-${i}`} className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="min-w-0 truncate text-ink-muted">
                          <span className={`mr-1.5 rounded px-1 py-0.5 text-[10px] font-semibold uppercase ${type === 'rent' ? 'bg-cyan-500/10 text-cyan-600' : 'bg-violet-500/10 text-violet-600'}`}>
                            {type === 'rent' ? 'Rent' : type === 'sale_same' ? 'Sold (same bed)' : 'Sold (target bed)'}
                          </span>
                          {c.address} {c.distance_label ? `· ${c.distance_label}` : ''} {c.date_info ? `· ${c.date_info}` : ''}
                        </span>
                        <span className="shrink-0 font-semibold text-ink">{c.price}</span>
                      </div>
                    )),
                  )}
                </div>
              </div>
            )}

            {(selected.calls || []).length > 0 && (
              <div className="mt-4">
                <h3 className="text-[13px] font-semibold text-ink">Calls ({selected.calls.length})</h3>
                {selected.calls.map((call) => (
                  <div key={call.id} className="mt-2 rounded-lg border border-border p-3">
                    <p className="text-[12px] font-medium text-ink">
                      {fmtWhen(call.created_at)} · {call.status.replace(/_/g, ' ')} · attempt {call.attempts}
                      {call.status === 'pending' && call.next_attempt_at ? ` · next try ${fmtWhen(call.next_attempt_at)}` : ''}
                      {Number(call.cost_usd) > 0 ? ` · $${Number(call.cost_usd).toFixed(2)}` : ''}
                    </p>
                    {call.recording_url && <audio controls src={call.recording_url} className="mt-2 w-full" />}
                    {call.summary && <p className="mt-1.5 text-[12px] text-ink-muted">{call.summary}</p>}
                    {(call.transcript || []).length > 0 && (
                      <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-md bg-elevated/50 p-2.5">
                        {call.transcript!.map((t, i) => (
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
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
