import { useState } from 'react'
import { Plus, X, GripVertical } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface InfoField {
  id: string
  label: string
  enabled: boolean
  required: boolean
}

const INITIAL_FIELDS: InfoField[] = [
  { id: '1', label: 'Caller name', enabled: true, required: true },
  { id: '2', label: 'Phone number', enabled: true, required: true },
  { id: '3', label: 'Email address', enabled: true, required: false },
  { id: '4', label: 'Address / Location', enabled: true, required: false },
  { id: '5', label: 'Preferred date & time', enabled: true, required: false },
  { id: '6', label: 'Nature of enquiry', enabled: true, required: true },
  { id: '7', label: 'Budget range', enabled: false, required: false },
  { id: '8', label: 'How did you hear about us?', enabled: false, required: false },
]

export default function CallInfoSection() {
  const [fields, setFields] = useState(INITIAL_FIELDS)
  const [adding, setAdding] = useState(false)
  const [newField, setNewField] = useState('')

  function toggle(id: string, key: 'enabled' | 'required') {
    setFields(fields.map((f) => f.id === id ? { ...f, [key]: !f[key] } : f))
  }

  function addField() {
    if (newField.trim()) {
      setFields([...fields, { id: Date.now().toString(), label: newField.trim(), enabled: true, required: false }])
      setNewField('')
      setAdding(false)
    }
  }

  function removeField(id: string) {
    setFields(fields.filter((f) => f.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Information to Collect</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Choose what Poppy asks callers for during the conversation.
            </p>
          </div>
          <button
            onClick={() => setAdding(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
          >
            <Plus size={14} />
            Add field
          </button>
        </div>

        {adding && (
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addField()}
              placeholder="e.g. Property type"
              autoFocus
              className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
            />
            <button onClick={addField} className="h-10 rounded-lg bg-brand px-4 text-[13px] font-medium text-white">Add</button>
            <button onClick={() => setAdding(false)} className="h-10 rounded-lg border border-border px-3 text-ink-muted"><X size={16} /></button>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {fields.map((field) => (
            <div
              key={field.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-4 py-3 transition',
                field.enabled ? 'border-border bg-surface' : 'border-border/50 bg-elevated/50 opacity-60'
              )}
            >
              <GripVertical size={16} className="shrink-0 text-ink-subtle" />

              <span className="flex-1 text-[14px] text-ink">{field.label}</span>

              {field.enabled && (
                <button
                  onClick={() => toggle(field.id, 'required')}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-[11px] font-medium transition',
                    field.required ? 'bg-brand/10 text-brand' : 'bg-elevated text-ink-subtle hover:bg-brand/10 hover:text-brand'
                  )}
                >
                  {field.required ? 'Required' : 'Optional'}
                </button>
              )}

              <button
                onClick={() => toggle(field.id, 'enabled')}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors',
                  field.enabled ? 'bg-brand' : 'bg-border'
                )}
              >
                <div className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                  field.enabled ? 'translate-x-5' : 'translate-x-0.5'
                )} />
              </button>

              <button
                onClick={() => removeField(field.id)}
                className="text-ink-subtle hover:text-danger"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h3 className="text-[14px] font-medium text-ink">How it works</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          Poppy naturally weaves these questions into the conversation rather than asking
          them all at once. Required fields will always be collected before ending the call.
          Optional fields are collected if the conversation flows naturally.
        </p>
      </div>
    </div>
  )
}
