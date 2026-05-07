import { Phone, Clock, PhoneMissed, PhoneIncoming, ArrowUpRight, Copy, Check, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/core/lib/cn'
import { useCalls } from '@/core/hooks/useCalls'
import { useBusiness } from '@/core/hooks/useBusiness'
import { useAuth } from '@/core/auth/AuthProvider'
import type { Call } from '@/core/types/database'

function formatDuration(seconds: number | null) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) > 1 ? 's' : ''} ago`
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const { data: calls, loading } = useCalls()
  const { data: business } = useBusiness()
  const { user } = useAuth()
  const agentNumber = business?.phone ?? '—'

  const today = new Date().toDateString()
  const todayCalls = calls.filter(c => new Date(c.created_at).toDateString() === today)
  const completed = todayCalls.filter(c => c.status === 'completed')
  const missed = todayCalls.filter(c => c.status === 'missed')
  const totalSeconds = completed.reduce((s, c) => s + (c.duration_seconds ?? 0), 0)
  const avgSeconds = completed.length ? Math.round(totalSeconds / completed.length) : 0
  const answerRate = todayCalls.length ? Math.round((completed.length / todayCalls.length) * 100) : 100

  const recentCalls = calls.slice(0, 4)
  const displayName = user?.user_metadata?.name ?? user?.email?.split('@')[0] ?? 'there'

  function copyNumber() {
    navigator.clipboard.writeText(agentNumber.replace(/\s/g, ''))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Good morning, {displayName}</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Here's what Elsie has been up to today.
        </p>
      </div>

      {business?.plan === 'trial' && (
        <div className="flex items-center justify-between rounded-xl border border-brand/20 bg-brand-50 px-5 py-4">
          <div>
            <p className="text-[14px] font-semibold text-ink">You're on the free trial</p>
            <p className="mt-0.5 text-[13px] text-ink-muted">Upgrade to keep Elsie answering your calls.</p>
          </div>
          <button
            onClick={() => navigate('/account/billing')}
            className="shrink-0 rounded-lg bg-brand px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-600"
          >
            Upgrade
          </button>
        </div>
      )}

      {business?.phone && (
        <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-ink-muted">Your Elsie number</p>
              <p className="mt-1 text-[20px] font-bold tracking-wide text-ink">{agentNumber}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={copyNumber} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border transition hover:bg-elevated">
                {copied ? <Check size={16} className="text-success" /> : <Copy size={16} className="text-ink-muted" />}
              </button>
              <a href={`tel:${agentNumber.replace(/\s/g, '')}`} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border transition hover:bg-elevated">
                <Phone size={16} className="text-ink-muted" />
              </a>
            </div>
          </div>
          <p className="mt-3 text-[13px] text-ink-subtle">
            Forward your business line to this number, or share it directly with customers.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={PhoneIncoming} label="Calls Today" value={String(todayCalls.length)} change={`${completed.length} completed`} positive />
        <StatCard icon={Clock} label="Time Saved" value={formatDuration(totalSeconds)} change={`~${formatDuration(avgSeconds)} per call`} positive />
        <StatCard icon={PhoneMissed} label="Missed" value={String(missed.length)} change={`${answerRate}% answer rate`} positive={answerRate >= 80} />
        <StatCard icon={Phone} label="Avg Duration" value={formatDuration(avgSeconds)} change={`${completed.length} calls`} />
      </div>

      {!business?.phone && (
        <div className="rounded-xl border border-dashed border-brand/30 bg-brand-50/50 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10">
              <ExternalLink size={20} className="text-brand" />
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-semibold text-ink">Forward your existing number</p>
              <p className="mt-1 text-[13px] text-ink-muted">
                Set up call forwarding from your current business number so Elsie catches every call you miss.
              </p>
              <button
                onClick={() => navigate('/onboarding')}
                className="mt-3 text-[13px] font-semibold text-brand hover:underline"
              >
                Show me how →
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-ink">Recent Calls</h2>
        </div>

        {loading ? (
          <div className="mt-4 flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          </div>
        ) : recentCalls.length === 0 ? (
          <p className="mt-4 text-center text-[13px] text-ink-muted py-8">No calls yet. Once Elsie takes a call, it'll show here.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {recentCalls.map((call) => (
              <CallCard key={call.id} call={call} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CallCard({ call }: { call: Call }) {
  const callerName = call.contact?.name ?? 'Unknown'
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft transition hover:border-brand/20">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full',
            call.status === 'completed' ? 'bg-success/10' : 'bg-danger/10'
          )}>
            {call.status === 'completed' ? (
              <PhoneIncoming size={16} className="text-success" />
            ) : (
              <PhoneMissed size={16} className="text-danger" />
            )}
          </div>
          <div>
            <p className="text-[14px] font-medium text-ink">{callerName}</p>
            <p className="text-[12px] text-ink-subtle">
              {timeAgo(call.created_at)} · {formatDuration(call.duration_seconds)}
            </p>
          </div>
        </div>
        <button className="text-ink-subtle transition hover:text-brand">
          <ArrowUpRight size={16} />
        </button>
      </div>
      {call.ai_summary && (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{call.ai_summary}</p>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, change, positive }: {
  icon: React.ElementType
  label: string
  value: string
  change: string
  positive?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-ink-subtle" />
        <p className="text-[13px] text-ink-muted">{label}</p>
      </div>
      <p className="mt-2 text-[28px] font-semibold text-ink">{value}</p>
      <p className={cn('mt-1 text-[12px]', positive ? 'text-success' : 'text-ink-subtle')}>
        {change}
      </p>
    </div>
  )
}
