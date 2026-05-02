import { useState, useEffect } from 'react'
import { Flag, Search } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAdminApi, useAdminMutation } from '../hooks/useAdminApi'

interface FlagDefinition {
  id: string
  key: string
  name: string
  description: string
  default_enabled: boolean
}

interface FlagRow {
  id: string
  business_id: string
  flag_key: string
  enabled: boolean
  businesses: { name: string } | null
}

interface BusinessFlags {
  businessId: string
  businessName: string
  flags: Record<string, boolean>
}

export default function FeatureFlagsPage() {
  const [search, setSearch] = useState('')
  const [businessFlags, setBusinessFlags] = useState<BusinessFlags[]>([])
  const { data: definitions } = useAdminApi<FlagDefinition[]>('feature-flags/definitions', [])
  const { data: flags } = useAdminApi<FlagRow[]>('feature-flags', [])
  const toggleMutation = useAdminMutation('feature-flags', 'PUT')

  useEffect(() => {
    if (!flags.length && !definitions.length) return
    const byBusiness = new Map<string, BusinessFlags>()
    for (const f of flags) {
      if (!byBusiness.has(f.business_id)) {
        byBusiness.set(f.business_id, {
          businessId: f.business_id,
          businessName: f.businesses?.name || f.business_id,
          flags: {},
        })
      }
      byBusiness.get(f.business_id)!.flags[f.flag_key] = f.enabled
    }
    setBusinessFlags(Array.from(byBusiness.values()))
  }, [flags, definitions])

  const filtered = businessFlags.filter((b) =>
    b.businessName.toLowerCase().includes(search.toLowerCase())
  )

  async function toggleFlag(businessId: string, flagKey: string) {
    const biz = businessFlags.find((b) => b.businessId === businessId)
    if (!biz) return
    const newValue = !biz.flags[flagKey]

    setBusinessFlags((prev) =>
      prev.map((b) =>
        b.businessId === businessId
          ? { ...b, flags: { ...b.flags, [flagKey]: newValue } }
          : b
      )
    )

    try {
      await toggleMutation({ businessId, flagKey, enabled: newValue })
    } catch {
      setBusinessFlags((prev) =>
        prev.map((b) =>
          b.businessId === businessId
            ? { ...b, flags: { ...b.flags, [flagKey]: !newValue } }
            : b
        )
      )
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Flag size={18} className="text-ink-muted" />
        <h1 className="text-xl font-semibold text-ink">Feature Flags</h1>
      </div>
      <p className="mt-1 text-[13px] text-ink-muted">Enable or disable features per business</p>

      <div className="relative mt-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search businesses..."
          className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-elevated/50">
              <th className="sticky left-0 bg-elevated/50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                Business
              </th>
              {definitions.map((d) => (
                <th key={d.key} className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-subtle" title={d.description}>
                  {d.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((biz) => (
              <tr key={biz.businessId} className="border-b border-border last:border-b-0">
                <td className="sticky left-0 bg-surface px-4 py-2.5 text-[13px] font-medium text-ink">
                  {biz.businessName}
                </td>
                {definitions.map((d) => (
                  <td key={d.key} className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => toggleFlag(biz.businessId, d.key)}
                      className={cn(
                        'h-5 w-9 rounded-full transition-colors',
                        biz.flags[d.key] ? 'bg-brand' : 'bg-border'
                      )}
                    >
                      <div
                        className={cn(
                          'h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                          biz.flags[d.key] ? 'translate-x-4' : 'translate-x-0.5'
                        )}
                      />
                    </button>
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={definitions.length + 1} className="px-4 py-6 text-center text-[13px] text-ink-muted">
                  No businesses found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
