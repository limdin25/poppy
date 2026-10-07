import { useMemo, useState } from 'react'
import { Coins, TriangleAlert } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAdminApi } from '../hooks/useAdminApi'
import { AdminError } from '../components/AdminError'
import { MultiSelect } from '../components/MultiSelect'
import { CostChart } from '../components/CostChart'
import { PricesPanel } from '../components/PricesPanel'
import {
  PRESETS, bucketLabel, buildBuckets, daysBetween, gbp, londonToday, presetRange, stackSeries, tokens, usd,
  type Bucket, type CostOverview, type PresetKey,
} from '../lib/aiCosts'

const num = (n: number) => n.toLocaleString('en-GB')
const share = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0)

function usageText(input: number, output: number, units: number): string {
  if (units > 0 && input === 0 && output === 0) return `${units.toFixed(1)} min of audio`
  const text = `${tokens(input)} in, ${tokens(output)} out`
  return units > 0 ? `${text}, ${units.toFixed(1)} min` : text
}

const chip = 'rounded-lg px-3 py-1.5 text-[12px] font-medium transition'

export default function AICostsPage() {
  const today = useMemo(() => londonToday(), [])
  const [preset, setPreset] = useState<PresetKey>('today')
  const [range, setRange] = useState<{ from: string; to: string }>({ from: today, to: today })
  const [bucket, setBucket] = useState<Bucket>('hour')
  const [providers, setProviders] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [features, setFeatures] = useState<string[]>([])
  const [pricesOpen, setPricesOpen] = useState(false)
  const [reload, setReload] = useState(0)

  const query = new URLSearchParams({ from: range.from, to: range.to, bucket })
  if (providers.length) query.set('providers', providers.join(','))
  if (models.length) query.set('models', models.join(','))
  if (features.length) query.set('features', features.join(','))

  const { data, loading, error } = useAdminApi<CostOverview | null>(`ai/costs?${query}`, null, [query.toString(), reload])

  const choose = (key: Exclude<PresetKey, 'custom'>) => {
    const next = presetRange(key, today)
    setPreset(key); setRange({ from: next.from, to: next.to }); setBucket(next.bucket)
  }
  const custom = (from: string, to: string) => {
    if (!from || !to || to < from) return
    setPreset('custom'); setRange({ from, to })
    setBucket(daysBetween(from, to) <= 2 ? 'hour' : 'day')
  }
  const filtered = providers.length + models.length + features.length > 0
  const rate = data?.usd_to_gbp ?? null
  const shownBucket: Bucket = data?.bucket ?? bucket

  const stack = useMemo(
    () => (data ? stackSeries(data.series, buildBuckets(data.from, data.to, data.bucket), data.bucket) : null),
    [data],
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10">
          <Coins size={18} className="text-brand" />
        </div>
        <div>
          <h1 className="text-[17px] font-bold text-ink">AI Costs</h1>
          <p className="text-[12px] text-ink-muted">What every model and speech service costs, by hour, day, model and job. Dollars, because that is what they bill in.</p>
        </div>
      </div>

      {error && <AdminError error={error} />}

      {data && (
        <div className="space-y-2">
          {data.first_recorded && (
            <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-[12px] text-ink-muted">
              Costs are recorded from {bucketLabel(data.first_recorded.slice(0, 10), 'day')} {data.first_recorded.slice(0, 4)}. Nothing before then counted tokens, so earlier days are blank.
            </p>
          )}
          {!data.first_recorded && (
            <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-[12px] text-ink-muted">Nothing has been recorded yet. The first AI call after this went live will appear here.</p>
          )}
          {data.totals.unpriced > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[12px] text-ink">
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" />
              <span>
                {num(data.totals.unpriced)} calls have no price, so they show as $0. The real cost is higher.{' '}
                <button type="button" onClick={() => setPricesOpen(true)} className="font-medium text-brand underline">Set the prices</button>
              </span>
            </p>
          )}
          {data.totals.fallbacks > 0 && (
            <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-[12px] text-ink-muted">
              {num(data.totals.fallbacks)} calls were answered by a different model than the one asked for, usually because the first one was out of credit or gave nothing. They are listed under the model that really answered.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading && !data
          ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[78px] rounded-xl skeleton" />)
          : data && ([
            ['Today', data.periods.today], ['Yesterday', data.periods.yesterday], ['Last 7 days', data.periods.last7],
            ['This month', data.periods.month], ['Month at this pace', data.periods.projected_month],
          ] as const).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-surface p-3.5 shadow-soft">
              <p className="text-[11px] font-medium text-ink-muted">{label}</p>
              <p className="text-[18px] font-bold tabular-nums text-ink">{usd(value)}</p>
              {gbp(value, rate) && <p className="text-[10px] tabular-nums text-ink-subtle">{gbp(value, rate)}</p>}
            </div>
          ))}
      </div>
      {data && filtered && <p className="-mt-3 text-[11px] text-ink-subtle">These five follow the model, provider and job filters below.</p>}

      <div className="space-y-3 rounded-xl border border-border bg-surface p-3.5 shadow-soft">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => choose(p.key)} aria-pressed={preset === p.key}
              className={cn(chip, preset === p.key ? 'bg-brand text-white' : 'bg-elevated text-ink-muted hover:bg-brand/10')}>{p.label}</button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">From
            <input type="date" max={today} value={range.from} onChange={(e) => custom(e.target.value, range.to)} className="rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-ink" />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">to
            <input type="date" max={today} value={range.to} onChange={(e) => custom(range.from, e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1 text-[12px] text-ink" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Bar size">
            {(['hour', 'day'] as const).map((b) => (
              <button key={b} type="button" onClick={() => setBucket(b)} aria-pressed={bucket === b}
                className={cn(chip, bucket === b ? 'bg-ink text-surface' : 'bg-elevated text-ink-muted hover:bg-brand/10')}>{b === 'hour' ? 'By hour' : 'By day'}</button>
            ))}
          </div>
          <MultiSelect label="Provider" options={data?.options.providers ?? []} selected={providers} onChange={setProviders} />
          <MultiSelect label="Model" options={data?.options.models ?? []} selected={models} onChange={setModels} />
          <MultiSelect label="Job" options={data?.options.features ?? []} selected={features} onChange={setFeatures} />
          {filtered && (
            <button type="button" onClick={() => { setProviders([]); setModels([]); setFeatures([]) }} className="text-[12px] font-medium text-brand underline">Clear filters</button>
          )}
        </div>
        {data?.bucket_forced && <p className="text-[11px] text-ink-muted">That is too many days to show hour by hour (31 at most), so it is shown by day.</p>}
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ['Spend', usd(data.totals.cost), gbp(data.totals.cost, rate)],
              ['Calls', num(data.totals.calls), data.totals.errors ? `${num(data.totals.errors)} failed` : ''],
              ['Tokens in', tokens(data.totals.input_tokens), data.totals.cached_tokens ? `${tokens(data.totals.cached_tokens)} from cache` : ''],
              ['Tokens out', tokens(data.totals.output_tokens), 'answers and thinking'],
              ['Audio', `${data.totals.units.toFixed(1)} min`, 'transcription'],
            ].map(([label, value, sub]) => (
              <div key={label} className="rounded-xl border border-border bg-surface p-3.5 shadow-soft">
                <p className="text-[11px] font-medium text-ink-muted">{label}</p>
                <p className="text-[17px] font-bold tabular-nums text-ink">{value}</p>
                {sub && <p className="text-[10px] text-ink-subtle">{sub}</p>}
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-border bg-surface p-3.5 shadow-soft">
            <p className="mb-3 text-[13px] font-semibold text-ink">Spend by {shownBucket}, split by model</p>
            {stack && data.totals.calls > 0
              ? <CostChart rows={stack.rows} models={stack.models} max={stack.max} bucket={shownBucket} rate={rate} />
              : <p className="py-10 text-center text-[12px] text-ink-muted">Nothing was recorded for these dates and filters.</p>}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
              <p className="border-b border-border p-3 text-[13px] font-semibold text-ink">By model</p>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[440px] text-left text-[12px]">
                  <thead><tr className="border-b border-border text-[11px] text-ink-muted"><th className="p-2 font-medium">Model</th><th className="p-2 text-right font-medium">Calls</th><th className="p-2 font-medium">Used</th><th className="p-2 text-right font-medium">Cost</th></tr></thead>
                  <tbody>
                    {data.by_model.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-ink-muted">Nothing recorded.</td></tr>}
                    {data.by_model.map((m) => (
                      <tr key={`${m.provider}|${m.model}`} className="border-b border-border/60 align-top">
                        <td className="p-2"><span className="block break-words text-ink">{m.model}</span>
                          <span className="block text-[10px] text-ink-subtle">{m.provider}{m.errors > 0 && <span className="text-danger">, {num(m.errors)} failed</span>}{m.unpriced > 0 && <span className="text-warning">, no price</span>}</span></td>
                        <td className="p-2 text-right tabular-nums text-ink-muted">{num(m.calls)}</td>
                        <td className="p-2 text-ink-muted">{usageText(m.input_tokens, m.output_tokens, m.units)}</td>
                        <td className="p-2 text-right"><span className="tabular-nums font-medium text-ink">{usd(m.cost)}</span>
                          <span className="mt-1 block h-1 rounded bg-elevated"><span className="block h-1 rounded bg-brand" style={{ width: `${share(m.cost, data.totals.cost)}%` }} /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
              <p className="border-b border-border p-3 text-[13px] font-semibold text-ink">By job</p>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[440px] text-left text-[12px]">
                  <thead><tr className="border-b border-border text-[11px] text-ink-muted"><th className="p-2 font-medium">Job</th><th className="p-2 text-right font-medium">Calls</th><th className="p-2 font-medium">Used</th><th className="p-2 text-right font-medium">Cost</th></tr></thead>
                  <tbody>
                    {data.by_feature.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-ink-muted">Nothing recorded.</td></tr>}
                    {data.by_feature.map((f) => (
                      <tr key={f.feature} className="border-b border-border/60 align-top">
                        <td className="p-2 text-ink">{f.feature}</td>
                        <td className="p-2 text-right tabular-nums text-ink-muted">{num(f.calls)}</td>
                        <td className="p-2 text-ink-muted">{usageText(f.input_tokens, f.output_tokens, f.units)}</td>
                        <td className="p-2 text-right"><span className="tabular-nums font-medium text-ink">{usd(f.cost)}</span>
                          <span className="mt-1 block h-1 rounded bg-elevated"><span className="block h-1 rounded bg-brand" style={{ width: `${share(f.cost, data.totals.cost)}%` }} /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.by_provider.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-border p-3">
                  {data.by_provider.map((p) => (
                    <span key={p.provider} className="rounded-full bg-elevated px-2.5 py-1 text-[11px] text-ink-muted">
                      {p.provider} <span className="font-semibold tabular-nums text-ink">{usd(p.cost)}</span>
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-soft">
            <p className="border-b border-border p-3 text-[13px] font-semibold text-ink">Latest calls <span className="font-normal text-ink-muted">(up to 50, newest first, London time)</span></p>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead><tr className="border-b border-border text-[11px] text-ink-muted"><th className="p-2 font-medium">When</th><th className="p-2 font-medium">Job</th><th className="p-2 font-medium">Model</th><th className="p-2 font-medium">Used</th><th className="p-2 text-right font-medium">Cost</th><th className="p-2 font-medium">Result</th></tr></thead>
                <tbody>
                  {data.recent.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-ink-muted">Nothing recorded.</td></tr>}
                  {data.recent.map((r, i) => (
                    <tr key={`${r.at}-${i}`} className="border-b border-border/60 align-top">
                      <td className="whitespace-nowrap p-2 tabular-nums text-ink-muted">{r.at.slice(5, 10).split('-').reverse().join('/')} {r.at.slice(11)}</td>
                      <td className="p-2 text-ink">{r.feature}</td>
                      <td className="p-2"><span className="block break-words text-ink">{r.model}</span>{r.requested_model && <span className="block text-[10px] text-ink-subtle">asked for {r.requested_model}</span>}</td>
                      <td className="p-2 text-ink-muted">{usageText(r.input_tokens, r.output_tokens, r.units)}</td>
                      <td className="p-2 text-right tabular-nums text-ink">{usd(r.cost)}</td>
                      <td className="p-2">{!r.ok ? <span className="text-danger">failed</span> : !r.priced ? <span className="text-warning">no price</span> : <span className="text-ink-subtle">ok</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <PricesPanel open={pricesOpen} onToggle={() => setPricesOpen(!pricesOpen)} onChanged={() => setReload((n) => n + 1)} since={data?.first_recorded?.slice(0, 10) ?? today} />

      <p className="text-[11px] leading-relaxed text-ink-subtle">
        Counted: every call that goes through the shared AI helper (the daily reports, all the House desk tools, the inbox and training tools), the live call coach (OpenAI and Jev),
        after-call transcripts (AssemblyAI) and the WhatsApp assistant. Calls the coach cancels part way are estimated from the size of the prompt and are marked as estimates in the log.
        Not counted yet: Twilio's own charges, Retell, the voice invoice and onboarding buttons, and the overnight property reader on the VPS.
      </p>
    </div>
  )
}
