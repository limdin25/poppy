import { useEffect, useMemo, useState } from 'react'
import { Star, TrendingUp, MousePointerClick, Send, Users, Copy, ExternalLink, Check } from 'lucide-react'
import { StatCard } from '@/core/ui/StatCard'
import { SectionCard } from '@/core/ui/SectionCard'
import { cn } from '@/core/lib/cn'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useReviewsSession } from '../lib'

type Range = '7d' | '30d' | 'all'

interface DayPoint { date: string; count: number }

function StarRow({ rating, size = 18 }: { rating: number; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-border'}
        />
      ))}
    </div>
  )
}

export default function ReviewsDashboardPage() {
  const session = useReviewsSession()
  const [range, setRange] = useState<Range>('30d')
  const [copied, setCopied] = useState(false)
  const [projection, setProjection] = useState(0)
  const [stats, setStats] = useState({
    newReviews: 0, updatedReviews: 0, clicks: 0, requestsSent: 0, contactsAdded: 0,
  })
  const [conn, setConn] = useState<{ avg_rating: number | null; total_reviews: number | null; review_url: string | null; maps_url: string | null; status: string } | null>(null)
  const [history, setHistory] = useState<DayPoint[]>([])

  useEffect(() => {
    const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
    async function load() {
      const b = session.businessId
      const [connRes, reviewsRes, updatedRes, clicksRes, sentRes, contactsRes] = await Promise.all([
        supabase.from('gbp_connections').select('avg_rating, total_reviews, review_url, maps_url, status').eq('business_id', b).maybeSingle(),
        supabase.from('gbp_reviews').select('id', { count: 'exact', head: true }).eq('business_id', b).gte('review_created_at', since30),
        supabase.from('gbp_reviews').select('id', { count: 'exact', head: true }).eq('business_id', b).gte('review_updated_at', since30).lt('review_created_at', since30),
        supabase.from('review_events').select('id', { count: 'exact', head: true }).eq('business_id', b).eq('type', 'clicked').gte('created_at', since30),
        supabase.from('review_events').select('id', { count: 'exact', head: true }).eq('business_id', b).in('type', ['request_sent', 'followup_sent']).gte('created_at', since30),
        supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('business_id', b).gte('created_at', since30),
      ])
      setConn(connRes.data ? { ...connRes.data, avg_rating: connRes.data.avg_rating ? Number(connRes.data.avg_rating) : null } : null)
      setStats({
        newReviews: reviewsRes.count ?? 0,
        updatedReviews: updatedRes.count ?? 0,
        clicks: clicksRes.count ?? 0,
        requestsSent: sentRes.count ?? 0,
        contactsAdded: contactsRes.count ?? 0,
      })
    }
    load()
  }, [session.businessId])

  useEffect(() => {
    async function loadHistory() {
      const days = range === '7d' ? 7 : range === '30d' ? 30 : 365
      const since = new Date(Date.now() - days * 86400_000).toISOString()
      const { data } = await supabase
        .from('gbp_reviews')
        .select('review_created_at')
        .eq('business_id', session.businessId)
        .gte('review_created_at', since)
        .order('review_created_at')
      const byDay = new Map<string, number>()
      for (const r of data ?? []) {
        const d = (r.review_created_at as string).slice(0, 10)
        byDay.set(d, (byDay.get(d) ?? 0) + 1)
      }
      setHistory([...byDay.entries()].map(([date, count]) => ({ date, count })))
    }
    loadHistory()
  }, [session.businessId, range])

  const rating = conn?.avg_rating ?? 0
  const total = conn?.total_reviews ?? 0

  const projected = useMemo(() => {
    if (!projection) return rating
    if (!total) return 5
    return (rating * total + 5 * projection) / (total + projection)
  }, [rating, total, projection])

  const milestones = useMemo(() => {
    if (!total || rating >= 4.9) return []
    return [1, 2, 3, 4, 5].map((i) => {
      const target = Math.min(5, Math.round((rating + i * 0.1) * 10) / 10)
      const needed = target >= 5 ? Infinity : Math.ceil((total * (target - rating)) / (5 - target))
      return { target, needed }
    }).filter((m) => isFinite(m.needed) && m.needed > 0).slice(0, 5)
  }, [rating, total])

  const maxCount = Math.max(1, ...history.map((h) => h.count))

  function copyLink() {
    if (!conn?.review_url) return
    navigator.clipboard.writeText(conn.review_url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">{session.businessName}</h1>
        <p className="text-sm text-ink-subtle">Your reviews at a glance</p>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Last 30 days performance</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="New reviews" value={stats.newReviews} icon={<Star />} />
          <StatCard label="Updated reviews" value={stats.updatedReviews} icon={<TrendingUp />} />
          <StatCard label="Link clicks" value={stats.clicks} icon={<MousePointerClick />} />
          <StatCard label="Requests sent" value={stats.requestsSent} icon={<Send />} />
          <StatCard label="Contacts added" value={stats.contactsAdded} icon={<Users />} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,340px]">
        {/* Review history */}
        <SectionCard
          title="Review history"
          action={
            <div className="flex gap-1">
              {(['7d', '30d', 'all'] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-xs font-medium',
                    range === r ? 'bg-brand text-white' : 'bg-border/40 text-ink-subtle hover:text-ink',
                  )}
                >
                  {r === 'all' ? 'All' : r}
                </button>
              ))}
            </div>
          }
        >
          {history.length === 0 ? (
            <div className="flex h-44 flex-col items-center justify-center text-center">
              <p className="text-sm font-medium text-ink">No reviews in this period</p>
              <p className="text-xs text-ink-subtle">New reviews will chart here as they land.</p>
            </div>
          ) : (
            <div className="flex h-44 items-end gap-1">
              {history.map((h) => (
                <div key={h.date} className="group relative flex-1">
                  <div
                    className="rounded-t bg-brand/80 transition-colors group-hover:bg-brand"
                    style={{ height: `${Math.max(8, (h.count / maxCount) * 160)}px` }}
                  />
                  <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 text-[10px] text-white group-hover:block">
                    {h.count} · {h.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Google Reviews card */}
        <SectionCard title="Google reviews">
          <div className="space-y-5">
            <div className="flex items-end gap-3">
              <span className="text-4xl font-bold text-ink">{rating ? rating.toFixed(1) : '0.0'}</span>
              <span className="pb-1 text-sm text-ink-subtle">/ 5</span>
            </div>
            <div className="flex items-center gap-2">
              <StarRow rating={rating} />
              <span className="text-sm text-ink-subtle">{total} Google review{total === 1 ? '' : 's'}</span>
            </div>

            {/* Rating projection */}
            <div className="rounded-xl bg-brand-50 p-3">
              <p className="text-xs font-semibold text-brand-700">Rating projection</p>
              <p className="mb-2 text-[11px] text-ink-subtle">See how your rating changes with more 5-star reviews</p>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0} max={100} value={projection}
                  onChange={(e) => setProjection(Number(e.target.value))}
                  className="flex-1 accent-brand"
                  aria-label="Extra 5-star reviews"
                />
                <span className="w-10 text-right text-sm font-semibold text-ink">+{projection}</span>
              </div>
              {projection > 0 && (
                <p className="mt-1 text-sm font-medium text-brand-700">
                  → {projected.toFixed(2)} ★ with {projection} more 5-star review{projection === 1 ? '' : 's'}
                </p>
              )}
            </div>

            {/* Milestones */}
            <div>
              <p className="text-xs font-semibold text-ink">Milestones</p>
              <p className="mb-2 text-[11px] text-ink-subtle">Reviews needed to reach each rating level</p>
              {milestones.length > 0 ? (
                <div className="space-y-1.5">
                  {milestones.map((m) => (
                    <div key={m.target} className="flex items-center gap-2 text-xs">
                      <span className="w-10 font-medium text-ink">{m.target.toFixed(1)} ★</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (stats.newReviews / m.needed) * 100)}%` }} />
                      </div>
                      <span className="w-16 text-right text-ink-subtle">{m.needed} review{m.needed === 1 ? '' : 's'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-border/30 p-2 text-[11px] text-ink-subtle">
                  {total === 0
                    ? 'Milestones appear once your Google profile is connected and has its first reviews.'
                    : 'Your rating is already at the top — keep the reviews coming to hold it there.'}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              {conn?.maps_url && (
                <a href={conn.maps_url} target="_blank" rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium text-ink hover:bg-border/30">
                  <ExternalLink style={{ width: 14, height: 14 }} /> View on Google Maps
                </a>
              )}
              <button onClick={copyLink} disabled={!conn?.review_url}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium text-ink hover:bg-border/30 disabled:opacity-40">
                {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
                {copied ? 'Copied!' : 'Copy review link'}
              </button>
            </div>
            {conn?.status !== 'connected' && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                Google Business Profile not connected yet — <a href="/onboarding" className="font-semibold underline">finish setup</a>.
              </p>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
