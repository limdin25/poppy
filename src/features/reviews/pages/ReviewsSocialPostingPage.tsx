import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Star, Share2, CheckCircle2, Plus, Search, Trash2,
  Send, ArrowLeft, ExternalLink, ArrowUp, Pencil, AlertTriangle,
} from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { Switch } from '@/core/ui/Switch'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { EmptyState } from '@/core/ui/EmptyState'
import { cn } from '@/core/lib/cn'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useReviewsSession, reviewsApi, fmtDate } from '../lib'
import { SocialCardPreview } from '../components/SocialCardPreview'
import { SocialTemplateEditor } from '../components/SocialTemplateEditor'
import { MIN_POST_TEXT, type SocialTemplate } from '../social-presets'

interface Review {
  id: string
  rating: number
  comment: string | null
  reviewer_name: string | null
  reply_text: string | null
  review_created_at: string | null
  social_posted_at: string | null
}
interface SocialAccount {
  id: string; platform: 'facebook' | 'instagram'; account_name: string | null; username: string | null; avatar_url: string | null
}
interface SocialSettings {
  caption_mode: 'comment' | 'reply' | 'custom'
  custom_caption: string | null
  auto_enabled: boolean
  schedule: Record<string, { story: boolean; feed: boolean }>
  active_feed_template_id: string | null
  active_story_template_id: string | null
}
interface QueueItem {
  id: string; review_id: string; post_type: 'feed' | 'story'; caption: string | null
  image_url: string | null; status: string; published_at: string | null; error: string | null
  results: Array<{ platform: string; ok: boolean; url?: string; error?: string }>
  review: { id: string; rating: number; comment: string | null; reviewer_name: string | null; review_created_at: string | null } | null
}

const DAYS: Array<[string, string]> = [
  ['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'], ['thursday', 'Thursday'],
  ['friday', 'Friday'], ['saturday', 'Saturday'], ['sunday', 'Sunday'],
]
const CAPTION_MODES: Array<{ key: SocialSettings['caption_mode']; label: string; blurb: string }> = [
  { key: 'comment', label: 'Review Comment', blurb: 'Posts use the original review comment as the caption — perfect for sharing authentic customer feedback.' },
  { key: 'reply', label: 'Review Reply', blurb: 'Posts use your reply to the review. If a review has no reply, it falls back to the review comment.' },
  { key: 'custom', label: 'Custom Caption', blurb: 'One custom message is used for all posts. The review still renders inside the template image.' },
]

function firstName(name: string | null) { return name?.split(/\s+/)[0] || 'a happy customer' }

// Brand marks as inline SVG — lucide-react dropped its brand icons.
function FbIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z" />
    </svg>
  )
}
function IgIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function ReviewsSocialPostingPage() {
  const session = useReviewsSession()
  const imp = session.impersonating ? session.businessId : null
  const [view, setView] = useState<'main' | 'queue'>('main')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Data
  const [reviews, setReviews] = useState<Review[]>([])
  const [googleAutoPost, setGoogleAutoPost] = useState(false)
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [settings, setSettings] = useState<SocialSettings | null>(null)
  // Latest committed settings, read by writers so rapid toggles never build on
  // a stale render closure (which would silently drop an earlier change).
  const settingsRef = useRef<SocialSettings | null>(null)
  useEffect(() => { settingsRef.current = settings }, [settings])
  const [templates, setTemplates] = useState<SocialTemplate[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loaded, setLoaded] = useState(false)

  // UI
  const [editor, setEditor] = useState<{ open: boolean; initial: SocialTemplate | null }>({ open: false, initial: null })
  const [search, setSearch] = useState('')
  const [customDraft, setCustomDraft] = useState('')

  function sapi<T = Record<string, unknown>>(path: string, opts: Parameters<typeof reviewsApi>[1] = {}) {
    return reviewsApi<T>(path, { ...opts, impersonateBusinessId: imp })
  }

  async function loadReviews() {
    const { data } = await supabase.from('gbp_reviews')
      .select('id, rating, comment, reviewer_name, reply_text, review_created_at, social_posted_at')
      .eq('business_id', session.businessId)
      .order('review_created_at', { ascending: false })
      .limit(200)
    setReviews((data ?? []) as Review[])
  }
  const refetchAccounts = () => sapi<{ accounts: SocialAccount[] }>('/api/reviews/social/accounts').then((r) => setAccounts(r.accounts))
  const refetchTemplates = () => sapi<{ templates: SocialTemplate[] }>('/api/reviews/social/templates').then((r) => setTemplates(r.templates))
  const refetchQueue = () => sapi<{ queue: QueueItem[] }>('/api/reviews/social/queue').then((r) => setQueue(r.queue))
  const refetchSettings = () => sapi<{ settings: SocialSettings }>('/api/reviews/social/settings').then((r) => { setSettings(r.settings); setCustomDraft(r.settings.custom_caption ?? '') })

  useEffect(() => {
    async function load() {
      const [rs] = await Promise.all([
        sapi<{ settings: SocialSettings }>('/api/reviews/social/settings'),
        loadReviews(), refetchAccounts(), refetchTemplates(), refetchQueue(),
      ])
      setSettings(rs.settings)
      setCustomDraft(rs.settings.custom_caption ?? '')
      const g = await sapi<{ settings: { auto_post_five_star: boolean } }>('/api/reviews/settings')
      setGoogleAutoPost(g.settings.auto_post_five_star)
      setLoaded(true)
    }
    load().catch((e) => { setMsg((e as Error).message); setLoaded(true) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.businessId])

  // Handle the Zernio connect redirect: ?connected=facebook&profileId=…&accountId=…&username=…
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const connected = p.get('connected')
    if (connected !== 'facebook' && connected !== 'instagram') return
    const clean = () => window.history.replaceState({}, '', window.location.pathname + (imp ? `?as=${imp}` : ''))
    sapi('/api/reviews/social/connect-complete', {
      method: 'POST',
      body: { platform: connected, profileId: p.get('profileId'), accountId: p.get('accountId'), username: p.get('username') },
    }).then(() => { setMsg(`${connected === 'facebook' ? 'Facebook' : 'Instagram'} connected.`); refetchAccounts() })
      .catch((e) => setMsg((e as Error).message))
      .finally(clean)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Actions ──
  async function connect(platform: 'facebook' | 'instagram') {
    setBusy(platform); setMsg(null)
    try {
      const { authUrl } = await sapi<{ authUrl: string }>('/api/reviews/social/connect', { method: 'POST', body: { platform } })
      window.location.href = authUrl
    } catch (err) { setMsg((err as Error).message); setBusy(null) }
  }
  async function disconnect(a: SocialAccount) {
    if (!window.confirm(`Disconnect ${a.account_name || a.platform}? Posting to it will stop.`)) return
    await sapi(`/api/reviews/social/accounts?id=${a.id}`, { method: 'DELETE' })
    refetchAccounts()
  }
  async function updateSettings(patch: Partial<SocialSettings>) {
    const base = settingsRef.current
    if (!base) return
    const next = { ...base, ...patch }
    settingsRef.current = next          // commit synchronously so the next writer merges on this
    setSettings(next)                   // optimistic
    try {
      // Don't overwrite local state with the response — an out-of-order reply
      // must not clobber a newer optimistic change. Reconcile only on error.
      await sapi('/api/reviews/social/settings', { method: 'PUT', body: patch })
    } catch (err) { setMsg((err as Error).message); refetchSettings() }
  }
  function setDay(day: string, kind: 'story' | 'feed', val: boolean) {
    const base = settingsRef.current
    if (!base) return
    updateSettings({ schedule: { ...base.schedule, [day]: { ...base.schedule[day], [kind]: val } } })
  }
  async function toggleGoogle(v: boolean) {
    setGoogleAutoPost(v)
    try { await sapi('/api/reviews/settings', { method: 'PUT', body: { auto_post_five_star: v } }) }
    catch (err) { setMsg((err as Error).message); setGoogleAutoPost(!v) }
  }
  async function addToQueue(reviewId: string, postType: 'feed' | 'story') {
    setBusy('q-' + reviewId)
    try { await sapi('/api/reviews/social/queue', { method: 'POST', body: { review_id: reviewId, post_type: postType } }); await refetchQueue() }
    catch (err) { setMsg((err as Error).message) }
    setBusy(null)
  }
  async function removeQueue(id: string) {
    await sapi(`/api/reviews/social/queue?id=${id}`, { method: 'DELETE' }); refetchQueue()
  }
  async function bumpQueue(id: string) {
    await sapi('/api/reviews/social/queue', { method: 'POST', body: { action: 'bump', id } }); refetchQueue()
  }
  async function publishNow(id: string) {
    setBusy('pub-' + id); setMsg(null)
    try { await sapi('/api/reviews/social/publish', { method: 'POST', body: { id } }); setMsg('Published.'); await refetchQueue() }
    catch (err) { setMsg((err as Error).message) }
    setBusy(null)
  }
  async function setActive(t: SocialTemplate) {
    const key = t.type === 'story' ? 'active_story_template_id' : 'active_feed_template_id'
    await updateSettings({ [key]: t.id } as Partial<SocialSettings>)
  }

  const queuedReviewIds = useMemo(() => new Set(queue.map((q) => q.review_id)), [queue])
  const postQueue = useMemo(() => queue.filter((q) => q.status !== 'published'), [queue])
  const publishedPosts = useMemo(() => queue.filter((q) => q.status === 'published'), [queue])
  const filteredReviews = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reviews.filter((r) => (r.comment?.length ?? 0) > 0 && (!q
      || (r.reviewer_name ?? '').toLowerCase().includes(q) || (r.comment ?? '').toLowerCase().includes(q)))
  }, [reviews, search])
  const googleEligible = useMemo(
    () => reviews.filter((r) => r.rating === 5 && (r.comment?.length ?? 0) >= MIN_POST_TEXT && !r.social_posted_at), [reviews])
  const sampleReview = useMemo(() => {
    const r = reviews.find((x) => (x.comment?.length ?? 0) >= MIN_POST_TEXT)
    return { reviewerName: firstName(r?.reviewer_name ?? null), comment: r?.comment ?? 'Brilliant service from start to finish — turned up on time, tidy work, fair price. Would not use anyone else.' }
  }, [reviews])
  if (editor.open) {
    return (
      <SocialTemplateEditor
        initial={editor.initial} sampleReview={sampleReview} imp={imp}
        onClose={() => setEditor({ open: false, initial: null })}
        onSaved={() => { setEditor({ open: false, initial: null }); refetchTemplates(); setMsg('Template saved.') }}
      />
    )
  }

  // ── Review Queue sub-view ──
  if (view === 'queue') {
    return (
      <div className="space-y-4">
        <button onClick={() => setView('main')} className="flex items-center gap-1.5 text-sm font-medium text-ink-subtle hover:text-ink">
          <ArrowLeft style={{ width: 16, height: 16 }} /> Go back
        </button>
        {msg && <p className="rounded-xl bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700">{msg}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="All Reviews">
            <p className="-mt-1 mb-3 text-xs text-ink-subtle">Browse and prioritise reviews for social media posting.</p>
            <div className="relative mb-3">
              <Search style={{ width: 15, height: 15 }} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reviews by name or comment…" className="pl-9" />
            </div>
            {filteredReviews.length === 0 ? (
              <EmptyState title="No reviews available" description="Reviews with a written comment can be posted to social." />
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {filteredReviews.map((r) => {
                  const inQueue = queuedReviewIds.has(r.id)
                  return (
                    <div key={r.id} className="rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex gap-0.5">{Array.from({ length: r.rating }, (_, i) => <Star key={i} style={{ width: 12, height: 12 }} className="fill-amber-400 text-amber-400" />)}</div>
                        <span className="text-xs text-ink-subtle">{fmtDate(r.review_created_at)}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-ink">&ldquo;{(r.comment ?? '').slice(0, 180)}&rdquo; ({firstName(r.reviewer_name)})</p>
                      <div className="mt-2 flex gap-2">
                        {inQueue ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 style={{ width: 13, height: 13 }} /> In queue</span>
                        ) : (
                          <>
                            <Button size="sm" variant="secondary" disabled={busy === 'q-' + r.id} onClick={() => addToQueue(r.id, 'feed')}>
                              <Plus style={{ width: 13, height: 13 }} /> Feed
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy === 'q-' + r.id} onClick={() => addToQueue(r.id, 'story')}>
                              <Plus style={{ width: 13, height: 13 }} /> Story
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Post Queue">
            <p className="-mt-1 mb-3 text-xs text-ink-subtle">Reviews scheduled for social media posting.</p>
            {postQueue.length === 0 ? (
              <EmptyState title="No posts in queue" description="Add reviews from the left to line them up." />
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {postQueue.map((q) => (
                  <div key={q.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-border/50 px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-subtle">{q.post_type}</span>
                      <span className={cn('text-[11px] font-medium', q.status === 'failed' ? 'text-danger' : 'text-ink-subtle')}>{q.status}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-ink">&ldquo;{(q.review?.comment ?? '').slice(0, 140)}&rdquo; ({firstName(q.review?.reviewer_name ?? null)})</p>
                    {q.error && <p className="mt-1 text-xs text-danger">{q.error}</p>}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" disabled={busy === 'pub-' + q.id} onClick={() => publishNow(q.id)}>
                        <Send style={{ width: 13, height: 13 }} /> {busy === 'pub-' + q.id ? 'Publishing…' : 'Publish now'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => bumpQueue(q.id)}><ArrowUp style={{ width: 13, height: 13 }} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => removeQueue(q.id)}><Trash2 style={{ width: 13, height: 13 }} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    )
  }

  // ── Main view ──
  const noTemplate = templates.length === 0
  const noAccounts = accounts.length === 0
  // Readiness gating: auto-posting only publishes when an account is connected
  // AND an ACTIVE template exists for each post type the schedule enables.
  const feedScheduled = DAYS.some(([k]) => settings?.schedule?.[k]?.feed)
  const storyScheduled = DAYS.some(([k]) => settings?.schedule?.[k]?.story)
  const gating: string[] = []
  if (noAccounts) gating.push('Connect a Facebook or Instagram account')
  if (noTemplate) gating.push('Create a template')
  else {
    if (feedScheduled && !settings?.active_feed_template_id) gating.push('Set a Feed template as active')
    if (storyScheduled && !settings?.active_story_template_id) gating.push('Set a Story template as active')
  }
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Social Posting</h1>
        <p className="text-sm text-ink-subtle">Turn your best reviews into automatic Facebook &amp; Instagram posts.</p>
      </div>
      {msg && <p className="rounded-xl bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700">{msg}</p>}

      {/* 1 · Social Connections */}
      <SectionCard title="Social Connections" action={<Share2 className="text-brand" style={{ width: 16, height: 16 }} />}>
        <p className="-mt-1 mb-3 text-xs text-ink-subtle">Manage your connected social media accounts.</p>
        {noAccounts ? (
          <div className="rounded-xl border border-dashed border-border py-6 text-center">
            <p className="text-sm font-medium text-ink">No social accounts connected yet</p>
            <p className="mt-0.5 text-xs text-ink-subtle">Connect your accounts to start scheduling posts.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div className="flex items-center gap-2.5">
                  {a.platform === 'facebook' ? <FbIcon size={18} className="text-[#1877F2]" /> : <IgIcon size={18} className="text-[#E4405F]" />}
                  <div>
                    <p className="text-sm font-medium text-ink">{a.account_name || (a.platform === 'facebook' ? 'Facebook Page' : 'Instagram')}</p>
                    {a.username && <p className="text-xs text-ink-subtle">@{a.username}</p>}
                  </div>
                </div>
                <button onClick={() => disconnect(a)} className="text-xs font-medium text-ink-subtle hover:text-danger">Disconnect</button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={busy === 'facebook'} onClick={() => connect('facebook')}>
            <FbIcon size={14} /> {busy === 'facebook' ? 'Opening…' : 'Connect Facebook'}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy === 'instagram'} onClick={() => connect('instagram')}>
            <IgIcon size={14} /> {busy === 'instagram' ? 'Opening…' : 'Connect Instagram'}
          </Button>
        </div>
      </SectionCard>

      {/* 2 · Post Caption Configuration */}
      <SectionCard title="Post Caption Configuration">
        <p className="-mt-1 mb-3 text-xs text-ink-subtle">Choose what caption to use for your social media posts.</p>
        <p className="mb-1.5 text-xs font-medium text-ink-subtle">Caption Source</p>
        <div className="flex gap-1 rounded-xl bg-border/40 p-1">
          {CAPTION_MODES.map((m) => (
            <button key={m.key} onClick={() => updateSettings({ caption_mode: m.key })}
              className={cn('flex-1 rounded-lg px-2 py-1.5 text-xs font-medium', settings?.caption_mode === m.key ? 'bg-surface text-ink shadow-soft' : 'text-ink-subtle')}>
              {m.label}
            </button>
          ))}
        </div>
        {settings && (
          <div className="mt-3 rounded-xl bg-brand-50/60 px-3 py-2 text-xs text-brand-700">
            {CAPTION_MODES.find((m) => m.key === settings.caption_mode)?.blurb}
          </div>
        )}
        {settings?.caption_mode === 'custom' && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-ink-subtle">Custom Post Caption</p>
            <textarea
              value={customDraft} onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={() => updateSettings({ custom_caption: customDraft })}
              placeholder="Enter your custom content for all posts…"
              className="min-h-[90px] w-full rounded-xl border border-border bg-surface p-3 text-sm text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15" />
            <p className="mt-1 text-[11px] text-ink-subtle">This content is used for all generated posts while Custom mode is active.</p>
          </div>
        )}
      </SectionCard>

      {/* 3 · Automated Posting Schedule */}
      <SectionCard
        title="Automated Posting Schedule"
        action={settings && (
          <label className="flex items-center gap-2 text-xs font-medium text-ink">
            Auto Posting {settings.auto_enabled ? 'Enabled' : 'Off'}
            <Switch checked={settings.auto_enabled} onChange={(v) => updateSettings({ auto_enabled: v })} />
          </label>
        )}
      >
        <p className="-mt-1 mb-3 text-xs text-ink-subtle">Choose which days and post types publish automatically.</p>
        {gating.length > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle style={{ width: 14, height: 14 }} className="mt-0.5 shrink-0" />
            <span>Before auto-posting can publish: {gating.join(' · ')}.</span>
          </div>
        )}
        <div className="divide-y divide-border rounded-xl border border-border">
          {DAYS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm text-ink">{label}</span>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-ink-subtle">Story <Switch checked={!!settings?.schedule?.[key]?.story} onChange={(v) => setDay(key, 'story', v)} /></label>
                <label className="flex items-center gap-1.5 text-xs text-ink-subtle">Feed <Switch checked={!!settings?.schedule?.[key]?.feed} onChange={(v) => setDay(key, 'feed', v)} /></label>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* 4 · Upcoming Posts */}
      <SectionCard title="Upcoming Posts" action={<Button size="sm" variant="secondary" onClick={() => setView('queue')}>Review Queue</Button>}>
        <p className="-mt-1 mb-3 text-xs text-ink-subtle">Reviews scheduled for social media posting.</p>
        {postQueue.length === 0 ? (
          <EmptyState title="No upcoming posts scheduled" description="Open the Review Queue to line up reviews, or turn on auto-posting." />
        ) : (
          <div className="space-y-2">
            {postQueue.slice(0, 6).map((q) => (
              <div key={q.id} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">&ldquo;{(q.review?.comment ?? '').slice(0, 90)}&rdquo; ({firstName(q.review?.reviewer_name ?? null)})</p>
                  <p className="text-[11px] text-ink-subtle">{q.post_type} · {q.status}{q.error ? ` · ${q.error}` : ''}</p>
                </div>
                <Button size="sm" disabled={busy === 'pub-' + q.id} onClick={() => publishNow(q.id)}>
                  <Send style={{ width: 13, height: 13 }} /> Publish
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 5 · Post Templates */}
      <SectionCard title="Post Templates" action={<Button size="sm" onClick={() => setEditor({ open: true, initial: null })}><Plus style={{ width: 14, height: 14 }} /> Create Template</Button>}>
        <p className="-mt-1 mb-3 text-xs text-ink-subtle">Pre-designed templates to speed up your content creation.</p>
        {noTemplate ? (
          <EmptyState title="No templates yet" description="Create your first template to start generating branded posts." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {templates.map((t) => {
              const active = settings && (settings.active_feed_template_id === t.id || settings.active_story_template_id === t.id)
              return (
                <div key={t.id} className="overflow-hidden rounded-xl border border-border">
                  <SocialCardPreview template={t} review={sampleReview} />
                  <div className="space-y-1.5 p-2">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-xs font-medium text-ink">{t.name}</span>
                      <span className="rounded bg-border/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-ink-subtle">{t.type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditor({ open: true, initial: t })} className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline">
                        <Pencil style={{ width: 11, height: 11 }} /> Edit
                      </button>
                      {active ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 style={{ width: 11, height: 11 }} /> Active</span>
                      ) : (
                        <button onClick={() => setActive(t)} className="text-[11px] font-medium text-ink-subtle hover:text-ink">Set active</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Existing capability: auto-post 5-star reviews to Google */}
      <SectionCard title="Google Business posts" action={<Star className="fill-amber-400 text-amber-400" style={{ width: 16, height: 16 }} />}>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-border/30 px-3 py-2">
          <span className="text-sm text-ink">Also auto-share new 5-star reviews to your Google profile<br />
            <span className="text-xs text-ink-subtle">{googleEligible.length} recent 5-star reviews eligible. Star-only and very short reviews are skipped.</span></span>
          <Switch checked={googleAutoPost} onChange={toggleGoogle} />
        </div>
      </SectionCard>

      {publishedPosts.length > 0 && (
        <SectionCard title={`Published (${publishedPosts.length})`}>
          <div className="space-y-2">
            {publishedPosts.slice(0, 10).map((q) => (
              <div key={q.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700"><CheckCircle2 style={{ width: 13, height: 13 }} /> Posted {fmtDate(q.published_at)}</span>
                  <span className="text-[11px] uppercase text-ink-subtle">{q.post_type}</span>
                </div>
                <p className="mt-1 text-sm text-ink">&ldquo;{(q.review?.comment ?? '').slice(0, 120)}&rdquo;</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {q.results.filter((r) => r.ok && r.url).map((r, i) => (
                    <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline">
                      {r.platform} <ExternalLink style={{ width: 10, height: 10 }} />
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {!loaded && <p className="py-2 text-center text-sm text-ink-subtle">Loading…</p>}
    </div>
  )
}
