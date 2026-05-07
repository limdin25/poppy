import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

interface NotifRow {
  id?: string
  notify_on_call: boolean
  notify_on_message: boolean
  notify_on_booking: boolean
  notify_on_quote_accepted: boolean
  email_enabled: boolean
  email_address: string
  sms_enabled: boolean
  sms_number: string
  whatsapp_enabled: boolean
  whatsapp_number: string
  push_enabled: boolean
}

const DEFAULTS: NotifRow = {
  notify_on_call: true,
  notify_on_message: true,
  notify_on_booking: true,
  notify_on_quote_accepted: true,
  email_enabled: true,
  email_address: '',
  sms_enabled: false,
  sms_number: '',
  whatsapp_enabled: true,
  whatsapp_number: '',
  push_enabled: true,
}

interface SettingDef {
  key: keyof NotifRow
  label: string
  description: string
}

const SETTINGS: SettingDef[] = [
  { key: 'notify_on_call', label: 'Call completed', description: 'After every call Elsie handles' },
  { key: 'notify_on_message', label: 'New message', description: 'When a new WhatsApp or email arrives' },
  { key: 'notify_on_booking', label: 'New booking', description: 'When Elsie books an appointment for you' },
  { key: 'notify_on_quote_accepted', label: 'Quote accepted', description: 'When a customer accepts a quote' },
]

const CHANNEL_SETTINGS: SettingDef[] = [
  { key: 'email_enabled', label: 'Email notifications', description: 'Receive notifications via email' },
  { key: 'sms_enabled', label: 'SMS notifications', description: 'Receive notifications via text message' },
  { key: 'whatsapp_enabled', label: 'WhatsApp notifications', description: 'Receive notifications via WhatsApp' },
  { key: 'push_enabled', label: 'Push notifications', description: 'Browser and mobile push alerts' },
]

interface ChannelField {
  toggleKey: keyof NotifRow
  fieldKey: keyof NotifRow
  label: string
  placeholder: string
  type: string
}

const CHANNEL_FIELDS: ChannelField[] = [
  { toggleKey: 'email_enabled', fieldKey: 'email_address', label: 'Email address', placeholder: 'you@example.com', type: 'email' },
  { toggleKey: 'sms_enabled', fieldKey: 'sms_number', label: 'SMS number', placeholder: '+447700900000', type: 'tel' },
  { toggleKey: 'whatsapp_enabled', fieldKey: 'whatsapp_number', label: 'WhatsApp number', placeholder: '+447700900000', type: 'tel' },
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
  const { businessId } = useAuth()
  const [settings, setSettings] = useState<NotifRow>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!businessId) return
    supabase
      .from('notification_settings')
      .select('*')
      .eq('business_id', businessId)
      .single()
      .then(({ data }) => {
        if (data) setSettings(data as NotifRow)
        setLoading(false)
      })
  }, [businessId])

  function updateField(key: keyof NotifRow, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  async function saveFields() {
    return save({ ...settings })
  }

  async function toggle(key: keyof NotifRow) {
    const updated = { ...settings, [key]: !settings[key] }
    setSettings(updated)
    return save(updated)
  }

  async function save(updated: NotifRow) {
    setSaving(true)

    const payload = {
      notify_on_call: updated.notify_on_call,
      notify_on_message: updated.notify_on_message,
      notify_on_booking: updated.notify_on_booking,
      notify_on_quote_accepted: updated.notify_on_quote_accepted,
      email_enabled: updated.email_enabled,
      email_address: updated.email_address || null,
      sms_enabled: updated.sms_enabled,
      sms_number: updated.sms_number || null,
      whatsapp_enabled: updated.whatsapp_enabled,
      whatsapp_number: updated.whatsapp_number || null,
      push_enabled: updated.push_enabled,
    }

    if (settings.id) {
      await supabase.from('notification_settings').update(payload).eq('business_id', businessId)
    } else {
      const { data } = await supabase
        .from('notification_settings')
        .upsert({ business_id: businessId, ...payload })
        .select('id')
        .single()
      if (data) setSettings({ ...updated, id: data.id })
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Event Notifications</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          Choose which events trigger notifications.
        </p>

        <div className="mt-4 space-y-2">
          {SETTINGS.map((s) => (
            <div key={s.key} className="flex items-center gap-4 rounded-xl border border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink">{s.label}</p>
                <p className="text-[12px] text-ink-muted">{s.description}</p>
              </div>
              <Toggle enabled={settings[s.key] as boolean} onChange={() => toggle(s.key)} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Channels</h2>
        <p className="mt-1 text-[13px] text-ink-muted">
          How you want to receive notifications.
        </p>

        <div className="mt-4 space-y-2">
          {CHANNEL_SETTINGS.map((s) => {
            const field = CHANNEL_FIELDS.find(f => f.toggleKey === s.key)
            const isEnabled = settings[s.key] as boolean
            return (
              <div key={s.key} className="rounded-xl border border-border px-4 py-3">
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-ink">{s.label}</p>
                    <p className="text-[12px] text-ink-muted">{s.description}</p>
                  </div>
                  <Toggle enabled={isEnabled} onChange={() => toggle(s.key)} />
                </div>
                {field && isEnabled && (
                  <input
                    type={field.type}
                    value={(settings[field.fieldKey] as string) || ''}
                    onChange={(e) => updateField(field.fieldKey, e.target.value)}
                    onBlur={saveFields}
                    placeholder={field.placeholder}
                    className="mt-3 w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {saving && (
        <p className="text-center text-[12px] text-ink-subtle">Saving...</p>
      )}
    </div>
  )
}
