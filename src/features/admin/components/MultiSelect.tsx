import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface Props {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  /** How an option is written on screen. */
  format?: (value: string) => string
}

/** A filter that takes several values. Empty means "everything". */
export function MultiSelect({ label, options, selected, onChange, format = (v) => v }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('touchstart', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('touchstart', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  // A chosen value stays in the list even if the date range no longer has it.
  const all = [...new Set([...options, ...selected])].sort((a, b) => a.localeCompare(b))
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  const summary = selected.length === 0 ? 'All' : selected.length === 1 ? format(selected[0]) : `${selected.length} chosen`

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition',
          selected.length ? 'border-brand bg-brand/5 text-brand' : 'border-border bg-surface text-ink hover:bg-elevated',
        )}
      >
        <span className="font-medium">{label}:</span>
        <span className="max-w-[140px] truncate">{summary}</span>
        <ChevronDown size={13} className={cn('shrink-0 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" aria-label={label} className="absolute left-0 z-20 mt-1 max-h-72 w-64 max-w-[80vw] overflow-auto rounded-lg border border-border bg-surface p-1 shadow-pop">
          {all.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-ink-muted">Nothing was recorded in this date range.</p>
          ) : (
            all.map((value) => {
              const on = selected.includes(value)
              return (
                <button
                  key={value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(value)}
                  className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-elevated', on ? 'text-ink' : 'text-ink-muted')}
                >
                  <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand bg-brand text-white' : 'border-border')}>
                    {on && <Check size={11} />}
                  </span>
                  <span className="min-w-0 break-words">{format(value)}</span>
                </button>
              )
            })
          )}
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded border-t border-border px-2 py-1.5 text-left text-[12px] font-medium text-brand hover:bg-elevated">
              Clear, show all
            </button>
          )}
        </div>
      )}
    </div>
  )
}
