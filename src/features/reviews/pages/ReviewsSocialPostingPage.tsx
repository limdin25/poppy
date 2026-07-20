import { useEffect, useMemo, useState } from 'react'
import { Star, Share2, CheckCircle2 } from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { Switch } from '@/core/ui/Switch'
import { EmptyState } from '@/core/ui/EmptyState'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useReviewsSession, reviewsApi, fmtDate } from '../lib'

interface Review {
  id: string
  rating: number
  comment: string | null
  reviewer_name: string | null
  review_created_at: string | null
  social_posted_at: string | null
}

// Same eligibility the webhook applies before repurposing a review as a post.
const MIN_POST_TEXT = 30

function firstName(name: string | null) {
  return name?.split(/\s+/)[0] || 'a happy customer'
}

function PostPreview({ review, businessName }: { review: Review | null; businessName: string }) {
  const text = review?.comment
    ? review.comment.slice(0, 1200)
    : 'Brilliant service from start to finish — turned up on time, tidy work, fair price. Wouldn’t use anyone else.'
  const author = review ? firstName(review.reviewer_name) : 'Sarah'
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
          {businessName.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">{businessName}</p>
          <p className="text-[11px] text-ink-subtle">Update on Google Business Profile</p>
        </div>
      </div>
      <div className="mt-3 flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} style={{ width: 16, height: 16 }} className="fill-amber-400 text-amber-400" />
        ))}
      </div>
      <p className="mt-2 text-sm text-ink">&ldquo;{text}&rdquo; — {author}</p>
      {!review && <p className="mt-2 text-[11px] text-ink-subtle">Sample post — your real 5-star reviews will appear here.</p>}
    </div>
  )
}

export default function ReviewsSocialPostingPage() {
  const session = useReviewsSession()
  const [autoPost, setAutoPost] = useState(false)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const imp = session.impersonating ? session.businessId : null

  useEffect(() => {
    async function load() {
      const [{ data }, settings] = await Promise.all([
        supabase.from('gbp_reviews')
          .select('id, rating, comment, reviewer_name, review_created_at, social_posted_at')
          .eq('business_id', session.businessId)
          .eq('rating', 5)
          .order('review_created_at', { ascending: false })
          .limit(100),
        reviewsApi<{ settings: { auto_post_five_star: boolean } }>('/api/reviews/settings', { impersonateBusinessId: imp }),
      ])
      setReviews((data ?? []) as Review[])
      setAutoPost(settings.settings.auto_post_five_star)
      setLoaded(true)
    }
    load().catch((e) => { setMsg((e as Error).message); setLoaded(true) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.businessId])

  const posted = useMemo(() => reviews.filter((r) => r.social_posted_at), [reviews])
  const eligible = useMemo(
    () => reviews.filter((r) => !r.social_posted_at && (r.comment?.length ?? 0) >= MIN_POST_TEXT),
    [reviews],
  )

  async function toggle(v: boolean) {
    setAutoPost(v)
    setMsg(null)
    try {
      await reviewsApi('/api/reviews/settings', { method: 'PUT', body: { auto_post_five_star: v }, impersonateBusinessId: imp })
      setMsg(v ? 'Auto-posting on — new 5-star reviews will be shared automatically.' : 'Auto-posting off.')
    } catch (err) {
      setMsg((err as Error).message)
      setAutoPost(!v)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Social Posting</h1>
        <p className="text-sm text-ink-subtle">Turn your best reviews into posts on your Google profile</p>
      </div>

      <SectionCard title="Auto-posting" action={<Share2 className="text-brand" style={{ width: 16, height: 16 }} />}>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-border/30 px-3 py-2">
          <span className="text-sm text-ink">Automatically share new 5-star reviews as posts<br />
            <span className="text-xs text-ink-subtle">Only reviews with a sentence or two of text are shared — star-only and very short reviews are skipped</span></span>
          <Switch checked={autoPost} onChange={toggle} />
        </div>
      </SectionCard>

      <SectionCard title="What a post looks like">
        <PostPreview review={posted[0] ?? eligible[0] ?? null} businessName={session.businessName} />
      </SectionCard>

      <SectionCard title={`Posted (${posted.length})`}>
        {!loaded ? (
          <p className="py-4 text-center text-sm text-ink-subtle">Loading…</p>
        ) : posted.length === 0 ? (
          <EmptyState
            title="Nothing posted yet"
            description={autoPost
              ? 'Your next 5-star review with a written comment will be shared automatically.'
              : 'Turn on auto-posting above and new 5-star reviews with comments will be shared automatically.'}
          />
        ) : (
          <div className="space-y-3">
            {posted.map((r) => (
              <div key={r.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 style={{ width: 14, height: 14 }} /> Posted {fmtDate(r.social_posted_at)}
                  </span>
                  <span className="text-xs text-ink-subtle">Review from {fmtDate(r.review_created_at)}</span>
                </div>
                <p className="mt-1.5 text-sm text-ink">&ldquo;{(r.comment ?? '').slice(0, 200)}&rdquo; — {firstName(r.reviewer_name)}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={`Recent 5-star reviews (${eligible.length})`}>
        {!loaded ? (
          <p className="py-4 text-center text-sm text-ink-subtle">Loading…</p>
        ) : eligible.length === 0 ? (
          <EmptyState title="No 5-star reviews with comments yet" description="As they land on Google they'll show here." />
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-ink-subtle">
              {autoPost
                ? 'These arrived before auto-posting was set up — new 5-star reviews post automatically from now on.'
                : 'Turn on auto-posting above to share new 5-star reviews like these automatically.'}
            </p>
            {eligible.map((r) => (
              <div key={r.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} style={{ width: 13, height: 13 }} className="fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <span className="text-xs text-ink-subtle">{fmtDate(r.review_created_at)}</span>
                </div>
                <p className="mt-1.5 text-sm text-ink">&ldquo;{(r.comment ?? '').slice(0, 200)}&rdquo; — {firstName(r.reviewer_name)}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {msg && <p className="text-sm font-medium text-brand-700">{msg}</p>}
    </div>
  )
}
