import { useState, useRef } from 'react'
import { Phone, PhoneIncoming, PhoneMissed, Clock, Search, Play, Pause, MessageSquare, ArrowLeft, PhoneCall, Mic } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { Avatar } from '@/core/ui/Avatar'
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
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
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

const STATUS_STYLES: Record<string, { icon: typeof Phone; bg: string; color: string; label: string }> = {
  completed: { icon: PhoneIncoming, bg: 'bg-success/10', color: 'text-success', label: 'Completed' },
  missed: { icon: PhoneMissed, bg: 'bg-danger/10', color: 'text-danger', label: 'Missed' },
  failed: { icon: PhoneMissed, bg: 'bg-danger/10', color: 'text-danger', label: 'Failed' },
  ringing: { icon: Phone, bg: 'bg-warning/10', color: 'text-warning', label: 'Ringing' },
  in_progress: { icon: Phone, bg: 'bg-brand/10', color: 'text-brand', label: 'In Progress' },
}

export default function CallsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('All')
  const [search, setSearch] = useState('')
  const { data: calls, loading } = useCalls()

  const selected = calls.find((c) => c.id === selectedId)

  const filtered = calls.filter((c) => {
    if (filter === 'Completed' && c.status !== 'completed') return false
    if (filter === 'Missed' && c.status !== 'missed' && c.status !== 'failed') return false
    if (search) {
      const q = search.toLowerCase()
      const name = c.contact?.name?.toLowerCase() ?? ''
      const phone = c.contact?.phone?.toLowerCase() ?? ''
      const summary = c.ai_summary?.toLowerCase() ?? ''
      if (!name.includes(q) && !phone.includes(q) && !summary.includes(q)) return false
    }
    return true
  })

  if (selected && typeof window !== 'undefined' && window.innerWidth < 1024) {
    return (
      <div className="flex h-full flex-col">
        <CallDetail call={selected} onBack={() => setSelectedId(null)} />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Call list */}
      <div className={cn(
        'flex w-full flex-col lg:w-[340px] lg:shrink-0 lg:border-r lg:border-border',
        selected && 'hidden lg:flex'
      )}>
        <div className="shrink-0 px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-ink">Calls</h1>
            <span className="rounded-full bg-elevated px-2.5 py-0.5 text-[11px] font-medium text-ink-muted">
              {calls.length}
            </span>
          </div>

          <div className="relative mt-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search calls..."
              className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div className="mt-2.5 flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full px-3 py-1 text-[12px] font-medium transition',
                  filter === f ? 'bg-brand text-white' : 'text-ink-muted hover:bg-elevated'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Phone size={20} />}
              title="No calls yet"
              description="Incoming calls will appear here"
            />
          ) : (
            <div className="space-y-0.5">
              {filtered.map((call) => {
                const style = STATUS_STYLES[call.status] ?? STATUS_STYLES.missed
                const StatusIcon = style.icon
                const callerName = call.contact?.name || call.contact?.phone || 'Unknown'
                const isSelected = selectedId === call.id
                return (
                  <button
                    key={call.id}
                    onClick={() => setSelectedId(call.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition',
                      isSelected
                        ? 'bg-brand/5 ring-1 ring-brand/20'
                        : 'hover:bg-elevated'
                    )}
                  >
                    <div className="relative shrink-0">
                      <Avatar name={callerName} size="sm" className="border-0" />
                      <div className={cn(
                        'absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white',
                        style.bg
                      )}>
                        <StatusIcon size={9} className={style.color} />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-medium text-ink">{callerName}</p>
                        <span className="shrink-0 text-[10px] text-ink-subtle">
                          {formatDate(call.created_at)} {formatTime(call.created_at)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-muted">
                        {call.ai_summary || `Call lasted ${formatDuration(call.duration_seconds)}`}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className={cn('flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', style.bg, style.color)}>
                          <StatusIcon size={9} />
                          {style.label}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-ink-subtle">
                          <Clock size={9} />
                          {formatDuration(call.duration_seconds)}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Call detail */}
      <div className="hidden flex-1 lg:flex lg:flex-col overflow-hidden">
        {selected ? (
          <CallDetail call={selected} onBack={() => setSelectedId(null)} desktop />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<PhoneCall size={24} />}
              title="Select a call"
              description="Choose a call from the list to view details, transcript, and recording"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function AudioPlayer({ url, duration }: { url: string; duration: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(duration || 0)

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setPlaying(!playing)
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !audioDuration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    audioRef.current.currentTime = pct * audioDuration
  }

  const progress = audioDuration ? (currentTime / audioDuration) * 100 : 0

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-elevated/50 p-3">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setAudioDuration(audioRef.current?.duration || duration || 0)}
        onEnded={() => { setPlaying(false); setCurrentTime(0) }}
      />
      <button
        onClick={toggle}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand/90"
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex-1">
        <div
          className="h-1.5 cursor-pointer overflow-hidden rounded-full bg-border"
          onClick={handleSeek}
        >
          <div
            className="h-full rounded-full bg-brand transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-ink-subtle">
          <span>{formatDuration(Math.round(currentTime))}</span>
          <span>{formatDuration(Math.round(audioDuration))}</span>
        </div>
      </div>
    </div>
  )
}

function CallDetail({
  call,
  onBack,
  desktop,
}: {
  call: Call
  onBack: () => void
  desktop?: boolean
}) {
  const style = STATUS_STYLES[call.status] ?? STATUS_STYLES.missed
  const StatusIcon = style.icon
  const callerName = call.contact?.name || 'Unknown'
  const callerPhone = call.contact?.phone || '—'
  const transcript = (call.transcript ?? []) as { speaker: string; text: string }[]
  const extractedInfo = (call.extracted_info ?? {}) as Record<string, any>

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className={cn('space-y-4', desktop ? 'p-6' : 'p-4')}>
          {/* Back button (mobile) */}
          {!desktop && (
            <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] font-medium text-brand">
              <ArrowLeft size={14} />
              Back
            </button>
          )}

          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <Avatar name={callerName} size="lg" className="border-0" />
              <div className={cn(
                'absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white',
                style.bg
              )}>
                <StatusIcon size={11} className={style.color} />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-ink">{callerName}</h2>
              <p className="text-[13px] text-ink-muted">{callerPhone}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', style.bg, style.color)}>
                  <StatusIcon size={10} />
                  {style.label}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-ink-muted">
                  <Clock size={10} />
                  {formatDuration(call.duration_seconds)}
                </span>
                <span className="flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-ink-muted">
                  {formatDate(call.created_at)} at {formatTime(call.created_at)}
                </span>
              </div>
            </div>
          </div>

          {/* AI Summary */}
          {call.ai_summary && (
            <div className="rounded-xl bg-brand/5 border border-brand/10 p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand">
                <MessageSquare size={12} />
                AI Summary
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink">{call.ai_summary}</p>
            </div>
          )}

          {/* Extracted info */}
          {extractedInfo.reason && (
            <div className="rounded-xl bg-elevated p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Call Details</p>
              <div className="mt-2 space-y-1.5 text-[13px]">
                {extractedInfo.reason && (
                  <div><span className="font-medium text-ink-muted">Reason:</span> <span className="text-ink">{extractedInfo.reason}</span></div>
                )}
                {extractedInfo.action_required && (
                  <div><span className="font-medium text-ink-muted">Action needed:</span> <span className="text-ink">{extractedInfo.action_required}</span></div>
                )}
              </div>
            </div>
          )}

          {/* Recording */}
          {call.recording_url && (
            <div>
              <p className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                <Mic size={12} />
                Recording
              </p>
              <AudioPlayer url={call.recording_url} duration={call.duration_seconds} />
            </div>
          )}

          {/* Transcript */}
          {transcript.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                <MessageSquare size={12} />
                Transcript
              </p>
              <div className="space-y-2">
                {transcript.map((msg, i) => {
                  const isCaller = msg.speaker === 'caller' || msg.speaker === 'user' || msg.speaker === 'contact'
                  return (
                    <div key={i} className={cn('flex', isCaller ? 'justify-start' : 'justify-end')}>
                      <div className={cn(
                        'max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed',
                        isCaller
                          ? 'rounded-bl-md bg-elevated text-ink'
                          : 'rounded-br-md bg-brand text-white'
                      )}>
                        <p className="mb-0.5 text-[10px] font-semibold opacity-60">
                          {isCaller ? (call.contact?.name || 'Caller') : 'Elsie AI'}
                        </p>
                        <p>{msg.text}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex gap-2">
          {call.contact?.phone && (
            <a
              href={`tel:${call.contact.phone}`}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
            >
              <Phone size={13} />
              Call back
            </a>
          )}
          {call.conversation_id && (
            <a
              href={`/inbox?id=${call.conversation_id}`}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12px] font-medium text-ink-muted transition hover:bg-elevated"
            >
              <MessageSquare size={13} />
              Send message
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
