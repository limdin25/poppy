import { useEffect, useState } from 'react'
import { ExternalLink, Search, LayoutGrid, Star, Calculator, CircleDot } from 'lucide-react'

/**
 * Embeds Hugo's local Rightmove scraper (launchd service on his Mac,
 * http://127.0.0.1:5050) inside the admin panel so the whole BRRR workflow —
 * search → floor plans → shortlist → comps → send to Elsie — lives in one app.
 * Only works on Hugo's computer; anywhere else it shows an offline notice.
 */
const SCRAPER_URL = 'http://127.0.0.1:5050'

const TABS = [
  { key: 'rightmove', label: 'Search', path: '/rightmove', icon: Search, hint: 'Run Rightmove scrapes' },
  { key: 'floorplans', label: 'Floor plans', path: '/floorplans', icon: LayoutGrid, hint: 'Review plans — Potential / Skip' },
  { key: 'shortlist', label: 'Shortlist', path: '/shortlist', icon: Star, hint: 'Everything marked Potential' },
  { key: 'comps', label: 'Comps & Send', path: '/comps', icon: Calculator, hint: 'Deal numbers + Send to Elsie' },
]

interface ScraperStats {
  potential: number
  skipped: number
  total: number
  unreviewed: number
}

export default function ScraperPage() {
  const [online, setOnline] = useState<boolean | null>(null)
  const [stats, setStats] = useState<ScraperStats | null>(null)
  const [tab, setTab] = useState(TABS[3]) // Comps is the everyday tab

  useEffect(() => {
    let cancelled = false
    async function ping() {
      try {
        const res = await fetch(`${SCRAPER_URL}/api/floorplans/stats`, { signal: AbortSignal.timeout(4000) })
        const json = await res.json()
        if (!cancelled) { setOnline(true); setStats(json) }
      } catch {
        if (!cancelled) setOnline(false)
      }
    }
    ping()
    const id = setInterval(ping, 30000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div className="flex h-full min-h-[80vh] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            Scraper
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${online ? 'bg-success/10 text-success' : online === false ? 'bg-danger/10 text-danger' : 'bg-elevated text-ink-muted'}`}>
              <CircleDot size={10} />
              {online ? 'Running on this Mac' : online === false ? 'Offline' : 'Checking…'}
            </span>
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {stats
              ? `${stats.potential} potential · ${stats.unreviewed} to review · ${stats.total} with floor plans`
              : 'Rightmove search → floor plans → shortlist → comps → Send to Elsie'}
          </p>
        </div>
        <a
          href={`${SCRAPER_URL}${tab.path}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
        >
          Open full page <ExternalLink size={13} />
        </a>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = t.key === tab.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t)}
              title={t.hint}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${active ? 'bg-brand text-white' : 'bg-elevated text-ink-muted hover:text-ink'}`}
            >
              <Icon size={13} /> {t.label}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
        {online === false ? (
          <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-[14px] font-semibold text-ink">Scraper is offline</p>
            <p className="max-w-md text-[13px] text-ink-muted">
              The scraper runs only on Hugo's Mac (it starts automatically when the Mac is on).
              If you're on the Mac and seeing this, the service may need a restart.
            </p>
          </div>
        ) : (
          <iframe
            key={tab.key}
            src={`${SCRAPER_URL}${tab.path}`}
            title={`Scraper — ${tab.label}`}
            className="h-full min-h-[70vh] w-full"
          />
        )}
      </div>
    </div>
  )
}
