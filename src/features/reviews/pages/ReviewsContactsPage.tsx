import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/core/ui/Input'
import { EmptyState } from '@/core/ui/EmptyState'
import { cn } from '@/core/lib/cn'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useReviewsSession, fmtDate } from '../lib'

// Funnel status per contact, derived from their latest review_request row.
const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  none: { label: 'No request', tone: 'bg-border/50 text-ink-subtle' },
  queued: { label: 'Pending', tone: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'Waiting', tone: 'bg-amber-100 text-amber-700' },
  reviewed: { label: 'Left review', tone: 'bg-emerald-100 text-emerald-700' },
  no_review: { label: 'No review', tone: 'bg-border/50 text-ink-subtle' },
  opted_out: { label: 'Do not contact', tone: 'bg-red-100 text-red-700' },
  stopped: { label: 'Stopped', tone: 'bg-red-50 text-red-600' },
  failed: { label: 'Failed', tone: 'bg-red-100 text-red-700' },
}

const FILTERS = ['All', 'Left review', 'Clicked', 'Waiting', 'Pending', 'No review', 'Do not contact', 'Failed'] as const

interface ContactRow {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  created_at: string
  status: string
  clicked: boolean
  followups_sent: number
  requestId: string | null
}

export default function ReviewsContactsPage() {
  const session = useReviewsSession()
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: rows }, { data: requests }] = await Promise.all([
        supabase.from('contacts')
          .select('id, name, phone, email, created_at')
          .eq('business_id', session.businessId)
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase.from('review_requests')
          .select('id, contact_id, status, clicked_at, followups_sent, created_at')
          .eq('business_id', session.businessId)
          .order('created_at', { ascending: false })
          .limit(2000),
      ])
      const latestByContact = new Map<string, { id: string; status: string; clicked_at: string | null; followups_sent: number }>()
      for (const r of requests ?? []) {
        if (!latestByContact.has(r.contact_id)) latestByContact.set(r.contact_id, r)
      }
      setContacts((rows ?? []).map((c) => {
        const req = latestByContact.get(c.id)
        return {
          id: c.id, name: c.name, phone: c.phone, email: c.email, created_at: c.created_at,
          status: req?.status ?? 'none',
          clicked: !!req?.clicked_at,
          followups_sent: req?.followups_sent ?? 0,
          requestId: req?.id ?? null,
        }
      }))
      setLoading(false)
    }
    load()
  }, [session.businessId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contacts.filter((c) => {
      if (q && !`${c.name ?? ''} ${c.phone ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q)) return false
      switch (filter) {
        case 'All': return true
        case 'Left review': return c.status === 'reviewed'
        case 'Clicked': return c.clicked
        case 'Waiting': return c.status === 'in_progress'
        case 'Pending': return c.status === 'queued'
        case 'No review': return c.status === 'no_review'
        case 'Do not contact': return c.status === 'opted_out' || c.status === 'stopped'
        case 'Failed': return c.status === 'failed'
      }
    })
  }, [contacts, search, filter])

  async function stopContact(c: ContactRow) {
    if (!c.requestId) return
    await supabase.from('review_requests').update({ status: 'stopped', next_send_at: null }).eq('id', c.requestId)
    setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: 'stopped' } : x)))
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Contacts</h1>
        <p className="text-sm text-ink-subtle">Manage your contacts and review requests</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" style={{ width: 15, height: 15 }} />
          <Input placeholder="Search by name, email, or phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <span className="text-sm text-ink-subtle">{filtered.length} contact{filtered.length === 1 ? '' : 's'}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('rounded-full px-3 py-1 text-xs font-medium',
              filter === f ? 'bg-brand text-white' : 'bg-border/40 text-ink-subtle hover:text-ink')}>
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-ink-subtle">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No contacts found"
          description={contacts.length === 0 ? 'Add contacts to start requesting reviews.' : 'No contacts match your filters — try adjusting them.'}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 sm:table-cell">Follow-ups</th>
                <th className="hidden px-4 py-3 sm:table-cell">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((c) => {
                const s = STATUS_LABELS[c.status] ?? STATUS_LABELS.none
                return (
                  <tr key={c.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">{c.name || '—'}</td>
                    <td className="px-4 py-3 text-ink-subtle">{c.phone || c.email || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', s.tone)}>{s.label}</span>
                      {c.clicked && c.status !== 'reviewed' && (
                        <span className="ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">Clicked</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-ink-subtle sm:table-cell">{c.followups_sent || '—'}</td>
                    <td className="hidden px-4 py-3 text-ink-subtle sm:table-cell">{fmtDate(c.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {(c.status === 'queued' || c.status === 'in_progress') && (
                        <button onClick={() => stopContact(c)} className="text-xs font-medium text-red-500 hover:underline">
                          Stop sending
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
