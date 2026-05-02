import { useState } from 'react'
import { cn } from '@/core/lib/cn'

interface NotifSetting {
  id: string
  label: string
  description: string
  email: boolean
  push: boolean
}

const INITIAL_SETTINGS: NotifSetting[] = [
  { id: 'call_complete', label: 'Call completed', description: 'After every call Poppy handles', email: true, push: true },
  { id: 'call_missed', label: 'Missed call', description: 'When a caller hangs up before Poppy answers', email: true, push: true },
  { id: 'booking', label: 'New booking', description: 'When Poppy books an appointment for you', email: true, push: true },
  { id: 'daily_summary', label: 'Daily summary', description: 'End-of-day report of all calls', email: true, push: false },
  { id: 'weekly_report', label: 'Weekly report', description: 'Performance stats every Monday', email: true, push: false },
  { id: 'billing', label: 'Billing alerts', description: 'Payment confirmations and subscription changes', email: true, push: false },
]

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'relative h-6 w-11 rounded-full transition-colors',
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

export default function NotificationsSection() {
  const [settings, setSettings] = useState(INITIAL_SETTINGS)

  function toggle(id: string, channel: 'email' | 'push') {
    setSettings(settings.map((s) => s.id === id ? { ...s, [channel]: !s[channel] } : s))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Notification Preferences</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Choose how and when you want to be notified.
        </p>

        <div className="mt-6">
          {/* Header */}
          <div className="mb-3 hidden items-center gap-4 px-4 sm:flex">
            <div className="flex-1" />
            <span className="w-16 text-center text-[12px] font-medium text-ink-subtle">Email</span>
            <span className="w-16 text-center text-[12px] font-medium text-ink-subtle">Push</span>
          </div>

          <div className="space-y-2">
            {settings.map((setting) => (
              <div key={setting.id} className="flex items-center gap-4 rounded-xl border border-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink">{setting.label}</p>
                  <p className="text-[12px] text-ink-muted">{setting.description}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex w-16 justify-center">
                    <Toggle enabled={setting.email} onChange={() => toggle(setting.id, 'email')} />
                  </div>
                  <div className="flex w-16 justify-center">
                    <Toggle enabled={setting.push} onChange={() => toggle(setting.id, 'push')} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
