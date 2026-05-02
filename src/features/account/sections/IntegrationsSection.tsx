import { useState } from 'react'
import { Phone, MessageSquare, Mail, Calendar, CheckCircle2, X, QrCode, Smartphone, Send, Globe, ArrowRight } from 'lucide-react'
import { cn } from '@/core/lib/cn'

type ChannelId = 'voice' | 'sms' | 'whatsapp' | 'email' | 'calendar'
type ModalId = ChannelId | null

interface ConnectionState {
  whatsapp: { connected: boolean; number?: string }
  sms: { connected: boolean; reminders: boolean; followups: boolean }
  email: { connected: boolean; provider?: string; address?: string }
  calendar: { connected: boolean; provider?: string; syncing?: boolean }
  voice: { connected: boolean; number: string }
}

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-soft">
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
  const [activeModal, setActiveModal] = useState<ModalId>(null)
  const [connections, setConnections] = useState<ConnectionState>({
    whatsapp: { connected: false },
    sms: { connected: false, reminders: true, followups: true },
    email: { connected: false },
    calendar: { connected: false },
    voice: { connected: true, number: '07700 900 123' },
  })

  const [smsReminders, setSmsReminders] = useState(true)
  const [smsFollowups, setSmsFollowups] = useState(true)

  const connectWhatsApp = () => {
    setConnections(prev => ({ ...prev, whatsapp: { connected: true, number: '+44 7700 900 456' } }))
  }

  const disconnectWhatsApp = () => {
    setConnections(prev => ({ ...prev, whatsapp: { connected: false } }))
  }

  const connectSms = () => {
    setConnections(prev => ({ ...prev, sms: { connected: true, reminders: smsReminders, followups: smsFollowups } }))
    setActiveModal(null)
  }

  const disconnectSms = () => {
    setConnections(prev => ({ ...prev, sms: { connected: false, reminders: true, followups: true } }))
  }

  const connectEmail = (provider: string) => {
    const address = provider === 'gmail' ? 'hello@mybusiness.com' : 'hello@mybusiness.outlook.com'
    setConnections(prev => ({ ...prev, email: { connected: true, provider, address } }))
  }

  const disconnectEmail = () => {
    setConnections(prev => ({ ...prev, email: { connected: false } }))
  }

  const connectCalendar = (provider: string) => {
    setConnections(prev => ({ ...prev, calendar: { connected: true, provider, syncing: true } }))
  }

  const disconnectCalendar = () => {
    setConnections(prev => ({ ...prev, calendar: { connected: false } }))
  }

  const channels = [
    {
      id: 'voice' as ChannelId,
      name: 'Voice (Phone)',
      description: 'AI answers your calls 24/7',
      icon: Phone,
    },
    {
      id: 'whatsapp' as ChannelId,
      name: 'WhatsApp',
      description: 'Reply to customers on WhatsApp',
      icon: MessageSquare,
    },
    {
      id: 'sms' as ChannelId,
      name: 'SMS',
      description: 'Automated text follow-ups after calls',
      icon: Smartphone,
    },
    {
      id: 'email' as ChannelId,
      name: 'Email',
      description: 'AI handles email enquiries',
      icon: Mail,
    },
    {
      id: 'calendar' as ChannelId,
      name: 'Calendar',
      description: 'Auto-book appointments during calls',
      icon: Calendar,
    },
  ]

  const isConnected = (id: ChannelId) => connections[id].connected

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Channels & Integrations</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Connect additional channels to reach your customers everywhere.
        </p>

        <div className="mt-4 space-y-3">
          {channels.map((channel) => {
            const connected = isConnected(channel.id)
            return (
              <div key={channel.id} className="flex items-center gap-4 rounded-xl border border-border p-4 transition hover:border-brand/20">
                <div className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                  connected ? 'bg-success/10' : 'bg-elevated'
                )}>
                  <channel.icon size={20} className={cn(
                    connected ? 'text-success' : 'text-ink-muted'
                  )} />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink">{channel.name}</p>
                  <p className="text-[12px] text-ink-muted">{channel.description}</p>
                  {connected && channel.id === 'whatsapp' && connections.whatsapp.number && (
                    <p className="mt-0.5 text-[12px] text-success">{connections.whatsapp.number}</p>
                  )}
                  {connected && channel.id === 'email' && connections.email.address && (
                    <p className="mt-0.5 text-[12px] text-success">{connections.email.address}</p>
                  )}
                  {connected && channel.id === 'voice' && (
                    <p className="mt-0.5 text-[12px] text-success">{connections.voice.number}</p>
                  )}
                  {connected && channel.id === 'calendar' && connections.calendar.provider && (
                    <p className="mt-0.5 text-[12px] text-success">
                      {connections.calendar.provider === 'google' ? 'Google Calendar' : 'Cal.com'} syncing
                    </p>
                  )}
                </div>

                <div>
                  {connected ? (
                    <button
                      onClick={() => setActiveModal(channel.id)}
                      className="flex items-center gap-1.5 text-[12px] font-medium text-success transition hover:text-success/80"
                    >
                      <CheckCircle2 size={14} />
                      {channel.id === 'voice' ? 'Manage' : 'Connected'}
                    </button>
                  ) : (
                    <button
                      onClick={() => setActiveModal(channel.id)}
                      className="h-8 rounded-lg bg-brand px-3 text-[12px] font-semibold text-white transition hover:bg-brand/90"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* WhatsApp Modal */}
      <Modal open={activeModal === 'whatsapp'} onClose={() => setActiveModal(null)}>
        {connections.whatsapp.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                <CheckCircle2 size={20} className="text-success" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-ink">WhatsApp Connected</p>
                <p className="text-[13px] text-ink-muted">{connections.whatsapp.number}</p>
              </div>
            </div>
            <p className="text-[13px] text-ink-muted">
              Your WhatsApp Business account is linked. Poppy will respond to customer messages automatically.
            </p>
            <button
              onClick={() => { disconnectWhatsApp(); setActiveModal(null) }}
              className="w-full rounded-lg border border-red-200 px-4 py-2.5 text-[13px] font-medium text-red-600 transition hover:bg-red-50"
            >
              Disconnect WhatsApp
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Connect WhatsApp</h3>
              <p className="mt-1 text-[13px] text-ink-muted">
                Scan the QR code below with your WhatsApp app to link your business number.
              </p>
            </div>

            <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-elevated/50 p-6">
              {/* Mock QR Code */}
              <div className="flex h-48 w-48 items-center justify-center rounded-lg border-2 border-dashed border-ink-muted/30 bg-white">
                <QrCode size={64} className="text-ink-muted/50" />
              </div>
              <p className="text-center text-[12px] text-ink-muted">
                Open WhatsApp on your phone, go to Settings &gt; Linked Devices &gt; Link a Device
              </p>
            </div>

            <button
              onClick={connectWhatsApp}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand/90"
            >
              Simulate Connection
            </button>
          </div>
        )}
      </Modal>

      {/* SMS Modal */}
      <Modal open={activeModal === 'sms'} onClose={() => setActiveModal(null)}>
        {connections.sms.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                <CheckCircle2 size={20} className="text-success" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-ink">SMS Connected</p>
                <p className="text-[13px] text-ink-muted">Using your Poppy number</p>
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
            <button
              onClick={() => { disconnectSms(); setActiveModal(null) }}
              className="w-full rounded-lg border border-red-200 px-4 py-2.5 text-[13px] font-medium text-red-600 transition hover:bg-red-50"
            >
              Disconnect SMS
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Set up SMS</h3>
              <p className="mt-1 text-[13px] text-ink-muted">
                SMS messages will be sent from your Poppy phone number. Customers can reply directly.
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Send size={14} className="text-ink-muted" />
                  <span className="text-[13px] text-ink">Auto-send appointment reminders</span>
                </div>
                <button
                  onClick={() => setSmsReminders(!smsReminders)}
                  className={cn(
                    'relative h-5 w-9 rounded-full transition',
                    smsReminders ? 'bg-brand' : 'bg-ink-muted/30'
                  )}
                >
                  <span className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                    smsReminders ? 'translate-x-4' : 'translate-x-0.5'
                  )} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone size={14} className="text-ink-muted" />
                  <span className="text-[13px] text-ink">Auto-send follow-ups after calls</span>
                </div>
                <button
                  onClick={() => setSmsFollowups(!smsFollowups)}
                  className={cn(
                    'relative h-5 w-9 rounded-full transition',
                    smsFollowups ? 'bg-brand' : 'bg-ink-muted/30'
                  )}
                >
                  <span className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                    smsFollowups ? 'translate-x-4' : 'translate-x-0.5'
                  )} />
                </button>
              </div>
            </div>

            <button
              onClick={connectSms}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-brand/90"
            >
              Enable SMS
            </button>
          </div>
        )}
      </Modal>

      {/* Email Modal */}
      <Modal open={activeModal === 'email'} onClose={() => setActiveModal(null)}>
        {connections.email.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                <CheckCircle2 size={20} className="text-success" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-ink">Email Connected</p>
                <p className="text-[13px] text-ink-muted">{connections.email.address}</p>
              </div>
            </div>
            <p className="text-[13px] text-ink-muted">
              Poppy is monitoring your inbox and will respond to customer enquiries automatically.
            </p>
            <button
              onClick={() => { disconnectEmail(); setActiveModal(null) }}
              className="w-full rounded-lg border border-red-200 px-4 py-2.5 text-[13px] font-medium text-red-600 transition hover:bg-red-50"
            >
              Disconnect Email
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Connect Email</h3>
              <p className="mt-1 text-[13px] text-ink-muted">
                Link your email account so Poppy can read and respond to customer enquiries.
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => connectEmail('gmail')}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/20 hover:bg-elevated/50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
                  <Mail size={18} className="text-red-500" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-medium text-ink">Connect Gmail</p>
                  <p className="text-[12px] text-ink-muted">Google Workspace or personal Gmail</p>
                </div>
                <ArrowRight size={16} className="text-ink-muted" />
              </button>

              <button
                onClick={() => connectEmail('outlook')}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/20 hover:bg-elevated/50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                  <Mail size={18} className="text-blue-600" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-medium text-ink">Connect Outlook</p>
                  <p className="text-[12px] text-ink-muted">Microsoft 365 or Outlook.com</p>
                </div>
                <ArrowRight size={16} className="text-ink-muted" />
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Calendar Modal */}
      <Modal open={activeModal === 'calendar'} onClose={() => setActiveModal(null)}>
        {connections.calendar.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
                <CheckCircle2 size={20} className="text-success" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-ink">Calendar Connected</p>
                <p className="text-[13px] text-ink-muted">
                  {connections.calendar.provider === 'google' ? 'Google Calendar' : 'Cal.com'}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink">Sync status</span>
                <span className="flex items-center gap-1.5 text-[12px] text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  Live
                </span>
              </div>
            </div>
            <p className="text-[13px] text-ink-muted">
              Poppy can see your availability and book appointments directly during calls.
            </p>
            <button
              onClick={() => { disconnectCalendar(); setActiveModal(null) }}
              className="w-full rounded-lg border border-red-200 px-4 py-2.5 text-[13px] font-medium text-red-600 transition hover:bg-red-50"
            >
              Disconnect Calendar
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Connect Calendar</h3>
              <p className="mt-1 text-[13px] text-ink-muted">
                Let Poppy auto-book appointments during calls based on your real availability.
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => connectCalendar('google')}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/20 hover:bg-elevated/50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                  <Calendar size={18} className="text-blue-600" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-medium text-ink">Connect Google Calendar</p>
                  <p className="text-[12px] text-ink-muted">Sync your Google availability</p>
                </div>
                <ArrowRight size={16} className="text-ink-muted" />
              </button>

              <button
                onClick={() => connectCalendar('calcom')}
                className="flex w-full items-center gap-3 rounded-xl border border-border p-4 transition hover:border-brand/20 hover:bg-elevated/50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
                  <Globe size={18} className="text-neutral-700" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-medium text-ink">Connect Cal.com</p>
                  <p className="text-[12px] text-ink-muted">Use your Cal.com booking links</p>
                </div>
                <ArrowRight size={16} className="text-ink-muted" />
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Voice Modal (Manage) */}
      <Modal open={activeModal === 'voice'} onClose={() => setActiveModal(null)}>
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10">
              <Phone size={20} className="text-success" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-ink">Voice (Phone)</p>
              <p className="text-[13px] text-ink-muted">{connections.voice.number}</p>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <p className="text-[13px] font-medium text-ink">Call Forwarding</p>
            <p className="mt-1 text-[12px] text-ink-muted">
              Forward your existing business number to your Poppy number so AI answers when you cannot.
            </p>
            <div className="mt-3 space-y-2 rounded-lg bg-elevated p-3">
              <p className="text-[12px] font-medium text-ink">Setup instructions:</p>
              <ol className="list-inside list-decimal space-y-1 text-[12px] text-ink-muted">
                <li>Open your phone dialler</li>
                <li>Dial **61*07700900123# and press call</li>
                <li>You will hear a confirmation tone</li>
                <li>Unanswered calls will now route to Poppy</li>
              </ol>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-ink">Status</span>
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Active
              </span>
            </div>
          </div>

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
