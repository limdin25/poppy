import { Plus, Trash2 } from 'lucide-react'

export interface QuoteLineItem {
  description: string
  qty: number
  unit_price: number
}

export interface InvoiceLineItem {
  description: string
  amount: number
}

interface QuoteEditorProps {
  mode: 'quote'
  items: QuoteLineItem[]
  onChange: (items: QuoteLineItem[]) => void
}

interface InvoiceEditorProps {
  mode: 'invoice'
  items: InvoiceLineItem[]
  onChange: (items: InvoiceLineItem[]) => void
}

type Props = QuoteEditorProps | InvoiceEditorProps

export default function LineItemEditor(props: Props) {
  const { mode } = props

  function addItem() {
    if (mode === 'quote') {
      const p = props as QuoteEditorProps
      p.onChange([...p.items, { description: '', qty: 1, unit_price: 0 }])
    } else {
      const p = props as InvoiceEditorProps
      p.onChange([...p.items, { description: '', amount: 0 }])
    }
  }

  function removeItem(index: number) {
    if (mode === 'quote') {
      const p = props as QuoteEditorProps
      p.onChange(p.items.filter((_, i) => i !== index))
    } else {
      const p = props as InvoiceEditorProps
      p.onChange(p.items.filter((_, i) => i !== index))
    }
  }

  if (mode === 'quote') {
    const { items, onChange } = props as QuoteEditorProps
    return (
      <div className="space-y-2">
        <div className="hidden sm:grid sm:grid-cols-[1fr_80px_100px_80px_32px] gap-2 text-[12px] font-medium text-ink-muted px-1">
          <span>Description</span>
          <span>Qty</span>
          <span>Unit price</span>
          <span>Total</span>
          <span />
        </div>
        {items.map((item, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_80px_100px_80px_32px] gap-2 items-center rounded-lg border border-border p-2 sm:p-0 sm:border-0">
            <input
              type="text"
              value={item.description}
              onChange={(e) => {
                const next = [...items]
                next[i] = { ...next[i], description: e.target.value }
                onChange(next)
              }}
              placeholder="Item description"
              className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
            />
            <input
              type="number"
              value={item.qty || ''}
              onChange={(e) => {
                const next = [...items]
                next[i] = { ...next[i], qty: +e.target.value || 0 }
                onChange(next)
              }}
              min={1}
              className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink text-center outline-none focus:border-brand"
            />
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[13px] text-ink-muted">{"\u00A3"}</span>
              <input
                type="number"
                value={item.unit_price || ''}
                onChange={(e) => {
                  const next = [...items]
                  next[i] = { ...next[i], unit_price: +e.target.value || 0 }
                  onChange(next)
                }}
                step="0.01"
                className="h-9 w-full rounded-lg border border-border bg-surface pl-6 pr-2 text-[13px] text-ink outline-none focus:border-brand"
              />
            </div>
            <p className="text-[13px] font-medium text-ink text-center">
              {"\u00A3"}{(item.qty * item.unit_price).toFixed(2)}
            </p>
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-ink-subtle hover:text-danger hover:bg-danger/10"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-[13px] text-ink-muted hover:border-brand hover:text-brand"
        >
          <Plus size={14} /> Add line item
        </button>
      </div>
    )
  }

  const { items, onChange } = props as InvoiceEditorProps
  return (
    <div className="space-y-2">
      <div className="hidden sm:grid sm:grid-cols-[1fr_120px_32px] gap-2 text-[12px] font-medium text-ink-muted px-1">
        <span>Description</span>
        <span>Amount</span>
        <span />
      </div>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_32px] gap-2 items-center rounded-lg border border-border p-2 sm:p-0 sm:border-0">
          <input
            type="text"
            value={item.description}
            onChange={(e) => {
              const next = [...items]
              next[i] = { ...next[i], description: e.target.value }
              onChange(next)
            }}
            placeholder="Item description"
            className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
          />
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[13px] text-ink-muted">{"\u00A3"}</span>
            <input
              type="number"
              value={item.amount || ''}
              onChange={(e) => {
                const next = [...items]
                next[i] = { ...next[i], amount: +e.target.value || 0 }
                onChange(next)
              }}
              step="0.01"
              className="h-9 w-full rounded-lg border border-border bg-surface pl-6 pr-2 text-[13px] text-ink outline-none focus:border-brand"
            />
          </div>
          <button
            type="button"
            onClick={() => removeItem(i)}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-ink-subtle hover:text-danger hover:bg-danger/10"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-[13px] text-ink-muted hover:border-brand hover:text-brand"
      >
        <Plus size={14} /> Add line item
      </button>
    </div>
  )
}
