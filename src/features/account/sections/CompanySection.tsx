import { useState } from 'react'
import { Building2, Globe, MapPin, Camera } from 'lucide-react'

export default function CompanySection() {
  const [businessName, setBusinessName] = useState('Smith & Sons Plumbing')
  const [website, setWebsite] = useState('https://smithplumbing.co.uk')
  const [address, setAddress] = useState('14 High Street, Brighton BN1 3FG')
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <h2 className="text-[15px] font-semibold text-ink">Business Details</h2>

        {/* Logo */}
        <div className="mt-4 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-elevated text-ink-subtle">
            <Building2 size={24} />
          </div>
          <div>
            <button className="flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
              <Camera size={14} />
              Upload logo
            </button>
            <p className="mt-0.5 text-[12px] text-ink-subtle">PNG or JPG, max 2MB</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label className="text-[13px] font-medium text-ink">Business name</label>
            <div className="relative mt-1.5">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>

          <div>
            <label className="text-[13px] font-medium text-ink">Website</label>
            <div className="relative mt-1.5">
              <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>

          <div>
            <label className="text-[13px] font-medium text-ink">Business address</label>
            <div className="relative mt-1.5">
              <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="mt-4 h-10 rounded-lg bg-brand px-6 text-[14px] font-semibold text-white transition hover:bg-brand-600"
        >
          {saved ? '✓ Saved' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
