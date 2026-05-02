import { useState } from 'react'
import { Flag, Search } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface FlagDefinition {
  key: string
  name: string
  description: string
  defaultEnabled: boolean
}

interface BusinessFlag {
  businessId: string
  businessName: string
  flags: Record<string, boolean>
}

const MOCK_DEFINITIONS: FlagDefinition[] = [
  { key: 'voice_ai', name: 'Voice AI', description: 'AI-powered phone answering', defaultEnabled: true },
  { key: 'sms_channel', name: 'SMS Channel', description: 'Two-way SMS messaging', defaultEnabled: false },
  { key: 'whatsapp_channel', name: 'WhatsApp Channel', description: 'WhatsApp Business messaging', defaultEnabled: false },
  { key: 'email_channel', name: 'Email Channel', description: 'Email auto-reply', defaultEnabled: false },
  { key: 'booking_integration', name: 'Booking', description: 'Cal.com calendar booking', defaultEnabled: false },
  { key: 'quote_builder', name: 'Quotes', description: 'Generate and send quotes', defaultEnabled: false },
  { key: 'invoice_builder', name: 'Invoices', description: 'Generate and send invoices', defaultEnabled: false },
  { key: 'multi_user', name: 'Multi-user', description: 'Team member invitations', defaultEnabled: false },
  { key: 'custom_voice', name: 'Custom Voice', description: 'Custom Retell voice selection', defaultEnabled: false },
  { key: 'api_access', name: 'API Access', description: 'External API access', defaultEnabled: false },
]

const MOCK_BUSINESSES: BusinessFlag[] = [
  { businessId: '1', businessName: 'Smith & Sons Plumbing', flags: { voice_ai: true, sms_channel: true, whatsapp_channel: true, email_channel: false, booking_integration: true, quote_builder: true, invoice_builder: false, multi_user: true, custom_voice: true, api_access: false } },
  { businessId: '2', businessName: 'Brighton Heating Co', flags: { voice_ai: true, sms_channel: false, whatsapp_channel: false, email_channel: false, booking_integration: false, quote_builder: false, invoice_builder: false, multi_user: false, custom_voice: false, api_access: false } },
  { businessId: '3', businessName: "Sarah's Salon", flags: { voice_ai: true, sms_channel: true, whatsapp_channel: false, email_channel: false, booking_integration: true, quote_builder: false, invoice_builder: false, multi_user: false, custom_voice: false, api_access: false } },
  { businessId: '4', businessName: 'D&M Electrical', flags: { voice_ai: true, sms_channel: true, whatsapp_channel: true, email_channel: true, booking_integration: true, quote_builder: true, invoice_builder: true, multi_user: true, custom_voice: true, api_access: true } },
]

export default function FeatureFlagsPage() {
  const [search, setSearch] = useState('')
  const [flags, setFlags] = useState(MOCK_BUSINESSES)

  const filtered = flags.filter((b) => b.businessName.toLowerCase().includes(search.toLowerCase()))

  function toggleFlag(businessId: string, flagKey: string) {
    setFlags(flags.map((b) =>
      b.businessId === businessId
        ? { ...b, flags: { ...b.flags, [flagKey]: !b.flags[flagKey] } }
        : b
    ))
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
              {MOCK_DEFINITIONS.map((d) => (
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
                {MOCK_DEFINITIONS.map((d) => (
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
          </tbody>
        </table>
      </div>
    </div>
  )
}
