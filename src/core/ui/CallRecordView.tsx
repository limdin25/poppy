import { useRef, useState } from 'react'
import { Play, Pause, Mic, MessageSquare, Clock, PhoneIncoming } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import type { Call } from '@/core/types/database'

/**
 * Renders a single call exactly like the Calls tab: header (date / duration /
 * status), AI summary, call details, a recording player and the transcript.
 * Shared so the Inbox thread and the Calls page show identical call detail.
 */

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fmtDateTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return (
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
    ' at ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  )
}

function AudioPlayer({ url, duration }: { url: string; duration: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(duration || 0)

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) audioRef.current.pause()
    else audioRef.current.play()
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
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm transition hover:opacity-90"
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex-1">
        <div className="h-1.5 cursor-pointer overflow-hidden rounded-full bg-border" onClick={handleSeek}>
          <div className="h-full rounded-full bg-accent transition-all duration-100" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-ink-subtle">
          <span>{fmtDuration(Math.round(currentTime))}</span>
          <span>{fmtDuration(Math.round(audioDuration))}</span>
        </div>
      </div>
    </div>
  )
}

export function CallRecordView({ call, contactName }: { call: Call; contactName: string }) {
  const transcript = (call.transcript ?? []) as { speaker: string; text: string }[]
  const info = (call.extracted_info ?? {}) as Record<string, unknown>
  const reason = typeof info.reason === 'string' ? info.reason : null
  const action = typeof info.action_required === 'string' ? info.action_required : null

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-medium text-success">
          <PhoneIncoming size={10} /> Call
        </span>
        <span className="flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-ink-muted">
          <Clock size={10} /> {fmtDuration(call.duration_seconds)}
        </span>
        {call.created_at && (
          <span className="rounded-full bg-elevated px-2 py-0.5 text-ink-muted">{fmtDateTime(call.created_at)}</span>
        )}
      </div>

      {/* AI summary */}
      {call.ai_summary && (
        <div className="rounded-xl border border-brand/10 bg-brand/5 p-3">
          <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-brand">
            <MessageSquare size={11} /> AI Summary
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">{call.ai_summary}</p>
        </div>
      )}

      {/* Call details */}
      {(reason || action) && (
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-subtle">Call Details</p>
          <div className="mt-1.5 space-y-1 text-[12.5px]">
            {reason && <div><span className="font-medium text-ink-muted">Reason:</span> <span className="text-ink">{reason}</span></div>}
            {action && <div><span className="font-medium text-ink-muted">Action needed:</span> <span className="text-ink">{action}</span></div>}
          </div>
        </div>
      )}

      {/* Recording */}
      {call.recording_url && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-subtle">
            <Mic size={11} /> Recording
          </p>
          <AudioPlayer url={call.recording_url} duration={call.duration_seconds} />
        </div>
      )}

      {/* Transcript */}
      {transcript.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-ink-subtle">
            <MessageSquare size={11} /> Transcript
          </p>
          <div className="space-y-2">
            {transcript.map((m, i) => {
              const isCaller = m.speaker === 'caller' || m.speaker === 'user' || m.speaker === 'contact'
              return (
                <div key={i} className={cn('flex', isCaller ? 'justify-start' : 'justify-end')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed',
                      isCaller ? 'rounded-bl-md bg-elevated text-ink' : 'rounded-br-md bg-accent text-white',
                    )}
                  >
                    <p className="mb-0.5 text-[10px] font-semibold opacity-60">{isCaller ? contactName : 'Elsie AI'}</p>
                    <p>{m.text}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
