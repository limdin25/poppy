// Sidebar business switcher (top-left). Lists every business the user belongs to,
// switches the active one (persisted server-side on the profile), and links to
// the Add-Business wizard. Hidden in admin "view as client" mode.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Check, Plus } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { reviewsApi, type ReviewsSession } from '../lib'

interface BizRow { id: string; name: string; addressLine: string | null; avatarInitials: string; isActive: boolean }

function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <div className={cn('grid shrink-0 place-items-center rounded-lg bg-brand text-[11px] font-bold text-white', className)}>
      {initials}
    </div>
  )
}

export function BusinessSwitcher({ session }: { session: ReviewsSession }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<BizRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    reviewsApi<{ businesses: BizRow[] }>('/api/reviews/businesses').then((r) => setRows(r.businesses)).catch(() => {})
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function switchTo(b: BizRow) {
    if (b.isActive) { setOpen(false); return }
    setBusy(b.id)
    try {
      await reviewsApi('/api/reviews/businesses', { method: 'POST', body: { action: 'activate', business_id: b.id } })
      // Reload to re-scope the whole app to the new active business.
      window.location.assign('/dashboard')
    } catch {
      setBusy(null)
    }
  }

  // Admin impersonation: show the client name statically, no switching.
  if (session.impersonating) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-bg p-2.5">
        <Avatar initials={(session.businessName[0] ?? 'B').toUpperCase()} className="h-9 w-9" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{session.businessName}</p>
          <p className="text-[10px] uppercase tracking-wider text-ink-subtle">Viewing as client</p>
        </div>
      </div>
    )
  }

  const initials = (session.businessName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || 'B').toUpperCase()

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-2xl border border-border bg-bg p-2.5 text-left transition-colors hover:bg-elevated">
        <Avatar initials={initials} className="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{session.businessName}</p>
          <p className="text-[10px] uppercase tracking-wider text-ink-subtle">Business</p>
        </div>
        <ChevronDown style={{ width: 16, height: 16 }} className={cn('shrink-0 text-ink-subtle transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">Your Businesses</p>
          <div className="max-h-64 overflow-y-auto">
            {rows.map((b) => (
              <button key={b.id} disabled={busy === b.id} onClick={() => switchTo(b)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-elevated">
                <Avatar initials={b.avatarInitials} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{b.name}</p>
                  {b.addressLine && <p className="truncate text-xs text-ink-subtle">{b.addressLine}</p>}
                </div>
                {b.isActive && <Check style={{ width: 15, height: 15 }} className="shrink-0 text-emerald-600" />}
              </button>
            ))}
            {rows.length === 0 && <p className="px-3 py-2 text-xs text-ink-subtle">Loading…</p>}
          </div>
          <button onClick={() => { setOpen(false); navigate('/business/add') }}
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-sm font-medium text-brand hover:bg-elevated">
            <Plus style={{ width: 15, height: 15 }} /> Add Business
          </button>
        </div>
      )}
    </div>
  )
}
