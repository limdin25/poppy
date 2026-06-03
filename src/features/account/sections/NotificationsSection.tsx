import { useState, useEffect, useCallback } from 'react'
import { MessageCircle, Mail, BellOff, Plus, X, Loader2, Send } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

/**
 * Owner alert destinations — Email + WhatsApp, multiple each, backed by the
 * notification_destinations table. notify.ts fans out owner alerts (new lead,
 * booking, handoff) to every enabled row here.
 */

type ChannelKey = 'email' | 'whatsapp'

interface ChannelMeta {
  key: ChannelKey
  label: string
  icon: typeof MessageCircle
  description: string
  placeholder: string
  inputType: string
}

const CHANNELS: ChannelMeta[] = [
  {
    key: 'email',
    label: 'Email',
    icon: Mail,
    description: 'Email addresses that should receive owner alerts. Add as many as you like.',
    placeholder: 'you@business.co.uk',
    inputType: 'email',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: MessageCircle,
    description: 'WhatsApp numbers that should receive owner alerts (international format).',
    placeholder: '+44 7700 900123',
    inputType: 'tel',
  },
]

interface Destination { id: string; type: ChannelKey; destination: string }

export default function NotificationsSection() {
  const { businessId, session } = useAuth()
  const [active, setActive] = useState<ChannelKey>('email')
  const [rows, setRows] = useState<Destination[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const channel = CHANNELS.find((c) => c.key === active)!
  const list = rows.filter((r) => r.type === active)

  const load = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    const { data } = await supabase
      .from('notification_destinations')
      .select('id, type, destination')
      .eq('business_id', businessId)
      .order('created_at')
    setRows((data as Destination[]) ?? [])
    setLoading(false)
  }, [businessId])

  useEffect(() => { void load() }, [load])

  async function addDestination() {
    const trimmed = value.trim()
    if (!trimmed || !businessId) return
    if (active === 'email' && !/^\S+@\S+\.\S+$/.test(trimmed)) { setError('That doesn’t look like an email address.'); return }
    setSaving(true); setError(null)
    const { error: err } = await supabase
      .from('notification_destinations')
      .insert({ business_id: businessId, type: active, destination: trimmed, enabled: true })
    setSaving(false)
    if (err) { setError(err.message); return }
    setValue(''); setAdding(false)
    await load()
  }

  async function removeDestination(id: string) {
    setSaving(true)
    await supabase.from('notification_destinations').delete().eq('id', id)
    setSaving(false)
    await load()
  }

  async function sendTest() {
    if (!session) return
    setTesting(true); setTestMsg(null)
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setTestMsg(data.error || 'Test failed.'); return }
      const n = Array.isArray(data.sent) ? data.sent.length : 0
      setTestMsg(n ? `Test sent to ${n} destination${n === 1 ? '' : 's'}.` : 'No destinations to send to yet.')
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : 'Test failed.')
    } finally {
      setTesting(false)
    }
  }

  function switchChannel(key: ChannelKey) {
    setActive(key); setAdding(false); setValue(''); setError(null)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-ink-muted" /></div>
  }

  return (
    <div>
      <h2 className="text-[22px] font-semibold tracking-tight text-ink">Notifications</h2>
      <p className="mt-1.5 max-w-2xl text-[14px] text-ink-muted">
        Choose where Elsie pings you — by email, WhatsApp, or both — when a new lead lands, a
        booking is made, or a chat needs a human.
      </p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-border bg-elevated p-1">
          {CHANNELS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => switchChannel(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium transition-colors',
                active === key ? 'bg-surface text-ink shadow-soft' : 'text-ink-muted hover:text-ink',
              )}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void sendTest()}
          disabled={testing || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated disabled:opacity-50"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Send test
        </button>
      </div>

      {testMsg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">{testMsg}</p>}

      <div className="mt-5 rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ink">{channel.label} destinations</h3>
            <p className="mt-1 max-w-xl text-[13px] text-ink-muted">{channel.description}</p>
          </div>
          <button
            onClick={() => { setValue(''); setAdding(true) }}
            disabled={saving}
            className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={16} /> Add {channel.label.toLowerCase()}
          </button>
        </div>

        {adding && (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-page p-3 sm:flex-row">
            <input
              type={channel.inputType}
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addDestination(); if (e.key === 'Escape') setAdding(false) }}
              placeholder={channel.placeholder}
              className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-ink-subtle/50"
            />
            <div className="flex gap-2">
              <button onClick={() => void addDestination()} disabled={saving} className="flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
                {saving && <Loader2 size={14} className="animate-spin" />} Save
              </button>
              <button onClick={() => setAdding(false)} className="h-10 rounded-lg border border-border bg-surface px-4 text-[13px] font-medium text-ink-muted transition hover:bg-elevated">Cancel</button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-[12px] text-danger">Couldn’t save: {error}</p>}
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface p-5 shadow-soft">
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <BellOff size={28} className="text-ink-subtle" strokeWidth={1.5} />
            <p className="mt-3 text-[14px] text-ink-muted">No {channel.label.toLowerCase()} destinations yet. Add one to start receiving alerts.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <channel.icon size={16} className="shrink-0 text-ink-subtle" />
                  <span className="truncate text-[14px] text-ink">{d.destination}</span>
                </div>
                <button onClick={() => void removeDestination(d.id)} disabled={saving} className="shrink-0 rounded-lg p-1.5 text-ink-subtle transition hover:bg-elevated hover:text-danger disabled:opacity-50" title="Remove destination">
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
