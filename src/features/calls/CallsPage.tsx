import { useState } from 'react'
import { Phone, PhoneIncoming, PhoneMissed, Clock, Search, Play, Pause, MessageSquare, ArrowLeft } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { Avatar } from '@/core/ui/Avatar'
import { MessageBubble } from '@/core/ui/MessageBubble'
import { EmptyState } from '@/core/ui/EmptyState'
import { useCalls } from '@/core/hooks/useCalls'
import type { Call } from '@/core/types/database'

function formatDuration(seconds: number | null) {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const FILTERS = ['All', 'Completed', 'Missed'] as const

const STATUS_STYLES = {
  completed: { icon: PhoneIncoming, bg: 'bg-success/10', color: 'text-success' },
  missed: { icon: PhoneMissed, bg: 'bg-danger/10', color: 'text-danger' },
  failed: { icon: PhoneMissed, bg: 'bg-danger/10', color: 'text-danger' },
  ringing: { icon: Phone, bg: 'bg-warning/10', color: 'text-warning' },
  in_progress: { icon: Phone, bg: 'bg-brand/10', color: 'text-brand' },
}

export default function CallsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('All')
  const [search, setSearch] = useState('')
  const [playing, setPlaying] = useState(false)
  const { data: calls, loading } = useCalls()

  const selected = calls.find((c) => c.id === selectedId)

  const filtered = calls.filter((c) => {
    if (filter === 'Completed' && c.status !== 'completed') return false
    if (filter === 'Missed' && c.status !== 'missed' && c.status !== 'failed') return false
    if (search) {
      const q = search.toLowerCase()
      const name = c.contact?.name?.toLowerCase() ?? ''
      const summary = c.ai_summary?.toLowerCase() ?? ''
      if (!name.includes(q) && !summary.includes(q)) return false
    }
    return true
  })

  if (selected && typeof window !== 'undefined' && window.innerWidth < 1024) {
    return (
      <div className="flex h-full flex-col">
        <CallDetail call={selected} playing={playing} setPlaying={setPlaying} onBack={() => setSelectedId(null)} />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className={cn('flex w-full flex-col border-r border-border lg:w-[300px] lg:shrink-0', selected && 'hidden lg:flex')}>
        <div className="flex items-center justify-between px-4 pt-4">
          <h1 className="text-lg font-semibold text-ink">Calls</h1>
          <span className="rounded-md bg-elevated px-2 py-0.5 text-[12px] font-medium text-ink-muted">
            {calls.length} total
          </span>
        </div>

        <div className="relative mt-3 px-4">
          <Search size={15} className="absolute left-7 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search calls..."
            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>

        <div className="mt-2.5 flex gap-1 px-4">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] font-medium transition',
                filter === f ? 'bg-brand/10 text-brand' : 'text-ink-muted hover:bg-elevated'
              )}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-muted">No calls found</p>
          ) : (
            filtered.map((call) => {
              const status = STATUS_STYLES[call.status] ?? STATUS_STYLES.missed
              const StatusIcon = status.icon
              const callerName = call.contact?.name ?? 'Unknown'
              return (
                <button
                  key={call.id}
                  onClick={() => setSelectedId(call.id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition',
                    selectedId === call.id
                      ? 'bg-brand-50 border border-brand/20'
                      : 'hover:bg-elevated border border-transparent'
                  )}
                >
                  <div className="relative">
                    <Avatar name={callerName} size="sm" className="border-0" />
                    <div className={cn('absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white', status.bg)}>
                      <StatusIcon size={9} className={status.color} />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] font-medium text-ink">{callerName}</p>
                      <span className="shrink-0 text-[10px] text-ink-subtle">{formatTime(call.created_at)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-muted">{call.ai_summary ?? 'No summary'}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="text-[10px] text-ink-subtle">{formatDuration(call.duration_seconds)}</span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      <div className="hidden flex-1 lg:flex lg:flex-col">
        {selected ? (
          <CallDetail call={selected} playing={playing} setPlaying={setPlaying} onBack={() => setSelectedId(null)} desktop />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Phone size={24} />}
              title="No call selected"
              description="Choose a call from the list to view its details and transcript"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function CallDetail({
  call,
  playing,
  setPlaying,
  onBack,
  desktop,
}: {
  call: Call
  playing: boolean
  setPlaying: (p: boolean) => void
  onBack: () => void
  desktop?: boolean
}) {
  const status = STATUS_STYLES[call.status] ?? STATUS_STYLES.missed
  const StatusIcon = status.icon
  const callerName = call.contact?.name ?? 'Unknown'
  const callerPhone = call.contact?.phone ?? '—'
  const transcript = (call.transcript ?? []) as { speaker: string; text: string }[]

  return (
    <div className="flex flex-1 flex-col">
      <div className={cn('flex-1 overflow-y-auto', desktop ? 'p-5' : 'p-4')}>
        {!desktop && (
          <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[13px] text-brand">
            <ArrowLeft size={14} />
            Back to calls
          </button>
        )}

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar name={callerName} size="lg" className="border-0" />
              <div className={cn('absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white', status.bg)}>
                <StatusIcon size={11} className={status.color} />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink">{callerName}</h2>
              <p className="text-[13px] text-ink-muted">{callerPhone}</p>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2.5 text-[12px] text-ink-muted">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {formatDate(call.created_at)} at {formatTime(call.created_at)}
          </span>
          <span className="flex items-center gap-1">
            <Phone size={12} />
            {formatDuration(call.duration_seconds)}
          </span>
        </div>

        {call.ai_summary && (
          <div className="mt-4 rounded-lg bg-elevated p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">AI Summary</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{call.ai_summary}</p>
          </div>
        )}

        {call.recording_url && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-border p-3">
            <button
              onClick={() => setPlaying(!playing)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white"
            >
              {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
            </button>
            <div className="flex-1">
              <div className="h-1 overflow-hidden rounded-full bg-brand/20">
                <div className="h-full w-1/3 rounded-full bg-brand transition-all" />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-ink-subtle">
                <span>0:00</span>
                <span>{formatDuration(call.duration_seconds)}</span>
              </div>
            </div>
          </div>
        )}

        {transcript.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center gap-1.5">
              <MessageSquare size={14} className="text-ink-muted" />
              <p className="text-[13px] font-semibold text-ink">Transcript</p>
            </div>
            <div className="mt-3 space-y-3">
              {transcript.map((msg, i) => (
                <MessageBubble
                  key={i}
                  sender={msg.speaker === 'caller' || msg.speaker === 'contact' ? 'customer' : 'ai'}
                  text={msg.text}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <button className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] font-medium text-ink-muted transition hover:bg-elevated">
            <Phone size={13} />
            Call back
          </button>
          <button className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] font-medium text-ink-muted transition hover:bg-elevated">
            <MessageSquare size={13} />
            Send SMS
          </button>
        </div>
      </div>
    </div>
  )
}
