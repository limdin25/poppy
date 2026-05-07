import { useState, useEffect } from 'react'
import { Loader2, MessageSquare, Zap, Clock } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

interface FollowUpRow {
  id?: string
  enabled: boolean
  max_attempts: number
  delay_hours: number[]
  preferred_channel: string
  tone: string
}

const DEFAULTS: FollowUpRow = {
  enabled: true,
  max_attempts: 2,
  delay_hours: [2, 24],
  preferred_channel: 'same_channel',
  tone: 'friendly',
}

const PERSISTENCE_OPTIONS = [
  {
    value: 1,
    label: 'Light',
    description: 'One gentle nudge after 2 hours',
    delays: [2],
  },
  {
    value: 2,
    label: 'Normal',
    description: 'Follow up after 2 hours, then again at 24 hours',
    delays: [2, 24],
  },
  {
    value: 3,
    label: 'Persistent',
    description: 'Follow up at 2 hours, 24 hours, and 3 days',
    delays: [2, 24, 72],
  },
]

const CHANNEL_OPTIONS = [
  { value: 'same_channel', label: 'Same channel', description: 'Reply where they messaged you' },
  { value: 'whatsapp', label: 'WhatsApp', description: 'Always via WhatsApp' },
  { value: 'sms', label: 'SMS', description: 'Always via text message' },
  { value: 'email', label: 'Email', description: 'Always via email' },
]

const TONE_OPTIONS = [
  { value: 'friendly', label: 'Friendly', emoji: '😊' },
  { value: 'professional', label: 'Professional', emoji: '👔' },
  { value: 'casual', label: 'Casual', emoji: '👋' },
]

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        enabled ? 'bg-brand' : 'bg-border'
      )}
    >
      <div className={cn(
        'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
        enabled ? 'translate-x-5' : 'translate-x-0.5'
      )} />
    </button>
  )
}

export default function FollowUpSection() {
  const { businessId } = useAuth()
  const [settings, setSettings] = useState<FollowUpRow>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [stats, setStats] = useState({ pending: 0, sent: 0 })

  useEffect(() => {
    if (!businessId) return
    Promise.all([
      supabase
        .from('follow_up_settings')
        .select('*')
        .eq('business_id', businessId)
        .single(),
      supabase
        .from('follow_up_queue')
        .select('status')
        .eq('business_id', businessId)
        .in('status', ['pending', 'sent']),
    ]).then(([settingsRes, queueRes]) => {
      if (settingsRes.data) setSettings(settingsRes.data as FollowUpRow)
      if (queueRes.data) {
        setStats({
          pending: queueRes.data.filter(r => r.status === 'pending').length,
          sent: queueRes.data.filter(r => r.status === 'sent').length,
        })
      }
      setLoading(false)
    })
  }, [businessId])

  async function save(updated: FollowUpRow) {
    const payload = {
      enabled: updated.enabled,
      max_attempts: updated.max_attempts,
      delay_hours: updated.delay_hours,
      preferred_channel: updated.preferred_channel,
      tone: updated.tone,
    }

    if (updated.id) {
      await supabase.from('follow_up_settings').update(payload).eq('business_id', businessId)
    } else {
      const { data } = await supabase
        .from('follow_up_settings')
        .upsert({ business_id: businessId, ...payload })
        .select('id')
        .single()
      if (data) setSettings(prev => ({ ...prev, id: data.id }))
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function update(partial: Partial<FollowUpRow>) {
    const updated = { ...settings, ...partial }
    setSettings(updated)
    save(updated)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10">
              <Zap size={16} className="text-brand" />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Automatic Follow-ups</h2>
              <p className="text-[12px] text-ink-muted">
                Elsie follows up with leads who don't book
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saved && <span className="text-[11px] text-success">Saved</span>}
            <Toggle enabled={settings.enabled} onChange={() => update({ enabled: !settings.enabled })} />
          </div>
        </div>

        {(stats.pending > 0 || stats.sent > 0) && (
          <div className="mt-4 flex gap-3">
            {stats.pending > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-2.5 py-1">
                <Clock size={12} className="text-warning" />
                <span className="text-[11px] font-medium text-warning">{stats.pending} scheduled</span>
              </div>
            )}
            {stats.sent > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1">
                <MessageSquare size={12} className="text-success" />
                <span className="text-[11px] font-medium text-success">{stats.sent} sent</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={cn('space-y-5 transition-opacity', !settings.enabled && 'pointer-events-none opacity-40')}>
        <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
          <h3 className="text-[14px] font-semibold text-ink">How persistent?</h3>
          <p className="mt-1 text-[12px] text-ink-muted">How many times should we follow up before stopping</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {PERSISTENCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => update({ max_attempts: opt.value, delay_hours: opt.delays })}
                className={cn(
                  'rounded-xl border px-4 py-3 text-left transition',
                  settings.max_attempts === opt.value
                    ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
                    : 'border-border hover:border-ink-subtle'
                )}
              >
                <p className="text-[13px] font-semibold text-ink">{opt.label}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
          <h3 className="text-[14px] font-semibold text-ink">Follow-up channel</h3>
          <p className="mt-1 text-[12px] text-ink-muted">Which channel to use for follow-up messages</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {CHANNEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => update({ preferred_channel: opt.value })}
                className={cn(
                  'rounded-xl border px-4 py-3 text-left transition',
                  settings.preferred_channel === opt.value
                    ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
                    : 'border-border hover:border-ink-subtle'
                )}
              >
                <p className="text-[13px] font-semibold text-ink">{opt.label}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">{opt.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
          <h3 className="text-[14px] font-semibold text-ink">Tone</h3>
          <p className="mt-1 text-[12px] text-ink-muted">How the follow-up messages should sound</p>
          <div className="mt-3 flex gap-2">
            {TONE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => update({ tone: opt.value })}
                className={cn(
                  'flex-1 rounded-xl border px-4 py-3 text-center transition',
                  settings.tone === opt.value
                    ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
                    : 'border-border hover:border-ink-subtle'
                )}
              >
                <span className="text-lg">{opt.emoji}</span>
                <p className="mt-1 text-[12px] font-semibold text-ink">{opt.label}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface/50 p-4">
          <p className="text-[12px] leading-relaxed text-ink-muted">
            <strong className="text-ink">How it works:</strong> When a conversation ends without a booking,
            Elsie automatically sends a personalised follow-up message. If the lead replies or books,
            follow-ups stop immediately. Messages are AI-generated based on the conversation context.
          </p>
        </div>
      </div>
    </div>
  )
}
