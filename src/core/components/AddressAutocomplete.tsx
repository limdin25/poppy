import { useState, useRef } from 'react'
import { MapPin } from 'lucide-react'

const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY || ''

interface Props {
  value: string
  onChange: (address: string) => void
  placeholder?: string
  className?: string
}

interface PlaceResult {
  formattedAddress: string
  displayName?: { text: string }
}

export default function AddressAutocomplete({ value, onChange, placeholder = 'Start typing an address...', className }: Props) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState<PlaceResult[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleInput(val: string) {
    setQuery(val)
    onChange(val)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!GOOGLE_PLACES_KEY || val.length < 3) {
      setResults([])
      setOpen(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
            'X-Goog-FieldMask': 'places.formattedAddress,places.displayName',
          },
          body: JSON.stringify({
            textQuery: val,
            locationBias: { rectangle: { low: { latitude: 49.9, longitude: -6.4 }, high: { latitude: 58.7, longitude: 1.8 } } },
            maxResultCount: 5,
          }),
        })
        const data = await res.json() as { places?: PlaceResult[] }
        setResults(data.places ?? [])
        setOpen((data.places ?? []).length > 0)
      } catch {
        setResults([])
        setOpen(false)
      }
    }, 350)
  }

  function select(result: PlaceResult) {
    const addr = result.formattedAddress
    setQuery(addr)
    onChange(addr)
    setOpen(false)
    setResults([])
  }

  return (
    <div className="relative">
      <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
      <input
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder}
        className={className || 'h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-4 text-[14px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20'}
      />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-border bg-surface shadow-pop">
          {results.map((r, i) => (
            <button
              key={i}
              onMouseDown={() => select(r)}
              className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-elevated"
            >
              <MapPin size={14} className="mt-0.5 shrink-0 text-ink-subtle" />
              <div>
                {r.displayName?.text && <p className="text-[13px] font-medium text-ink">{r.displayName.text}</p>}
                <p className="text-[12px] text-ink-muted">{r.formattedAddress}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
