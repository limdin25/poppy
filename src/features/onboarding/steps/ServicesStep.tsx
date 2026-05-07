import { useState, useEffect } from 'react'
import { Plus, X, Sparkles } from 'lucide-react'

const AI_SUGGESTED = [
  'Emergency Plumbing',
  'Boiler Service & Repair',
  'Bathroom Installation',
  'Central Heating',
  'Drain Unblocking',
  'Radiator Installation',
  'Leak Detection',
  'Gas Safety Checks',
]

interface Props {
  onChange: (services: string[]) => void
}

export default function ServicesStep({ onChange }: Props) {
  const [services, setServices] = useState(AI_SUGGESTED)
  const [newService, setNewService] = useState('')

  useEffect(() => { onChange(services) }, [services])

  function add() {
    if (newService.trim() && !services.includes(newService.trim())) {
      setServices([...services, newService.trim()])
      setNewService('')
    }
  }

  function remove(index: number) {
    setServices(services.filter((_, i) => i !== index))
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Review your services</h2>
      <p className="mt-2 text-[15px] text-ink-muted">
        Elsie will tell callers about these services. Add, edit, or remove any that don't fit.
      </p>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-[13px] text-brand">
        <Sparkles size={14} />
        <span>AI-generated from your website — check these are correct</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {services.map((service, i) => (
          <div
            key={i}
            className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink shadow-sm transition hover:border-brand/30"
          >
            {service}
            <button
              onClick={() => remove(i)}
              className="text-ink-subtle opacity-0 transition group-hover:opacity-100 hover:text-danger"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={newService}
          onChange={(e) => setNewService(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add another service..."
          className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button
          onClick={add}
          disabled={!newService.trim()}
          className="flex h-10 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600 disabled:opacity-40"
        >
          <Plus size={14} />
          Add
        </button>
      </div>
    </div>
  )
}
