interface Props {
  subtotal: number
  vatEnabled: boolean
  onVatToggle: (enabled: boolean) => void
  vatAmount: number
  total: number
}

export default function TotalsSummary({ subtotal, vatEnabled, onVatToggle, vatAmount, total }: Props) {
  return (
    <div className="space-y-2 rounded-lg bg-elevated p-4">
      <div className="flex justify-between text-[13px]">
        <span className="text-ink-muted">Subtotal</span>
        <span className="font-medium text-ink">{"\u00A3"}{subtotal.toFixed(2)}</span>
      </div>

      <div className="flex items-center justify-between text-[13px]">
        <label className="flex items-center gap-2 text-ink-muted">
          <input
            type="checkbox"
            checked={vatEnabled}
            onChange={(e) => onVatToggle(e.target.checked)}
            className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
          />
          VAT (20%)
        </label>
        <span className="font-medium text-ink">{"\u00A3"}{vatAmount.toFixed(2)}</span>
      </div>

      <div className="flex justify-between border-t border-border pt-2 text-[14px]">
        <span className="font-semibold text-ink">Total</span>
        <span className="font-bold text-ink">{"\u00A3"}{total.toFixed(2)}</span>
      </div>
    </div>
  )
}
