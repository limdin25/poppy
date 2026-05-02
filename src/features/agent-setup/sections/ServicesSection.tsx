import { useState } from 'react'
import { Plus, X } from 'lucide-react'

const INITIAL_SERVICES = [
  'Emergency Plumbing',
  'Boiler Service & Repair',
  'Bathroom Installation',
  'Central Heating',
  'Drain Unblocking',
  'Radiator Installation',
  'Leak Detection',
  'Gas Safety Checks',
]

export default function ServicesSection() {
  const [services, setServices] = useState(INITIAL_SERVICES)
  const [adding, setAdding] = useState(false)
  const [newService, setNewService] = useState('')

  function addService() {
    if (newService.trim()) {
      setServices([...services, newService.trim()])
      setNewService('')
      setAdding(false)
    }
  }

  function removeService(index: number) {
    setServices(services.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Your Services</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Poppy will tell callers about these services when asked.
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
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h3 className="text-[14px] font-medium text-ink">How Poppy uses this</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          When a caller asks "what do you do?" or "do you offer X?", Poppy checks this list.
          If the service matches, she confirms it. If not, she'll let the caller know politely
          and offer to take a message.
        </p>
      </div>
    </div>
  )
}
