import { useState, useEffect } from 'react'
import { Plus, X, GripVertical, Loader2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useSyncPrompt } from '../useSyncPrompt'

interface InfoField {
  id: string
  label: string
  enabled: boolean
  required: boolean
}

export default function CallInfoSection() {
  const { businessId } = useAuth()
  const { syncPrompt, syncing } = useSyncPrompt()
  const [fields, setFields] = useState<InfoField[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newField, setNewField] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!businessId) return
    supabase
      .from('call_info_types')
      .select('id, name, enabled, sort_order')
      .eq('business_id', businessId)
      .order('sort_order')
      .then(({ data }) => {
        if (data && data.length > 0) {
          setFields(
            (data as Array<{ id: string; name: string; enabled: boolean; sort_order: number }>).map((r) => ({
              id: r.id,
              label: r.name,
              enabled: r.enabled,
              required: false,
            }))
          )
        } else {
          setFields([
            { id: '1', label: 'Caller name', enabled: true, required: true },
            { id: '2', label: 'Phone number', enabled: true, required: true },
            { id: '3', label: 'Email address', enabled: true, required: false },
            { id: '4', label: 'Address / Location', enabled: true, required: false },
            { id: '5', label: 'Preferred date & time', enabled: true, required: false },
            { id: '6', label: 'Nature of enquiry', enabled: true, required: true },
          ])
        }
        setLoading(false)
      })
  }, [businessId])

  function toggle(id: string, key: 'enabled' | 'required') {
    setFields(fields.map((f) => f.id === id ? { ...f, [key]: !f[key] } : f))
    setDirty(true)
  }

  function addField() {
    if (newField.trim()) {
      setFields([...fields, { id: Date.now().toString(), label: newField.trim(), enabled: true, required: false }])
      setNewField('')
      setAdding(false)
      setDirty(true)
    }
  }

  function removeField(id: string) {
    setFields(fields.filter((f) => f.id !== id))
    setDirty(true)
  }

  async function handleSave() {
    if (!businessId) return
    setSaving(true)
    const { error: delErr } = await supabase.from('call_info_types').delete().eq('business_id', businessId)
    if (!delErr && fields.length > 0) {
      await supabase.from('call_info_types').insert(
        fields.map((f, i) => ({ business_id: businessId, name: f.label, enabled: f.enabled, sort_order: i }))
      )
    }
    await syncPrompt()
    setSaving(false)
    setSaved(true)
    setDirty(false)
    setTimeout(() => setSaved(false), 2000)
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

      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving || syncing}
          className="flex h-10 items-center gap-2 rounded-lg bg-brand px-6 text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {(saving || syncing) && <Loader2 size={16} className="animate-spin" />}
          {saved ? 'Saved!' : (saving || syncing) ? 'Saving & syncing...' : 'Save changes'}
        </button>
      )}

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
