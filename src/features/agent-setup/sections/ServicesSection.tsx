import { useState, useEffect } from 'react'
import { Plus, X, Loader2 } from 'lucide-react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useSyncPrompt } from '../useSyncPrompt'

interface ServiceRow {
  id: string
  name: string
  sort_order: number
}

export default function ServicesSection() {
  const { businessId } = useAuth()
  const { syncPrompt, syncing } = useSyncPrompt()
  const [services, setServices] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newService, setNewService] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!businessId) return
    supabase
      .from('services')
      .select('id, name, sort_order')
      .eq('business_id', businessId)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setServices((data as ServiceRow[]).map((s) => s.name))
        setLoading(false)
      })
  }, [businessId])

  function addService() {
    if (newService.trim()) {
      setServices([...services, newService.trim()])
      setNewService('')
      setAdding(false)
      setDirty(true)
    }
  }

  function removeService(index: number) {
    setServices(services.filter((_, i) => i !== index))
    setDirty(true)
  }

  async function handleSave() {
    if (!businessId) return
    setSaving(true)
    const { error: delErr } = await supabase.from('services').delete().eq('business_id', businessId)
    if (!delErr && services.length > 0) {
      await supabase.from('services').insert(
        services.map((name, i) => ({ business_id: businessId, name, sort_order: i }))
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
            <h2 className="text-[15px] font-semibold text-ink">Your Services</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Elsie will tell callers about these services when asked.
            </p>
          </div>
          <button
            onClick={() => setAdding(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
          >
            <Plus size={14} />
            Add
          </button>
        </div>

        {adding && (
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={newService}
              onChange={(e) => setNewService(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addService()}
              placeholder="e.g. Power Flushing"
              autoFocus
              className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <button onClick={addService} className="h-10 rounded-lg bg-brand px-4 text-[13px] font-medium text-white">
              Add
            </button>
            <button onClick={() => setAdding(false)} className="h-10 rounded-lg border border-border px-3 text-ink-muted">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {services.map((service, i) => (
            <div
              key={i}
              className="group flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-[14px] text-ink transition hover:border-brand/30"
            >
              {service}
              <button
                onClick={() => removeService(i)}
                className="text-ink-subtle opacity-0 transition group-hover:opacity-100 hover:text-danger"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {services.length === 0 && (
            <p className="text-[13px] text-ink-muted">No services added yet. Click "Add" to get started.</p>
          )}
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
        <h3 className="text-[14px] font-medium text-ink">How Elsie uses this</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          When a caller asks "what do you do?" or "do you offer X?", Elsie checks this list.
          If the service matches, she confirms it. If not, she'll let the caller know politely
          and offer to take a message.
        </p>
      </div>
    </div>
  )
}
