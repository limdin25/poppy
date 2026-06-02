import { useEffect, useState } from 'react'
import { Building2, Globe, Briefcase } from 'lucide-react'
import AddressAutocomplete from '@/core/components/AddressAutocomplete'
import { useBusiness } from '@/core/hooks/useBusiness'

export interface BusinessInfo {
  name: string
  industry: string
  address: string
  website: string
}

interface Props {
  onChange: (info: BusinessInfo) => void
}

export default function BusinessInfoStep({ onChange }: Props) {
  const { data: business } = useBusiness()
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [address, setAddress] = useState('')
  const [website, setWebsite] = useState('')
  const [hydrated, setHydrated] = useState(false)

  // Prefill from the existing business record once
  useEffect(() => {
    if (business && !hydrated) {
      setName(business.name ?? '')
      setIndustry((business as { industry?: string }).industry ?? '')
      setAddress((business as { address?: string }).address ?? '')
      setWebsite((business as { website?: string }).website ?? '')
      setHydrated(true)
    }
  }, [business, hydrated])

  useEffect(() => {
    onChange({ name, industry, address, website })
  }, [name, industry, address, website])

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Tell us about your business</h2>
      <p className="mt-2 text-[15px] text-ink-muted">
        Elsie uses this to answer your customers on WhatsApp. You can change it any time.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label className="text-[13px] font-medium text-ink">Business name</label>
          <div className="relative mt-1.5">
            <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bright Spark Electrics"
              className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink">Industry</label>
          <div className="relative mt-1.5">
            <Briefcase size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Electrician, Salon, Plumber"
              className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink">Business address</label>
          <div className="mt-1.5">
            <AddressAutocomplete value={address} onChange={setAddress} placeholder="Start typing — we'll suggest matches from Google" />
          </div>
          <p className="mt-1 text-[12px] text-ink-subtle">
            Powered by Google — pick a suggestion, or just type it in manually.
          </p>
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink">Website <span className="text-ink-subtle">(optional)</span></label>
          <div className="relative mt-1.5">
            <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://yourbusiness.co.uk"
              className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <p className="mt-1 text-[12px] text-ink-subtle">
            We'll scan it to learn your services for the next step.
          </p>
        </div>
      </div>
    </div>
  )
}
