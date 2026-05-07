import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Phone, MessageSquare, Mail, Calendar, CheckCircle2, X, Smartphone, Send, ArrowRight, Loader2, Trash2, Plus, Camera } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/integrations/supabase/browser'

type ChannelId = 'voice' | 'sms' | 'whatsapp' | 'email' | 'calendar' | 'instagram'
type ModalId = ChannelId | null

interface ChannelRow {
  id: string
  type: string
  status: string
  config: Record<string, unknown> | null
  auto_reply_enabled: boolean
  draft_mode: boolean
  auto_unsubscribe: boolean
}

interface ChannelLimits {
  whatsapp: number
  email: number
  sms: number
  voice: number
  instagram: number
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-soft">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition hover:bg-elevated hover:text-ink"
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  )
}

export default function IntegrationsSection() {
  const { businessId, session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeModal, setActiveModal] = useState<ModalId>(null)
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [limits, setLimits] = useState<ChannelLimits>({ whatsapp: 1, email: 1, sms: 1, voice: 1, instagram: 1 })
  const [connecting, setConnecting] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [smsReminders, setSmsReminders] = useState(false)
  const [smsFollowups, setSmsFollowups] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState(false)

  useEffect(() => {
    if (!businessId) return
    loadChannels()
    loadLimits()
    checkCalendar()
    loadSmsSettings()
  }, [businessId])

  useEffect(() => {
    const status = searchParams.get('unipile')
    if (status === 'connected' || status === 'failed') {
      loadChannels()
      searchParams.delete('unipile')
      setSearchParams(searchParams, { replace: true })
    }
    const calStatus = searchParams.get('calendar')
    if (calStatus === 'connected') {
      setCalendarConnected(true)
      setActiveModal(null)
      searchParams.delete('calendar')
      setSearchParams(searchParams, { replace: true })
    } else if (calStatus === 'error') {
      searchParams.delete('calendar')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams])

  async function loadChannels() {
    const { data } = await supabase
      .from('channels')
      .select('id, type, status, config, auto_reply_enabled, draft_mode, auto_unsubscribe')
      .eq('business_id', businessId!)
    setChannels(data ?? [])
  }

  async function loadLimits() {
    const { data } = await supabase
      .from('businesses')
      .select('channel_limits')
      .eq('id', businessId!)
      .single()
    if (data?.channel_limits) {
      setLimits({ whatsapp: 1, email: 1, sms: 1, voice: 1, instagram: 1, ...(data.channel_limits as Record<string, number>) })
    }
  }

  async function checkCalendar() {
    const { data } = await supabase
      .from('businesses')
      .select('google_calendar_tokens')
      .eq('id', businessId!)
      .single()
    setCalendarConnected(!!data?.google_calendar_tokens)
  }

  async function loadSmsSettings() {
    const { data } = await supabase
      .from('notification_settings')
      .select('sms_enabled, notify_on_booking, notify_on_call')
      .eq('business_id', businessId!)
      .single()
    if (data) {
      setSmsReminders(data.notify_on_booking ?? false)
      setSmsFollowups(data.notify_on_call ?? false)
    }
  }

  async function toggleSmsReminders() {
    const next = !smsReminders
    setSmsReminders(next)
    await supabase.from('notification_settings').upsert({
      business_id: businessId!,
      sms_enabled: next || smsFollowups,
      notify_on_booking: next,
    }, { onConflict: 'business_id' })
  }

  async function toggleSmsFollowups() {
    const next = !smsFollowups
    setSmsFollowups(next)
    await supabase.from('notification_settings').upsert({
      business_id: businessId!,
      sms_enabled: smsReminders || next,
      notify_on_call: next,
    }, { onConflict: 'business_id' })
  }

  async function connectCalendar() {
    setConnecting('calendar')
    try {
      const res = await fetch('/api/calendar/connect', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      const { url } = await res.json()
      window.location.href = url
    } catch {
      setConnecting(null)
    }
  }

  async function disconnectCalendar() {
    setConnecting('calendar-disconnect')
    try {
      await fetch('/api/calendar/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      setCalendarConnected(false)
      setActiveModal(null)
    } finally {
      setConnecting(null)
    }
  }

  function getChannels(type: string): ChannelRow[] {
    if (type === 'email') {
      return channels.filter(c => c.type.startsWith('email_'))
    }
    return channels.filter(c => c.type === type)
  }

  function getConnectedChannels(type: string): ChannelRow[] {
    return getChannels(type).filter(c => c.status === 'connected')
  }

  function isConnected(id: ChannelId): boolean {
    if (id === 'calendar') return calendarConnected
    return getConnectedChannels(id).length > 0
  }

  function getLimit(id: ChannelId): number {
    if (id === 'calendar') return 1
    return limits[id as keyof ChannelLimits] ?? 1
  }

  function canAddMore(id: ChannelId): boolean {
    if (id === 'calendar') return !calendarConnected
    const current = getChannels(id).length
    return current < getLimit(id)
  }

  async function connectViaUnipile(provider: 'WHATSAPP' | 'GMAIL' | 'OUTLOOK' | 'INSTAGRAM') {
    if (!businessId || !session) return
    setConnecting(provider)
    try {
      const res = await fetch('/api/channels/whatsapp/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ businessId, provider }),
      })
      const data = await res.json()
      if (data.error) {
        alert(data.error)
      } else if (data.url) {
        window.open(data.url, '_blank')
      }
    } finally {
      setConnecting(null)
    }
  }

  async function disconnectChannel(channelId: string) {
    if (!session) return
    if (!window.confirm('Disconnect this channel? You can reconnect it later.')) return
    setDisconnecting(channelId)
    try {
      await fetch('/api/channels/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ channelId }),
      })
      await loadChannels()
    } finally {
      setDisconnecting(null)
    }
  }

  const channelList = [
    { id: 'voice' as ChannelId, name: 'Voice (Phone)', description: 'AI answers your calls 24/7', icon: Phone },
    { id: 'whatsapp' as ChannelId, name: 'WhatsApp', description: 'Reply to customers on WhatsApp', icon: MessageSquare },
    { id: 'sms' as ChannelId, name: 'SMS', description: 'Automated text follow-ups after calls', icon: Smartphone },
    { id: 'instagram' as ChannelId, name: 'Instagram', description: 'Reply to DMs automatically', icon: Camera },
    { id: 'email' as ChannelId, name: 'Email', description: 'AI handles email enquiries', icon: Mail },
    { id: 'calendar' as ChannelId, name: 'Calendar', description: 'Auto-book appointments during calls', icon: Calendar },
  ]

  async function toggleChannelSetting(channelId: string, field: 'auto_reply_enabled' | 'draft_mode' | 'auto_unsubscribe', value: boolean) {
    await supabase.from('channels').update({ [field]: value }).eq('id', channelId)
    loadChannels()
  }

  function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          on ? 'bg-brand' : 'bg-gray-300'
        )}
      >
        <span className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          on ? 'translate-x-6' : 'translate-x-1'
        )} />
      </button>
    )
  }

  function ChannelToggles({ channel, showUnsubscribe }: { channel: ChannelRow; showUnsubscribe?: boolean }) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] font-medium text-ink">AI auto-reply</span>
          <Toggle on={channel.auto_reply_enabled} onToggle={() => toggleChannelSetting(channel.id, 'auto_reply_enabled', !channel.auto_reply_enabled)} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <span className="text-[13px] font-medium text-ink">Draft mode</span>
            <p className="text-[11px] text-ink-muted">Review AI replies before sending</p>
          </div>
          <Toggle on={channel.draft_mode} onToggle={() => toggleChannelSetting(channel.id, 'draft_mode', !channel.draft_mode)} />
        </div>
        {showUnsubscribe && (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-[13px] font-medium text-ink">Auto-unsubscribe</span>
              <p className="text-[11px] text-ink-muted">Automatically unsubscribe from spam and marketing emails</p>
            </div>
            <Toggle on={channel.auto_unsubscribe} onToggle={() => toggleChannelSetting(channel.id, 'auto_unsubscribe', !channel.auto_unsubscribe)} />
          </div>
        )}
      </div>
    )
  }

  function channelLabel(ch: ChannelRow): string {
    const config = ch.config as Record<string, string> | null
    if (config?.email) return config.email
    if (config?.phone) return config.phone
    if (ch.type === 'email_gmail') return 'Gmail'
    if (ch.type === 'email_outlook') return 'Outlook'
    return ch.type
  }

  function ConnectedChannelItem({ channel, showToggles, showUnsubscribe }: { channel: ChannelRow; showToggles?: boolean; showUnsubscribe?: boolean }) {
    return (
      <div className="rounded-lg border border-border">
        <div className="flex items-center gap-3 p-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10">
            <CheckCircle2 size={14} className="text-success" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">{channelLabel(channel)}</p>
            <p className="text-[11px] text-ink-muted capitalize">{channel.type.replace('_', ' ')}</p>
          </div>
          <button
            onClick={() => disconnectChannel(channel.id)}
            disabled={disconnecting === channel.id}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition hover:bg-danger/10 hover:text-danger"
            title="Disconnect"
          >
            {disconnecting === channel.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
        {showToggles && (
          <div className="border-t border-border px-3 py-3">
            <ChannelToggles channel={channel} showUnsubscribe={showUnsubscribe} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Channels & Integrations</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Connect additional channels to reach your customers everywhere.
        </p>

        <div className="mt-4 space-y-3">
          {channelList.map((ch) => {
            const connected = isConnected(ch.id)
            const connectedList = ch.id === 'calendar' ? [] : getConnectedChannels(ch.id)
            const limit = getLimit(ch.id)
            return (
              <div key={ch.id} className="rounded-xl border border-border overflow-hidden transition hover:border-brand/20">
                <div className="flex items-center gap-4 p-4">
                  <div className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                    connected ? 'bg-success/10' : 'bg-elevated'
                  )}>
                    <ch.icon size={20} className={cn(connected ? 'text-success' : 'text-ink-muted')} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-medium text-ink">{ch.name}</p>
                      {connectedList.length > 0 && (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                          {connectedList.length}/{limit}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-ink-muted">{ch.description}</p>
                  </div>

                  <div>
                    {connected ? (
                      <button
                        onClick={() => setActiveModal(ch.id)}
                        className="flex items-center gap-1.5 text-[12px] font-medium text-success transition hover:text-success/80"
                      >
                        <CheckCircle2 size={14} />
                        Manage
                      </button>
                    ) : (
                      <button
                        onClick={() => setActiveModal(ch.id)}
                        className="h-8 rounded-lg bg-brand px-3 text-[12px] font-semibold text-white transition hover:bg-brand/90"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* WhatsApp Modal */}
      <Modal open={activeModal === 'whatsapp'} onClose={() => setActiveModal(null)}>
        <div className="space-y-4">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">WhatsApp</h3>
            <p className="mt-1 text-[13px] text-ink-muted">
              Connect your WhatsApp Business accounts. You can connect up to {limits.whatsapp}.
            </p>
          </div>

          {getConnectedChannels('whatsapp').map((ch) => (
            <ConnectedChannelItem key={ch.id} channel={ch} showToggles />
          ))}

          {canAddMore('whatsapp') && (
            <button
              onClick={() => connectViaUnipile('WHATSAPP')}
              disabled={connecting === 'WHATSAPP'}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-3 text-[13px] font-medium text-ink-muted transition hover:border-brand/40 hover:text-brand disabled:opacity-60"
            >
              {connecting === 'WHATSAPP' ? (
                <><Loader2 size={16} className="animate-spin" /> Opening…</>
              ) : (
                <><Plus size={16} /> Connect WhatsApp</>
              )}
            </button>
          )}
        </div>
      </Modal>

      {/* SMS Modal */}
      <Modal open={activeModal === 'sms'} onClose={() => setActiveModal(null)}>
        {isConnected('sms') ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                <CheckCircle2 size={20} className="text-success" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-ink">SMS Connected</p>
                <p className="text-[13px] text-ink-muted">Using your Elsie number</p>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Appointment reminders</span>
                <span className="text-[12px] text-success">Active</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Post-call follow-ups</span>
                <span className="text-[12px] text-success">Active</span>
              </div>
            </div>
            {getConnectedChannels('sms').map((ch) => (
              <ConnectedChannelItem key={ch.id} channel={ch} />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Set up SMS</h3>
              <p className="mt-1 text-[13px] text-ink-muted">
                SMS messages will be sent from your Elsie phone number. Customers can reply directly.
              </p>
            </div>
            <div className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send size={14} className="text-ink-muted" />
                  <span className="text-[13px] text-ink">Auto-send appointment reminders</span>
                </div>
                <button
                  onClick={toggleSmsReminders}
                  className={cn('relative h-5 w-9 rounded-full transition', smsReminders ? 'bg-brand' : 'bg-ink-muted/30')}
                >
                  <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', smsReminders ? 'translate-x-4' : 'translate-x-0.5')} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone size={14} className="text-ink-muted" />
                  <span className="text-[13px] text-ink">Auto-send follow-ups after calls</span>
                </div>
                <button
                  onClick={toggleSmsFollowups}
                  className={cn('relative h-5 w-9 rounded-full transition', smsFollowups ? 'bg-brand' : 'bg-ink-muted/30')}
                >
                  <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', smsFollowups ? 'translate-x-4' : 'translate-x-0.5')} />
                </button>
              </div>
            </div>
            <p className="text-center text-[12px] text-ink-muted">SMS is sent from your Elsie phone number</p>
          </div>
        )}
      </Modal>

      {/* Instagram Modal */}
      <Modal open={activeModal === 'instagram'} onClose={() => setActiveModal(null)}>
        <div className="space-y-4">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">Instagram DMs</h3>
            <p className="mt-1 text-[13px] text-ink-muted">
              Connect your Instagram business account so Elsie can reply to DMs automatically.
            </p>
          </div>

          {getConnectedChannels('instagram').map((ch) => (
            <div key={ch.id} className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                <CheckCircle2 size={18} className="text-success" />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-medium text-ink">Instagram</p>
                <p className="text-[12px] text-success">Connected</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ink-muted">Auto-reply</span>
                  <Toggle on={ch.auto_reply_enabled} onToggle={() => toggleChannelSetting(ch.id, 'auto_reply_enabled', !ch.auto_reply_enabled)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ink-muted">Draft</span>
                  <Toggle on={ch.draft_mode} onToggle={() => toggleChannelSetting(ch.id, 'draft_mode', !ch.draft_mode)} />
                </div>
              </div>
            </div>
          ))}

          {canAddMore('instagram') && (
            <button
              onClick={() => connectViaUnipile('INSTAGRAM')}
              disabled={connecting === 'INSTAGRAM'}
              className="flex w-full items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/30 disabled:opacity-60"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-500">
                {connecting === 'INSTAGRAM' ? (
                  <Loader2 size={18} className="animate-spin text-white" />
                ) : (
                  <Camera size={18} className="text-white" />
                )}
              </div>
              <div className="flex-1 text-left">
                <p className="text-[14px] font-medium text-ink">Connect Instagram</p>
                <p className="text-[12px] text-ink-muted">Business or creator account</p>
              </div>
              <ArrowRight size={16} className="text-ink-muted" />
            </button>
          )}
        </div>
      </Modal>

      {/* Email Modal */}
      <Modal open={activeModal === 'email'} onClose={() => setActiveModal(null)}>
        <div className="space-y-4">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">Email</h3>
            <p className="mt-1 text-[13px] text-ink-muted">
              Connect your email accounts. You can connect up to {limits.email}.
            </p>
          </div>

          {getConnectedChannels('email').map((ch) => (
            <ConnectedChannelItem key={ch.id} channel={ch} showToggles showUnsubscribe />
          ))}

          {canAddMore('email') && (
            <div className="space-y-3">
              <button
                onClick={() => connectViaUnipile('GMAIL')}
                disabled={connecting === 'GMAIL'}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/20 hover:bg-elevated/50 disabled:opacity-60"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
                  {connecting === 'GMAIL' ? (
                    <Loader2 size={18} className="animate-spin text-red-500" />
                  ) : (
                    <Mail size={18} className="text-red-500" />
                  )}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-medium text-ink">Connect Gmail</p>
                  <p className="text-[12px] text-ink-muted">Google Workspace or personal Gmail</p>
                </div>
                <ArrowRight size={16} className="text-ink-muted" />
              </button>
              <button
                onClick={() => connectViaUnipile('OUTLOOK')}
                disabled={connecting === 'OUTLOOK'}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/20 hover:bg-elevated/50 disabled:opacity-60"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                  {connecting === 'OUTLOOK' ? (
                    <Loader2 size={18} className="animate-spin text-blue-500" />
                  ) : (
                    <Mail size={18} className="text-blue-500" />
                  )}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-medium text-ink">Connect Outlook</p>
                  <p className="text-[12px] text-ink-muted">Microsoft 365 or personal Outlook</p>
                </div>
                <ArrowRight size={16} className="text-ink-muted" />
              </button>
            </div>
          )}

          {!canAddMore('email') && getConnectedChannels('email').length >= limits.email && (
            <p className="text-center text-[12px] text-ink-muted">
              Maximum {limits.email} email account{limits.email > 1 ? 's' : ''} reached. Contact support to increase.
            </p>
          )}
        </div>
      </Modal>

      {/* Calendar Modal */}
      <Modal open={activeModal === 'calendar'} onClose={() => setActiveModal(null)}>
        <div className="space-y-5">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">
              {calendarConnected ? 'Google Calendar Connected' : 'Connect Calendar'}
            </h3>
            <p className="mt-1 text-[13px] text-ink-muted">
              {calendarConnected
                ? 'Elsie can now check your availability and book appointments during calls.'
                : 'Let Elsie auto-book appointments during calls based on your real availability.'}
            </p>
          </div>
          {calendarConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <CheckCircle2 size={18} className="text-success" />
                </div>
                <div className="flex-1">
                  <p className="text-[14px] font-medium text-ink">Google Calendar</p>
                  <p className="text-[12px] text-success">Connected</p>
                </div>
              </div>
              <button
                onClick={disconnectCalendar}
                disabled={connecting === 'calendar-disconnect'}
                className="w-full rounded-lg border border-border px-4 py-2 text-[13px] text-danger hover:bg-danger/5 disabled:opacity-60"
              >
                {connecting === 'calendar-disconnect' ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          ) : (
            <button
              onClick={connectCalendar}
              disabled={connecting === 'calendar'}
              className="flex w-full items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/30 disabled:opacity-60"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                <Calendar size={18} className="text-blue-600" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[14px] font-medium text-ink">Google Calendar</p>
                <p className="text-[12px] text-ink-muted">
                  {connecting === 'calendar' ? 'Redirecting to Google...' : 'Sign in with your Google account'}
                </p>
              </div>
              {connecting === 'calendar' ? (
                <Loader2 size={16} className="animate-spin text-ink-muted" />
              ) : (
                <ArrowRight size={16} className="text-ink-muted" />
              )}
            </button>
          )}
        </div>
      </Modal>

      {/* Voice Modal (Manage) */}
      <Modal open={activeModal === 'voice'} onClose={() => setActiveModal(null)}>
        <div className="space-y-5">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">Voice (Phone)</h3>
            <p className="mt-1 text-[13px] text-ink-muted">
              AI answers your calls 24/7. You can connect up to {limits.voice} phone line{limits.voice > 1 ? 's' : ''}.
            </p>
          </div>

          {getConnectedChannels('voice').map((ch) => {
            const phone = (ch.config as Record<string, string> | null)?.phone
            return (
              <div key={ch.id} className="space-y-3">
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10">
                    <Phone size={14} className="text-success" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{phone || 'Phone line'}</p>
                    <p className="text-[11px] text-success">Connected</p>
                  </div>
                  <button
                    onClick={() => disconnectChannel(ch.id)}
                    disabled={disconnecting === ch.id}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition hover:bg-danger/10 hover:text-danger"
                    title="Disconnect"
                  >
                    {disconnecting === ch.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            )
          })}

          {getConnectedChannels('voice').length > 0 && (
            <div className="rounded-xl border border-border p-4">
              <p className="text-[13px] font-medium text-ink">Call Forwarding</p>
              <p className="mt-1 text-[12px] text-ink-muted">
                Forward your existing business number to your Elsie number so AI answers when you cannot.
              </p>
              <div className="mt-3 space-y-2 rounded-lg bg-elevated p-3">
                <p className="text-[12px] font-medium text-ink">Setup instructions:</p>
                <ol className="list-inside list-decimal space-y-1 text-[12px] text-ink-muted">
                  <li>Open your phone dialler</li>
                  <li>Dial **61*+447426495169# and press call</li>
                  <li>You will hear a confirmation tone</li>
                  <li>Unanswered calls will now route to Elsie</li>
                </ol>
              </div>
            </div>
          )}

          <button
            onClick={() => setActiveModal(null)}
            className="w-full rounded-lg bg-brand px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand/90"
          >
            Done
          </button>
        </div>
      </Modal>
    </div>
  )
}
