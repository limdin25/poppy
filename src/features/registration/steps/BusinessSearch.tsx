import { useState, useRef } from 'react'
import { Search, MapPin, Globe, Building2, PenLine } from 'lucide-react'
import type { BusinessData } from '../RegistrationPage'

const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY || ''

interface Props {
  business: BusinessData
  onUpdate: (b: BusinessData) => void
  onNext: () => void
}

export default function BusinessSearch({ business, onUpdate, onNext }: Props) {
  const [query, setQuery] = useState(business.name)
  const [results, setResults] = useState<BusinessData[]>([])
  const [selected, setSelected] = useState(!!business.name)
  const [showManual, setShowManual] = useState(false)
  const [website, setWebsite] = useState(business.website)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearch(value: string) {
    setQuery(value)
    setSelected(false)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (value.length < 3) {
      setResults([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      if (!GOOGLE_PLACES_KEY) return
      setSearching(true)
      try {
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.primaryTypeDisplayName',
          },
          body: JSON.stringify({
            textQuery: value,
            locationBias: { rectangle: { low: { latitude: 49.9, longitude: -6.4 }, high: { latitude: 58.7, longitude: 1.8 } } },
            maxResultCount: 5,
          }),
        })
        const data = await res.json()
        const places: BusinessData[] = (data.places ?? []).map((p: any) => ({
          name: p.displayName?.text ?? '',
          address: p.formattedAddress ?? '',
          phone: p.nationalPhoneNumber ?? '',
          website: p.websiteUri ?? '',
          googlePlaceId: p.id ?? '',
          industry: p.primaryTypeDisplayName?.text ?? '',
        }))
        setResults(places)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
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
        Train Elsie on your business
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        Find your business so Elsie can learn how to answer your calls.
      </p>

      {/* Benefits */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Search, title: 'Find your profile', desc: 'Search your business name' },
          { icon: Building2, title: 'Train your AI', desc: 'Elsie learns from your listing' },
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
          placeholder="Search your business on Google..."
          className="h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />

        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          </div>
        )}

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

      {/* Google hint + manual entry link */}
      {!selected && !showManual && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[12px] text-ink-subtle">Powered by Google — suggestions appear as you type</span>
          <button
            onClick={() => setShowManual(true)}
            className="flex items-center gap-1.5 text-[13px] text-brand hover:underline"
          >
            <PenLine size={14} />
            Enter manually instead
          </button>
        </div>
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
            Elsie will scan your website to learn about your services
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
