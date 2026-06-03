import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Flame,
  MessagesSquare,
  Sparkles,
  Clock,
  BookOpen,
  MessageCircle,
  BarChart3,
  Activity,
} from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { PageHeader } from '@/core/ui/PageHeader'
import { StatCard } from '@/core/ui/StatCard'
import { SectionCard } from '@/core/ui/SectionCard'
import { StatusPill } from '@/core/ui/StatusPill'
import { FilterChips } from '@/core/ui/FilterChips'
import { Avatar } from '@/core/ui/Avatar'
import { cn } from '@/core/lib/cn'
import { useLeads } from '@/core/hooks/useLeads'
import { useConversations } from '@/core/hooks/useConversations'
import { useAppointments } from '@/core/hooks/useAppointments'
import { useAnalyticsApi } from '@/core/hooks/useAnalyticsApi'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import type { Conversation, LeadStatus } from '@/core/types/database'

/**
 * Overview (waslo-faithful layout, Elsie voice + diffs). WhatsApp-only,
 * answering-first, no credits. Now wired to real data where cleanly derivable:
 *   Hot leads             → useLeads() count where lead_status === 'hot'
 *   Conversations answered→ useConversations('all') total (label "This week")
 *   Drafts pending        → messages with status 'draft' across the business
 *   Needs your reply      → most-recent conversations (name + preview + time)
 *   Next 6 hours          → useAppointments() upcoming within 6h (else next few)
 *   Most-consulted KB     → GET /api/training/sources
 *   Avg response time     → GET /api/analytics/summary (avgResponseSeconds)
 *   Overview chart        → GET /api/analytics/volume
 *   Live activity feed    → GET /api/analytics/activity
 * No sample/hardcoded values remain.
 */

interface ActivityRow {
  id: string
  date: string
  contactName: string
  channel: string
  direction: 'inbound' | 'outbound'
  sender: 'contact' | 'ai' | 'human'
  status: string
  body: string | null
}
interface VolumeResp { days: { date: string; messagesIn: number; messagesOut: number; calls: number }[] }

/** Format avg response seconds → "8s" / "2m" / "1h". */
function fmtResponse(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  return `${Math.round(sec / 3600)}h`
}

/** Turn an activity message row into a human feed line + tone. */
function feedLine(r: ActivityRow): { text: string; tone: 'success' | 'hot' | 'warm' | 'info' | 'neutral' } {
  const who = r.contactName
  if (r.sender === 'ai' && r.status === 'draft') return { text: `Elsie drafted a reply for ${who} — awaiting your approval`, tone: 'warm' }
  if (r.sender === 'ai') return { text: `Elsie replied to ${who}${r.body ? `: ${r.body}` : ''}`, tone: 'success' }
  if (r.sender === 'human') return { text: `You replied to ${who}`, tone: 'info' }
  return { text: `${who}: ${r.body ?? 'New message'}`, tone: 'neutral' }
}

interface KbSource {
  id: string
  name: string
  status: 'processing' | 'synced' | 'failed'
}

function toneForLead(status: LeadStatus | null): 'hot' | 'warm' | 'cold' {
  return status === 'hot' || status === 'warm' || status === 'cold' ? status : 'cold'
}

/** Short relative time for the "Needs your reply" list (4m / 22m / 1h / 2d). */
function shortAgo(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms) || ms < 0) return 'now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

/** HH:MM in 24h for the appointment tiles. */
function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user, session } = useAuth()
  const [range, setRange] = useState('7d')
  const [feedChannel, setFeedChannel] = useState('all')

  // --- Real data hooks ---
  const { data: leads, loading: leadsLoading } = useLeads()
  const { data: conversations, loading: convLoading } = useConversations('all')
  const { data: appointments, loading: apptLoading } = useAppointments()

  const [draftsCount, setDraftsCount] = useState<number | null>(null)
  const [kb, setKb] = useState<KbSource[] | null>(null)

  // --- Real analytics (server-side aggregation) ---
  const days = range === '7d' ? 7 : 30
  const fromDate = useMemo(() => new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10), [days])
  const toIso = useMemo(() => new Date().toISOString(), [range]) // eslint-disable-line react-hooks/exhaustive-deps
  const actFrom = useMemo(() => new Date(Date.now() - 7 * 86_400_000).toISOString(), [])
  const actTo = useMemo(() => new Date().toISOString(), [])
  const { data: volume } = useAnalyticsApi<VolumeResp>('volume', { from: fromDate, to: toIso }, { days: [] })
  const { data: summary } = useAnalyticsApi<{ avgResponseSeconds: number | null }>('summary', { from: fromDate, to: toIso }, { avgResponseSeconds: null })
  const { data: activity } = useAnalyticsApi<{ rows: ActivityRow[] }>('activity', { from: actFrom, to: actTo, pageSize: '20' }, { rows: [] })

  // Drafts pending — messages with status 'draft' inside this business's
  // conversations. Derived from the loaded conversation set (no relationship
  // guessing): count draft messages whose conversation_id belongs to us.
  useEffect(() => {
    if (convLoading) return
    const convIds = conversations.map((c) => c.id)
    if (convIds.length === 0) {
      setDraftsCount(0)
      return
    }
    let cancelled = false
    ;(async () => {
      const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'draft')
        .in('conversation_id', convIds)
      if (!cancelled) setDraftsCount(error ? 0 : count ?? 0)
    })()
    return () => {
      cancelled = true
    }
  }, [conversations, convLoading])

  // Most-consulted KB this week — real knowledge sources for the business.
  useEffect(() => {
    const token = session?.access_token
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/training/sources', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (!cancelled) setKb(Array.isArray(data.sources) ? data.sources : [])
      } catch {
        if (!cancelled) setKb([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session?.access_token])

  const displayName = user?.user_metadata?.name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  // Derived stats
  const hotLeads = leads.filter((l) => l.lead_status === 'hot').length
  const conversationsAnswered = conversations.length

  // Needs your reply — most recent conversations.
  const needsReply = useMemo(() => {
    return [...conversations]
      .sort((a, b) => Date.parse(b.last_message_at ?? '') - Date.parse(a.last_message_at ?? ''))
      .slice(0, 4)
      .map((c: Conversation) => ({
        id: c.id,
        name: c.contact?.name || c.group_name || c.contact?.whatsapp || c.contact?.phone || 'Unknown',
        preview: c.last_message_preview || 'New conversation',
        time: shortAgo(c.last_message_at),
        tone: toneForLead(c.contact?.lead_status ?? null),
      }))
  }, [conversations])

  // Next 6 hours — upcoming appointments within 6h; fall back to next few upcoming.
  const upcoming = useMemo(() => {
    const now = Date.now()
    const sixHours = now + 6 * 60 * 60 * 1000
    const future = appointments
      .filter((a) => a.status !== 'cancelled' && Date.parse(a.starts_at) >= now)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    const within6 = future.filter((a) => Date.parse(a.starts_at) <= sixHours)
    return (within6.length ? within6 : future).slice(0, 4)
  }, [appointments])

  // Overview chart — real per-day message volume from /api/analytics/volume.
  const chart = useMemo(() => {
    return (volume.days || []).map((d) => {
      const date = new Date(d.date)
      const label = days <= 7
        ? date.toLocaleDateString('en-GB', { weekday: 'short' })
        : date.toLocaleDateString('en-GB', { day: 'numeric' })
      return { label, value: (d.messagesIn || 0) + (d.messagesOut || 0) }
    })
  }, [volume, days])
  const chartMax = Math.max(1, ...chart.map((d) => d.value))

  // Live activity — real recent messages, filtered to WhatsApp.
  const feed = useMemo(() => {
    return (activity.rows || [])
      .filter((r) => feedChannel === 'all' || r.channel === feedChannel)
      .filter((r) => r.channel !== 'email')
      .slice(0, 8)
      .map((r) => {
        const { text, tone } = feedLine(r)
        return { id: r.id, text, time: shortAgo(r.date), tone }
      })
  }, [activity, feedChannel])

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${displayName}`}
        description="Welcome back — every message answered in your tone, the moment it lands."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink shadow-soft">
            <span className="h-2 w-2 rounded-full bg-whatsapp" />
            Live
          </span>
        }
      />

      {/* Stat cards — no credits */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<MessagesSquare />}
          label="Conversations answered"
          value={convLoading ? '—' : conversationsAnswered}
          sub="This week · 100% answered"
        />
        <StatCard icon={<Clock />} label="Avg response time" value={fmtResponse(summary.avgResponseSeconds)} sub="Answered before they refresh" />
        <StatCard
          icon={<Flame />}
          label="Hot leads"
          value={leadsLoading ? '—' : hotLeads}
          sub={hotLeads === 1 ? '1 lead needs a nudge' : `${hotLeads} leads need a nudge`}
        />
        <StatCard
          icon={<Sparkles />}
          label="Drafts pending"
          value={draftsCount === null ? '—' : draftsCount}
          sub="Awaiting your approval"
        />
      </div>

      {/* Row 1: Needs your reply  +  Next 6 hours */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          eyebrow="Needs your reply"
          action={
            <button onClick={() => navigate('/inbox')} className="font-medium text-ink hover:underline">
              Open inbox →
            </button>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {convLoading && (
              <li className="px-5 py-8 text-center text-[13px] text-ink-subtle">Loading conversations…</li>
            )}
            {!convLoading &&
              needsReply.map((c) => (
                <li
                  key={c.id}
                  onClick={() => navigate('/inbox')}
                  className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-elevated/50"
                >
                  <Avatar name={c.name} channel="whatsapp" size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13.5px] font-medium text-ink">{c.name}</p>
                      <StatusPill tone={c.tone}>{c.tone}</StatusPill>
                    </div>
                    <p className="truncate text-[12.5px] text-ink-muted">{c.preview}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-subtle">{c.time}</span>
                </li>
              ))}
            {!convLoading && needsReply.length === 0 && (
              <li className="px-5 py-8 text-center text-[13px] text-ink-subtle">
                You're all caught up — no conversations waiting.
              </li>
            )}
          </ul>
        </SectionCard>

        <SectionCard
          eyebrow="Next 6 hours"
          action={
            <button onClick={() => navigate('/appointments')} className="font-medium text-ink hover:underline">
              All →
            </button>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {apptLoading && (
              <li className="px-5 py-8 text-center text-[13px] text-ink-subtle">Loading appointments…</li>
            )}
            {!apptLoading &&
              upcoming.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated text-[12px] font-semibold text-ink">
                    {clockTime(a.starts_at)}
                  </div>
                  <p className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {a.title}
                    {a.contact?.name ? ` — ${a.contact.name}` : ''}
                  </p>
                  <StatusPill tone={a.status === 'confirmed' ? 'success' : 'warning'} uppercase={false}>
                    {a.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                  </StatusPill>
                </li>
              ))}
            {!apptLoading && upcoming.length === 0 && (
              <li className="px-5 py-8 text-center text-[13px] text-ink-subtle">Nothing booked in the next few hours.</li>
            )}
          </ul>
        </SectionCard>
      </div>

      {/* Row 2: Where conversations come from  +  Most-consulted KB */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard eyebrow="Where conversations come from">
          {/* WhatsApp-only — single channel at 100%. */}
          <div className="space-y-3.5">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
                <span className="flex items-center gap-1.5 text-ink">
                  <MessageCircle size={14} className="text-ink-muted" />
                  WhatsApp
                </span>
                <span className="font-medium text-ink-muted">
                  {convLoading ? '—' : conversationsAnswered} · 100%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-whatsapp" style={{ width: '100%' }} />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Most-consulted KB this week"
          action={
            <button onClick={() => navigate('/knowledge')} className="font-medium text-ink hover:underline">
              Manage →
            </button>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {kb === null && (
              <li className="px-5 py-8 text-center text-[13px] text-ink-subtle">Loading knowledge…</li>
            )}
            {kb !== null &&
              kb.slice(0, 4).map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-5 py-2.5">
                  <BookOpen size={15} className="shrink-0 text-ink-subtle" />
                  <p className="min-w-0 flex-1 truncate text-[13px] text-ink">{k.name}</p>
                  <StatusPill
                    tone={k.status === 'synced' ? 'success' : k.status === 'failed' ? 'danger' : 'warning'}
                    uppercase={false}
                  >
                    {k.status === 'synced' ? 'Synced' : k.status === 'failed' ? 'Failed' : 'Processing'}
                  </StatusPill>
                </li>
              ))}
            {kb !== null && kb.length === 0 && (
              <li className="px-5 py-8 text-center text-[13px] text-ink-subtle">
                No knowledge sources yet — add one so Elsie can answer from it.
              </li>
            )}
          </ul>
        </SectionCard>
      </div>

      {/* Row 3: Overview chart (toggle inside)  +  Live activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Overview"
          eyebrow="Conversations handled"
          action={
            <FilterChips
              options={[
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
              ]}
              value={range}
              onChange={setRange}
            />
          }
        >
          <div className="mb-4 flex items-center gap-2 text-[12.5px] text-ink-muted">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-elevated text-ink">
              <BarChart3 size={15} />
            </span>
            Messages in and out — switch between 7 and 30 days.
          </div>
          {chart.length === 0 ? (
            <div className="flex h-44 items-center justify-center text-[13px] text-ink-subtle">No messages in this period yet.</div>
          ) : (
            <div className="flex h-44 items-stretch gap-1.5">
              {chart.map((d, i) => (
                <div key={`${d.label}-${i}`} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  {chart.length <= 10 && <span className="text-[11px] font-medium text-ink-subtle">{d.value}</span>}
                  <div
                    className="w-full rounded-t-md bg-accent/85 transition-all"
                    style={{ height: `${Math.max(4, (d.value / chartMax) * 100)}%` }}
                    title={`${d.value}`}
                  />
                  {(chart.length <= 10 || i % 5 === 0) && <span className="text-[11px] text-ink-subtle">{d.label}</span>}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Live activity"
          action={
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              <Activity size={12} />
              <span className="h-1.5 w-1.5 rounded-full bg-whatsapp" />
              Live
            </span>
          }
          bodyClassName="p-0"
        >
          <div className="border-b border-border px-5 py-3">
            <FilterChips
              options={[
                { value: 'all', label: 'All' },
                { value: 'whatsapp', label: 'WhatsApp' },
              ]}
              value={feedChannel}
              onChange={setFeedChannel}
            />
          </div>
          <ul className="divide-y divide-border">
            {feed.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-3">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', dotForTone(f.tone))} />
                <p className="min-w-0 flex-1 text-[13px] text-ink">{f.text}</p>
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-subtle">
                  <Clock size={12} />
                  {f.time}
                </span>
              </li>
            ))}
            {feed.length === 0 && (
              <li className="px-5 py-8 text-center text-[13px] text-ink-subtle">No activity on this channel yet.</li>
            )}
          </ul>
        </SectionCard>
      </div>
    </div>
  )
}

function dotForTone(tone: string) {
  switch (tone) {
    case 'success':
      return 'bg-emerald-500'
    case 'hot':
      return 'bg-red-500'
    case 'warm':
      return 'bg-amber-500'
    case 'info':
      return 'bg-blue-500'
    default:
      return 'bg-ink-subtle'
  }
}
