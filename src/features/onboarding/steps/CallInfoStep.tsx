import { useState, useEffect } from 'react'
import { cn } from '@/core/lib/cn'

interface Field {
  id: string
  label: string
  enabled: boolean
}

const INITIAL_FIELDS: Field[] = [
  { id: '1', label: 'Caller name', enabled: true },
  { id: '2', label: 'Phone number', enabled: true },
  { id: '3', label: 'Email address', enabled: true },
  { id: '4', label: 'Address / Location', enabled: true },
  { id: '5', label: 'Preferred date & time', enabled: true },
  { id: '6', label: 'Nature of enquiry', enabled: true },
  { id: '7', label: 'Budget range', enabled: false },
  { id: '8', label: 'How they heard about you', enabled: false },
]

interface Props {
  onChange: (fields: { label: string; enabled: boolean }[]) => void
}

export default function CallInfoStep({ onChange }: Props) {
  const [fields, setFields] = useState(INITIAL_FIELDS)

  useEffect(() => {
    onChange(fields.map((f) => ({ label: f.label, enabled: f.enabled })))
  }, [fields])

  function toggle(id: string) {
    setFields(fields.map((f) => f.id === id ? { ...f, enabled: !f.enabled } : f))
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">What should Poppy collect?</h2>
      <p className="mt-2 text-[15px] text-ink-muted">
        Choose what information Poppy asks callers for. She'll work it naturally into the conversation.
      </p>

      <div className="mt-6 space-y-2">
        {fields.map((field) => (
          <button
            key={field.id}
            onClick={() => toggle(field.id)}
            className={cn(
              'flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left transition',
              field.enabled ? 'border-brand/30 bg-brand-50' : 'border-border bg-surface'
            )}
          >
            <span className={cn(
              'text-[14px] font-medium',
              field.enabled ? 'text-ink' : 'text-ink-muted'
            )}>
              {field.label}
            </span>
            <div className={cn(
              'relative h-6 w-11 rounded-full transition-colors',
              field.enabled ? 'bg-brand' : 'bg-border'
            )}>
              <div className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                field.enabled ? 'translate-x-5' : 'translate-x-0.5'
              )} />
            </div>
          </button>
        ))}
      </div>

      <p className="mt-4 text-[13px] text-ink-subtle">
        You can always change these later in Agent Setup → Call Info.
      </p>
    </div>
  )
}
