import { useEffect, useMemo, useState } from 'react'
import { Star, Check, X as XIcon, Sparkles } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input, Textarea } from '@/core/ui/Input'
import { SectionCard } from '@/core/ui/SectionCard'
import { Switch } from '@/core/ui/Switch'
import { EmptyState } from '@/core/ui/EmptyState'
import { cn } from '@/core/lib/cn'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useReviewsSession, reviewsApi, fmtDate } from '../lib'

interface Review {
  id: string
  rating: number
  comment: string | null
  reviewer_name: string | null
  review_created_at: string | null
  has_reply: boolean
  reply_text: string | null
  ai_draft: string | null
  ai_draft_status: string
}

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: 14, height: 14 }}
          className={i <= rating ? 'fill-amber-400 text-amber-400' : 'text-border'} />
      ))}
    </div>
  )
}

export default function ReviewsInboxPage() {
  const session = useReviewsSession()
  const [reviews, setReviews] = useState<Review[]>([])
  const [filter, setFilter] = useState<number | null>(null)
  const [autoReply, setAutoReply] = useState(true)
  const [nickname, setNickname] = useState('')
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const imp = session.impersonating ? session.businessId : null

  useEffect(() => {
    async function load() {
      const [{ data }, settings] = await Promise.all([
        supabase.from('gbp_reviews')
          .select('id, rating, comment, reviewer_name, review_created_at, has_reply, reply_text, ai_draft, ai_draft_status')
          .eq('business_id', session.businessId)
          .order('review_created_at', { ascending: false })
          .limit(100),
        reviewsApi<{ settings: { auto_reply_positive: boolean; business_display_name: string | null } }>('/api/reviews/settings', { impersonateBusinessId: imp }),
      ])
      setReviews((data ?? []) as Review[])
      setAutoReply(settings.settings.auto_reply_positive)
      setNickname(settings.settings.business_display_name ?? '')
    }
    load().catch((e) => setMsg((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.businessId])

  const pending = useMemo(() => reviews.filter((r) => r.ai_draft_status === 'pending_approval'), [reviews])
  const filtered = useMemo(() => (filter ? reviews.filter((r) => r.rating === filter) : reviews), [reviews, filter])

  async function act(review: Review, action: 'approve' | 'reject') {
    setBusy(review.id)
    setMsg(null)
    try {
      await reviewsApi('/api/reviews/replies', {
        body: { review_id: review.id, action, edited: editing[review.id] },
        impersonateBusinessId: imp,
      })
      setReviews((prev) => prev.map((r) => r.id === review.id
        ? {
            ...r,
            ai_draft_status: action === 'approve' ? 'posted' : 'rejected',
            ...(action === 'approve' ? { has_reply: true, reply_text: editing[review.id] || r.ai_draft } : {}),
          }
        : r))
      setMsg(action === 'approve' ? 'Reply posted to Google.' : 'Draft dismissed.')
    } catch (err) {
      setMsg((err as Error).message)
    }
    setBusy(null)
  }

  async function saveSettings(patch: Record<string, unknown>) {
    try {
      await reviewsApi('/api/reviews/settings', { method: 'PUT', body: patch, impersonateBusinessId: imp })
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Reviews</h1>
        <p className="text-sm text-ink-subtle">Manage and respond to your Google reviews</p>
      </div>

      <SectionCard title="AI response settings" action={<Sparkles className="text-brand" style={{ width: 16, height: 16 }} />}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 items-center justify-between gap-3 rounded-xl bg-border/30 px-3 py-2">
            <span className="text-sm text-ink">Auto-post replies to 4–5 star reviews<br />
              <span className="text-xs text-ink-subtle">1–3 star replies always wait for your approval below</span></span>
            <Switch checked={autoReply} onChange={(v) => { setAutoReply(v); saveSettings({ auto_reply_positive: v }) }} />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-ink-subtle">Business nickname (how the AI refers to you)</label>
            <div className="flex gap-2">
              <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={`e.g. ${session.businessName.split(' ')[0]}`} />
              <Button size="sm" variant="secondary" onClick={() => saveSettings({ business_display_name: nickname })}>Save</Button>
            </div>
          </div>
        </div>
      </SectionCard>

      {pending.length > 0 && (
        <SectionCard title={`Awaiting your approval (${pending.length})`}>
          <div className="space-y-4">
            {pending.map((r) => (
              <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StarRow rating={r.rating} />
                    <span className="text-sm font-medium text-ink">{r.reviewer_name ?? 'A customer'}</span>
                  </div>
                  <span className="text-xs text-ink-subtle">{fmtDate(r.review_created_at)}</span>
                </div>
                {r.comment && <p className="mt-2 text-sm text-ink">{r.comment}</p>}
                <div className="mt-3">
                  <label className="text-xs font-medium text-ink-subtle">Suggested reply (edit freely)</label>
                  <Textarea
                    rows={3}
                    value={editing[r.id] ?? r.ai_draft ?? ''}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={busy === r.id} onClick={() => act(r, 'approve')}>
                    <Check style={{ width: 14, height: 14 }} /> Post reply
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => act(r, 'reject')}>
                    <XIcon style={{ width: 14, height: 14 }} /> Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setFilter(null)}
          className={cn('rounded-full px-3 py-1 text-xs font-medium', filter === null ? 'bg-brand text-white' : 'bg-border/40 text-ink-subtle')}>
          All
        </button>
        {[5, 4, 3, 2, 1].map((n) => (
          <button key={n} onClick={() => setFilter(n)}
            className={cn('rounded-full px-3 py-1 text-xs font-medium', filter === n ? 'bg-brand text-white' : 'bg-border/40 text-ink-subtle')}>
            {n} star{n === 1 ? '' : 's'}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-subtle">Showing {filtered.length} of {reviews.length} reviews</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No reviews found" description="Reviews will appear here as soon as they land on Google." />
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StarRow rating={r.rating} />
                  <span className="text-sm font-medium text-ink">{r.reviewer_name ?? 'A customer'}</span>
                </div>
                <span className="text-xs text-ink-subtle">{fmtDate(r.review_created_at)}</span>
              </div>
              {r.comment && <p className="mt-2 text-sm text-ink">{r.comment}</p>}
              {r.has_reply && r.reply_text && (
                <div className="mt-3 rounded-xl bg-border/30 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">Your reply {r.ai_draft_status === 'posted' ? '· AI-assisted' : ''}</p>
                  <p className="mt-1 text-sm text-ink">{r.reply_text}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {msg && <p className="text-sm font-medium text-brand-700">{msg}</p>}
    </div>
  )
}
