import { useEffect, useState } from 'react'
import { ExternalLink, Search, LayoutGrid, Star, Calculator, CircleDot } from 'lucide-react'

/**
 * Embeds Hugo's Rightmove scraper inside the admin panel so the whole BRRR
 * workflow — search → floor plans → shortlist → comps → send to Elsie — lives
 * in one app.
 *
 * It used to run on Hugo's Mac at http://127.0.0.1:5050, so it only worked at
 * his desk and only while the Mac was awake. It now runs on margarita-server
 * under systemd, behind nginx with a password, at https://scraper.heyelsie.com.
 *
 * Two consequences that shape this page:
 *
 *  1. The status ping hits /api/floorplans/stats, which nginx deliberately
 *     leaves un-gated (it returns four integers and nothing else). Every other
 *     path needs the password, so the badge can stay honest without shipping a
 *     credential to the browser.
 *
 *  2. Browsers refuse to show a password prompt inside a cross-origin iframe.
 *     So the first visit has to happen in a real tab — hence "Open scraper"
 *     being a real button rather than a courtesy link. Once that origin is
 *     authenticated the browser reuses it and the embed below fills in.
 */
const SCRAPER_URL = import.meta.env.VITE_SCRAPER_URL || 'https://scraper.heyelsie.com'

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
              {online ? 'Running on the server' : online === false ? 'Offline' : 'Checking…'}
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
          className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[12px] font-medium text-white transition hover:opacity-90"
        >
          Open scraper <ExternalLink size={13} />
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

      {online && (
        <p className="mt-2 text-[12px] text-ink-muted">
          Asks for a password the first time. Use <strong>Open scraper</strong> above, sign in once,
          then it loads here too.
        </p>
      )}

      <div className="mt-3 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
        {online === false ? (
          <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-[14px] font-semibold text-ink">Scraper is offline</p>
            <p className="max-w-md text-[13px] text-ink-muted">
              It runs on the server (margarita-server) and restarts itself, so this should be rare.
              To check: <code className="rounded bg-elevated px-1">systemctl status margarita-scraper</code>
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
