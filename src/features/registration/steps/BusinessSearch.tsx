import { useState } from 'react'
import { Search, MapPin, Globe, Building2, PenLine } from 'lucide-react'
import type { BusinessData } from '../RegistrationPage'

interface Props {
  business: BusinessData
  onUpdate: (b: BusinessData) => void
  onNext: () => void
}

const MOCK_RESULTS = [
  {
    name: 'Smith & Sons Plumbing',
    address: '14 High Street, Brighton BN1 3FG',
    phone: '01273 456789',
    website: 'https://smithplumbing.co.uk',
    googlePlaceId: 'ChIJ_demo_1',
    industry: 'Plumber',
  },
  {
    name: 'Smith Electrical Services',
    address: '42 Western Road, Brighton BN1 2EB',
    phone: '01273 987654',
    website: '',
    googlePlaceId: 'ChIJ_demo_2',
    industry: 'Electrician',
  },
]

export default function BusinessSearch({ business, onUpdate, onNext }: Props) {
  const [query, setQuery] = useState(business.name)
  const [results, setResults] = useState<BusinessData[]>([])
  const [selected, setSelected] = useState(!!business.name)
  const [showManual, setShowManual] = useState(false)
  const [website, setWebsite] = useState(business.website)

  function handleSearch(value: string) {
    setQuery(value)
    setSelected(false)
    if (value.length >= 3) {
      // TODO: Replace with real Google Places API call
      setResults(
        MOCK_RESULTS.filter((r) =>
          r.name.toLowerCase().includes(value.toLowerCase())
        )
      )
    } else {
      setResults([])
    }
  }

  function selectResult(result: BusinessData) {
    onUpdate(result)
    setQuery(result.name)
    setWebsite(result.website)
    setSelected(true)
    setResults([])
  }

  function handleContinue() {
    if (showManual) {
      onUpdate({
        name: query,
        address: '',
        phone: '',
        website,
        googlePlaceId: '',
        industry: '',
      })
    } else {
      onUpdate({ ...business, website })
    }
    onNext()
  }

  const canContinue = (selected || (showManual && query.length >= 2)) && true

  return (
    <div className="flex flex-1 flex-col">
      {/* Heading */}
      <h1 className="text-2xl font-semibold text-ink">
        Train Poppy on your business
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        Find your business so Poppy can learn how to answer your calls.
      </p>

      {/* Benefits */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Search, title: 'Find your profile', desc: 'Search your business name' },
          { icon: Building2, title: 'Train your AI', desc: 'Poppy learns from your listing' },
          { icon: Globe, title: 'Quick setup', desc: 'Less than a minute' },
        ].map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <Icon size={20} className="text-brand" />
            <p className="mt-2 text-[13px] font-medium text-ink">{title}</p>
            <p className="mt-0.5 text-[12px] text-ink-muted">{desc}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative mt-6">
        <Search
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search your business name..."
          className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />

        {/* Dropdown results */}
        {results.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-xl border border-border bg-surface shadow-pop">
            {results.map((r) => (
              <button
                key={r.googlePlaceId}
                onClick={() => selectResult(r)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-elevated"
              >
                <MapPin size={18} className="mt-0.5 shrink-0 text-ink-subtle" />
                <div>
                  <p className="text-[14px] font-medium text-ink">{r.name}</p>
                  <p className="text-[12px] text-ink-muted">{r.address}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Manual entry link */}
      {!selected && !showManual && (
        <button
          onClick={() => setShowManual(true)}
          className="mt-3 flex items-center gap-1.5 text-[13px] text-brand hover:underline"
        >
          <PenLine size={14} />
          Can't find it? Add your business manually
        </button>
      )}

      {/* Website field */}
      {(selected || showManual) && (
        <div className="mt-4">
          <label className="text-[13px] font-medium text-ink">
            Website URL
          </label>
          <div className="relative mt-1.5">
            <Globe
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://yourbusiness.co.uk"
              className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <p className="mt-1 text-[12px] text-ink-subtle">
            Poppy will scan your website to learn about your services
          </p>
        </div>
      )}

      {/* Manual industry selector */}
      {showManual && (
        <div className="mt-4">
          <label className="text-[13px] font-medium text-ink">Industry</label>
          <select className="mt-1.5 h-12 w-full rounded-xl border border-border bg-surface px-3 text-[15px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20">
            <option value="">Select your industry...</option>
            <option value="plumber">Plumber</option>
            <option value="electrician">Electrician</option>
            <option value="builder">Builder</option>
            <option value="roofer">Roofer</option>
            <option value="gardener">Gardener</option>
            <option value="locksmith">Locksmith</option>
            <option value="painter">Painter & Decorator</option>
            <option value="cleaner">Cleaner</option>
            <option value="mechanic">Mechanic</option>
            <option value="dentist">Dentist</option>
            <option value="solicitor">Solicitor</option>
            <option value="accountant">Accountant</option>
            <option value="estate-agent">Estate Agent</option>
            <option value="salon">Hair & Beauty</option>
            <option value="vet">Vet</option>
            <option value="other">Other</option>
          </select>
        </div>
      )}

      {/* Continue button — sticky on mobile */}
      <div className="mt-auto pt-6">
        <button
          onClick={handleContinue}
          disabled={!canContinue}
          className="h-12 w-full rounded-xl bg-brand text-[15px] font-semibold text-white shadow-soft transition-all hover:bg-brand-600 active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-brand"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
